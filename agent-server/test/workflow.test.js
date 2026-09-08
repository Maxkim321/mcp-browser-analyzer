const test = require('node:test')
const assert = require('node:assert')
const { ResearchWorkflow, parseJSON } = require('../src/core/workflow.js')

/**
 * M1-F8 深度研究：状态机核心逻辑单测（零依赖 node:test）
 * 通过依赖注入 mock LLM 与 web_search / fetch_url 工具，验证：
 * 1. parseJSON 容错解析
 * 2. 完整状态机流转：plan → research（先搜后抓 + grade 条件边）→ compare → report → done
 * 3. 信息不足 + 重试上限 → 条件边兜底不阻塞
 * 4. 搜索/抓取全失败 → 报告如实带失败记录，不伪装成"有结论"
 */

test('parseJSON: 解析被代码块包裹/带前后缀的 JSON', () => {
  // ```json 代码块
  assert.deepStrictEqual(parseJSON('```json\n{"a": 1}\n```'), { a: 1 })
  // 带前后缀文字
  assert.deepStrictEqual(parseJSON('结果如下：{"a": 1} 完'), { a: 1 })
  // 括号配对截取（截断的 JSON）
  assert.strictEqual(parseJSON('{"a": 1, "b": '), null)
  // 数组
  assert.deepStrictEqual(parseJSON('["前端 秋招", "后端 秋招"]'), ['前端 秋招', '后端 秋招'])
  // 非法输入
  assert.strictEqual(parseJSON('不是 JSON'), null)
  assert.strictEqual(parseJSON(null), null)
})

/**
 * mock LLM：按 systemPrompt 分派
 * 注意顺序：RESEARCH_PLAN_PROMPT 也含"检索词"，必须先判"规划"
 */
function createMockLLM({ plan, topics, report, queries = ['补充检索词'] }) {
  let topicCall = 0
  return {
    lastReportPrompt: '',
    async chat(messages, tools, systemPrompt) {
      if (systemPrompt.includes('规划')) {
        return { role: 'assistant', content: JSON.stringify(plan) }
      }
      if (systemPrompt.includes('检索词优化')) {
        return { role: 'assistant', content: JSON.stringify(queries) }
      }
      if (systemPrompt.includes('调研')) {
        const grade = topics[Math.min(topicCall, topics.length - 1)]
        topicCall++
        return { role: 'assistant', content: JSON.stringify(grade) }
      }
      return { role: 'assistant', content: 'x' }
    },
    async chatStream(messages, tools, systemPrompt, onToken) {
      assert.ok(systemPrompt.includes('分析师'), 'report 节点应使用研究分析提示词')
      this.lastReportPrompt = messages[0].content
      onToken?.(report.slice(0, 5))
      return { role: 'assistant', content: report, prompt: messages[0].content }
    },
  }
}

/**
 * mock 工具调用：web_search 返回结果链接，fetch_url 返回页面正文
 * @param {object} cfg - { searchResults: 每次搜索返回的结果数组, pages: 每次抓取返回的正文, failFetch }
 */
function createMockTools({ searchResults, pages, failFetch = false }) {
  const calls = []
  let searchCall = 0
  let fetchCall = 0
  const toolCaller = async (name, args) => {
    calls.push({ name, args })
    if (name === 'web_search') {
      const results = searchResults[Math.min(searchCall, searchResults.length - 1)]
      searchCall++
      if (!results || results.length === 0) {
        throw new Error('搜索失败（bing: 未解析到结果链接）')
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ query: args.query, engine: 'bing', results }),
          },
        ],
      }
    }
    if (name === 'fetch_url') {
      if (failFetch) throw new Error('Tab load timeout')
      const page = pages[Math.min(fetchCall, pages.length - 1)]
      fetchCall++
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              url: args.url,
              title: `标题${fetchCall}`,
              content: page,
              charCount: page.length,
            }),
          },
        ],
      }
    }
    throw new Error(`unexpected tool: ${name}`)
  }
  return { calls, toolCaller }
}

