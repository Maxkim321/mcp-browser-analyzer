const test = require('node:test')
const assert = require('node:assert')
const { ResearchWorkflow, parseJSON } = require('../src/core/workflow.js')

/**
 * M1-F8 深度研究：状态机核心逻辑单测（零依赖 node:test）
 * 通过依赖注入 mock LLM 与 fetch_url 工具，验证：
 * 1. parseJSON 容错解析
 * 2. 完整状态机流转：plan → research（grade 条件边）→ compare → report → done
 * 3. 信息不足 + 重试上限 → 条件边兜底不阻塞
 */

test('parseJSON: 解析被代码块包裹/带前后缀的 JSON', () => {
  // ```json 代码块
  assert.deepStrictEqual(parseJSON('```json\n{"a": 1}\n```'), { a: 1 })
  // 带前后缀文字
  assert.deepStrictEqual(parseJSON('结果如下：{"a": 1} 完'), { a: 1 })
  // 括号配对截取（截断的 JSON）
  assert.strictEqual(parseJSON('{"a": 1, "b": '), null)
  // 数组
  assert.deepStrictEqual(parseJSON('["https://a.com", "https://b.com"]'), ['https://a.com', 'https://b.com'])
  // 非法输入
  assert.strictEqual(parseJSON('不是 JSON'), null)
  assert.strictEqual(parseJSON(null), null)
})

function createMockLLM({ plan, topics, report }) {
  let topicCall = 0
  return {
    async chat(messages, tools, systemPrompt) {
      if (systemPrompt.includes('规划')) {
        return { role: 'assistant', content: JSON.stringify(plan) }
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
      const content = report
      onToken?.(content.slice(0, 5))
      return { role: 'assistant', content }
    },
  }
}

function createMockToolCaller(pages) {
  let call = 0
  return async (name, args) => {
    assert.strictEqual(name, 'fetch_url')
    const page = pages[Math.min(call, pages.length - 1)]
    call++
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ url: args.url, title: `标题${call}`, content: page, charCount: page.length }),
        },
      ],
    }
  }
}

test('workflow: 完整研究链路 plan→research→compare→report→done', async () => {
  const llm = createMockLLM({
    plan: {
      subQuestions: [
        { question: 'MCP 是什么', urls: ['https://a.com/mcp'] },
        { question: 'A2A 是什么', urls: ['https://b.com/a2a'] },
      ],
    },
    topics: [
      { sufficient: true, points: ['MCP 是模型上下文协议'], gap: '' },
      { sufficient: true, points: ['A2A 是 Agent 间通信协议'], gap: '' },
    ],
    report: '## 结论\nMCP 与 A2A 定位不同。',
  })
  const toolCaller = createMockToolCaller(['MCP 页面正文内容', 'A2A 页面正文内容'])

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
  // 进度有规划 + 调研 + 报告阶段
  assert.ok(progress.some((m) => m.includes('已规划 2 个子问题')))
  assert.ok(progress.some((m) => m.includes('报告生成完毕')))
})

test('workflow: 信息不足触发重试，达到上限后条件边兜底不阻塞', async () => {
  const llm = createMockLLM({
    plan: {
      subQuestions: [{ question: '冷门主题', urls: ['https://x.com/1'] }],
    },
    // 第一次调研：不足；第二次（重试轮）：仍不足 → 兜底进入下一阶段
    topics: [
      { sufficient: false, points: ['少量信息'], gap: '缺少权威定义' },
      { sufficient: false, points: ['少量信息2'], gap: '仍缺少权威定义' },
    ],
    report: '## 结论\n信息有限。',
  })
  // 每次 fetch_url 返回不同页面（第二轮会调用 suggestMoreUrls 后追加的 URL）
  const toolCaller = createMockToolCaller(['页面A内容', '页面B内容', '页面C内容'])

  const wf = new ResearchWorkflow(llm, { toolCaller, checkpoint: false, hitl: false, maxAttempts: 2 })
  const result = await wf.start('某个冷门主题的原理？')

  // 兜底：不因信息不足而失败，带着已有信息出报告
  assert.strictEqual(result.success, true)
  assert.strictEqual(result.state.step, 'done')
  assert.strictEqual(result.state.plan[0].sufficient, false)
  // 重试轮次达到上限（初始 1 次 + suggestMoreUrls 后 1 次）
  assert.strictEqual(result.state.plan[0].attempts, 2)
})

test('workflow: HITL 收到用户自定义方向后插入新主题', async () => {
  const planData = {
    subQuestions: [
      { question: '主题一', urls: ['https://a.com/1'] },
      { question: '主题二', urls: ['https://b.com/2'] },
    ],
  }
  const llm = {
    async chat(messages, tools, systemPrompt) {
      if (systemPrompt.includes('规划')) {
        return { role: 'assistant', content: JSON.stringify(planData) }
      }
      if (systemPrompt.includes('调研')) {
        return { role: 'assistant', content: JSON.stringify({ sufficient: true, points: ['要点A'], gap: '' }) }
      }
      return { role: 'assistant', content: 'x' }
    },
    async chatStream(messages, tools, systemPrompt) {
      return { role: 'assistant', content: '## 结论\n完成' }
    },
  }
  const toolCaller = createMockToolCaller(['正文A', '正文B', '正文C'])

  const asks = []
  const wf = new ResearchWorkflow(llm, { toolCaller, checkpoint: false, hitl: true })
  const result = await wf.start('研究问题', {
    onAsk: async (question, options) => {
      asks.push(question)
      // 第一次问：自定义方向；后续问：停止
      return asks.length === 1 ? { cancel: false, text: '补充调查方向B' } : { cancel: true, text: '停止研究' }
    },
  })

  // HITL 至少触发一次
  assert.ok(asks.length >= 1)
  // 自定义方向被插入为待调研主题（plan 从 2 个变 3 个：主题一/done + 补充方向B + 主题二）
  assert.strictEqual(result.state.plan.length, 3)
  assert.ok(result.state.plan.some((t) => t.question.includes('补充调查方向B')))
  // 用户停止后仍输出报告（用已有资料）
  assert.strictEqual(result.success, true)
  assert.strictEqual(result.state.step, 'done')
})

test('workflow: plan 解析失败时按单主题兜底继续', async () => {
  const llm = {
    async chat() {
      return { role: 'assistant', content: '模型没有输出 JSON' }
    },
    async chatStream() {
      return { role: 'assistant', content: '## 结论\n兜底报告' }
    },
  }
  const toolCaller = createMockToolCaller(['正文'])
  const wf = new ResearchWorkflow(llm, { toolCaller, checkpoint: false, hitl: false })
  const result = await wf.start('无法拆解的问题？')
  assert.strictEqual(result.success, true)
  assert.strictEqual(result.state.plan.length, 1)
})