test('workflow: 完整研究链路 plan→search→fetch→compare→report→done', async () => {
  const llm = createMockLLM({
    plan: {
      subQuestions: [
        { question: 'MCP 是什么', queries: ['MCP 协议 介绍'] },
        { question: 'A2A 是什么', queries: ['A2A 协议 介绍'] },
      ],
    },
    topics: [
      { sufficient: true, points: ['MCP 是模型上下文协议'], gap: '' },
      { sufficient: true, points: ['A2A 是 Agent 间通信协议'], gap: '' },
    ],
    report: '## 结论\nMCP 与 A2A 定位不同。',
  })
  const { calls, toolCaller } = createMockTools({
    searchResults: [
      [{ title: 'MCP 官方文档', url: 'https://a.com/mcp' }],
      [{ title: 'A2A 官方文档', url: 'https://b.com/a2a' }],
    ],
    pages: ['MCP 页面正文内容', 'A2A 页面正文内容'],
  })

  const wf = new ResearchWorkflow(llm, { toolCaller, checkpoint: false, hitl: false })
  const progress = []
  const result = await wf.start('MCP 和 A2A 有什么区别？', {
    onProgress: (p) => progress.push(p.message),
  })

  assert.strictEqual(result.success, true)
  assert.ok(result.content.includes('MCP 与 A2A 定位不同'))
  assert.strictEqual(result.state.step, 'done')
  // 两个主题都已调研完成且信息充分
  assert.strictEqual(result.state.plan.length, 2)
  assert.ok(result.state.plan.every((t) => t.sufficient))
  // 必须先搜后抓：第一次工具调用是 web_search，URL 全部来自搜索结果
  assert.strictEqual(calls[0].name, 'web_search')
  assert.ok(calls.some((c) => c.name === 'fetch_url' && c.args.url === 'https://a.com/mcp'))
  // 来源如实记录，无失败
  assert.strictEqual(result.state.sources.length, 2)
  assert.strictEqual(result.state.failures.length, 0)
  assert.ok(progress.some((m) => m.includes('已规划 2 个子问题')))
  assert.ok(progress.some((m) => m.includes('报告生成完毕')))
})

test('workflow: 信息不足触发重写检索词重试，达到上限后条件边兜底不阻塞', async () => {
  const llm = createMockLLM({
    plan: { subQuestions: [{ question: '冷门主题', queries: ['冷门主题 原理'] }] },
    // 第一次调研：不足；第二次（重试轮）：仍不足 → 兜底进入下一阶段
    topics: [
      { sufficient: false, points: ['少量信息'], gap: '缺少权威定义' },
      { sufficient: false, points: ['少量信息2'], gap: '仍缺少权威定义' },
    ],
    report: '## 结论\n信息有限。',
    queries: ['冷门主题 权威定义'],
  })
  const { calls, toolCaller } = createMockTools({
    searchResults: [
      [{ title: '页面A', url: 'https://x.com/1' }],
      [{ title: '页面B', url: 'https://x.com/2' }],
    ],
    pages: ['页面A内容', '页面B内容'],
  })

  const wf = new ResearchWorkflow(llm, {
    toolCaller,
    checkpoint: false,
    hitl: false,
    maxAttempts: 2,
  })
  const result = await wf.start('某个冷门主题的原理？')

  // 兜底：不因信息不足而失败，带着已有信息出报告
  assert.strictEqual(result.success, true)
  assert.strictEqual(result.state.step, 'done')
  assert.strictEqual(result.state.plan[0].sufficient, false)
  // 重试轮次达到上限（初始 1 次 + 重写检索词后 1 次）
  assert.strictEqual(result.state.plan[0].attempts, 2)
  // 重写检索词后重新搜索（两次 web_search，检索词不同）
  const searches = calls.filter((c) => c.name === 'web_search')
  assert.strictEqual(searches.length, 2)
  assert.notStrictEqual(searches[0].args.query, searches[1].args.query)
  // 同一 URL 不重复抓取
  const fetched = calls.filter((c) => c.name === 'fetch_url').map((c) => c.args.url)
  assert.strictEqual(new Set(fetched).size, fetched.length)
})

test('workflow: 抓取全部失败时报告如实带失败记录', async () => {
  const llm = createMockLLM({
    plan: { subQuestions: [{ question: '主题一', queries: ['主题一 数据'] }] },
    topics: [{ sufficient: false, points: [], gap: '无正文' }],
    report: '## 结论\n未获取到任何可用网页来源。',
  })
  const { toolCaller } = createMockTools({
    searchResults: [[{ title: '结果1', url: 'https://a.com/1' }]],
    pages: [],
    failFetch: true,
  })

  const wf = new ResearchWorkflow(llm, { toolCaller, checkpoint: false, hitl: false })
  const progress = []
  const result = await wf.start('某问题？', { onProgress: (p) => progress.push(p.message) })

  assert.strictEqual(result.success, true)
  // 零来源，但失败原因必须显性留痕（不能静默变成"无信息"）
  assert.strictEqual(result.state.sources.length, 0)
  assert.ok(result.state.failures.length > 0)
  // 抓取失败必须以真实原因入账（可能同时存在搜索无新链接的记录）
  assert.ok(result.state.failures.some((f) => f.target === 'https://a.com/1' && f.reason.includes('Tab load timeout')))
  assert.ok(progress.some((m) => m.includes('页面读取失败')))
  // 失败记录必须传给报告节点
  assert.ok(llm.lastReportPrompt.includes('抓取失败记录'))
  assert.ok(llm.lastReportPrompt.includes('Tab load timeout'))
})

test('workflow: 搜索无结果时跳过该主题并记录失败', async () => {
  const llm = createMockLLM({
    plan: { subQuestions: [{ question: '主题一', queries: ['查不到的词'] }] },
    topics: [{ sufficient: false, points: [], gap: '无来源' }],
    report: '## 结论\n未获取到任何可用网页来源。',
  })
  const { calls, toolCaller } = createMockTools({ searchResults: [[]], pages: [] })

  const wf = new ResearchWorkflow(llm, { toolCaller, checkpoint: false, hitl: false })
  const progress = []
  const result = await wf.start('查不到的问题？', { onProgress: (p) => progress.push(p.message) })

  assert.strictEqual(result.success, true)
  assert.strictEqual(result.state.sources.length, 0)
  assert.ok(result.state.failures.length > 0)
  // 搜索失败后不应再尝试抓取
  assert.strictEqual(calls.filter((c) => c.name === 'fetch_url').length, 0)
  assert.ok(progress.some((m) => m.includes('搜索失败') || m.includes('搜索未获得可用链接')))
})

test('workflow: HITL 收到用户自定义方向后插入新主题，且同一主题不重复询问', async () => {
  const planData = {
    subQuestions: [
      { question: '主题一', queries: ['主题一 资料'] },
      { question: '主题二', queries: ['主题二 资料'] },
    ],
  }
  const llm = {
    async chat(messages, tools, systemPrompt) {
      if (systemPrompt.includes('规划')) {
        return { role: 'assistant', content: JSON.stringify(planData) }
      }
      if (systemPrompt.includes('检索词优化')) {
        return { role: 'assistant', content: JSON.stringify(['新检索词']) }
      }
      if (systemPrompt.includes('调研')) {
        return {
          role: 'assistant',
          content: JSON.stringify({ sufficient: true, points: ['要点A'], gap: '' }),
        }
      }
      return { role: 'assistant', content: 'x' }
    },
    async chatStream() {
      return { role: 'assistant', content: '## 结论\n完成' }
    },
  }
  const { toolCaller } = createMockTools({
    searchResults: [
      [{ title: '结果1', url: 'https://a.com/1' }],
      [{ title: '结果2', url: 'https://b.com/2' }],
      [{ title: '结果3', url: 'https://c.com/3' }],
    ],
    pages: ['正文A', '正文B', '正文C'],
  })

  const asks = []
  const wf = new ResearchWorkflow(llm, { toolCaller, checkpoint: false, hitl: true })
  const result = await wf.start('研究问题', {
    onAsk: async (question) => {
      asks.push(question)
      // 第一次问：自定义方向；后续问：停止
      return asks.length === 1
        ? { cancel: false, text: '补充调查方向B' }
        : { cancel: true, text: '停止研究' }
    },
  })

  // HITL 至少触发一次
  assert.ok(asks.length >= 1)
  // 每次询问都对应一次主题推进，不会重复问同一个进度
  assert.strictEqual(new Set(asks).size, asks.length)
  // 自定义方向被插入为待调研主题（plan 从 2 个变 3 个：主题一/done + 补充方向B + 主题二）
  assert.strictEqual(result.state.plan.length, 3)
  assert.ok(result.state.plan.some((t) => t.question.includes('补充调查方向B')))
  // 用户停止后仍输出报告（用已有资料）
  assert.strictEqual(result.success, true)
  assert.strictEqual(result.state.step, 'done')
})

test('workflow: plan 解析失败时按单主题兜底继续（用原问题当检索词）', async () => {
  const llm = {
    async chat() {
      return { role: 'assistant', content: '模型没有输出 JSON' }
    },
    async chatStream() {
      return { role: 'assistant', content: '## 结论\n兜底报告' }
    },
  }
  const { calls, toolCaller } = createMockTools({
    searchResults: [[{ title: '结果1', url: 'https://a.com/1' }]],
    pages: ['正文'],
  })
  const wf = new ResearchWorkflow(llm, { toolCaller, checkpoint: false, hitl: false })
  const result = await wf.start('无法拆解的问题？')
  assert.strictEqual(result.success, true)
  assert.strictEqual(result.state.plan.length, 1)
  assert.deepStrictEqual(result.state.plan[0].queries, ['无法拆解的问题？'])
  assert.strictEqual(calls[0].args.query, '无法拆解的问题？')
})
