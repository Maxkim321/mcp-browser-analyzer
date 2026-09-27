const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// TRACE_FILE 必须在 require workflow/topic-agent（间接加载 trace-log）之前设置：
// trace-log 模块加载时读取一次 env。node --test 每个文件独立进程，不会污染其他测试。
process.env.TRACE_FILE = path.join(os.tmpdir(), `trace-topic-agent-${Date.now()}.jsonl`)

const toolHandler = require('../src/tools/handler.js')
const { ResearchWorkflow } = require('../src/core/workflow.js')
const {
  runTopicAgent,
  normalizeWorkerResult,
  WORKER_TOOL_NAMES,
} = require('../src/core/topic-agent.js')

/**
 * P6 深度研究子 agent（TopicAgent）单测（零依赖 node:test）
 *
 * mock 策略：
 * - LLM：注入 mock LLMClient（worker 复用 Agent 类 → chatStream 按 systemPrompt 分派
 *   worker 轮次；plan/report/verify 走 workflow 的 chat/chatStream）
 * - 工具：handler.setToolOverrides 覆盖 web_search/fetch_url（评测同一机制），不经插件转发
 * - 观测：TRACE_FILE 指向临时文件，验证 research_worker_started/done 落痕
 *
 * 验证：
 * 1. worker 正常链路：工具白名单可见 + 结构化返回解析 + evidence 带溯源
 * 2. 执行层硬闸：白名单外工具（fill_input）不可见也不可执行
 * 3. maxSteps 兜底：无限工具循环 → 强制收敛 → 降级为不充分而非挂死
 * 4. Abort 级联：父级 signal 取消 → worker 抛 ABORTED
 * 5. workflow 集成（subagentMode）：State 形状与旧管线一致（compare/report/verify 零感知）
 * 6. 重试语义：gap 提示 + 已读页面去重 + 死胡同兜底
 */

// ===== mock 基建 =====

/**
 * mock LLM：按 systemPrompt 分派
 * - '规划' → plan 节点；'事实核查' → verify 节点；'调研 worker' → worker 轮次序列
 * - '调研助手'（旧管线单页 grade）只计数不响应——子 agent 模式下它不应被调用
 */
function createMockLLM({ plan = null, workerRounds = [], report = '# 报告', verify = null } = {}) {
  let workerCall = 0
  return {
    legacyGradeCalls: 0,
    workerCalls: [], // 每次 worker chatStream 的 {prompt, toolNames}（LLM 可见工具断言用）
    workerDispatches: [], // 真正的 worker 派发次数（末条消息为初始"研究子问题"提示词的那次）
    async chat(messages, tools, systemPrompt) {
      if (systemPrompt && systemPrompt.includes('规划')) {
        return { role: 'assistant', content: JSON.stringify(plan) }
      }
      if (systemPrompt && systemPrompt.includes('事实核查')) {
        return { role: 'assistant', content: verify ? JSON.stringify(verify) : 'x' }
      }
      if (systemPrompt && systemPrompt.includes('调研助手')) this.legacyGradeCalls++
      return { role: 'assistant', content: 'x' }
    },
    async chatStream(messages, toolDefs, systemPrompt, onToken) {
      if (systemPrompt && systemPrompt.includes('调研 worker')) {
        const lastContent = messages[messages.length - 1].content
        this.workerCalls.push({
          prompt: lastContent,
          toolNames: (toolDefs || []).map((t) => t.name),
        })
        if (typeof lastContent === 'string' && lastContent.startsWith('研究子问题：')) {
          this.workerDispatches.push(lastContent)
        }
        const round = workerRounds[Math.min(workerCall, workerRounds.length - 1)]
        workerCall++
        return round
      }
      if (typeof onToken === 'function') onToken(String(report).slice(0, 5))
      return { role: 'assistant', content: report }
    },
  }
}

// 工具调用轮 / 最终 JSON 轮（OpenAI 响应形状，Agent 的流式拼装产物等价物）
const toolCallRound = (name, args, id = 'call_1') => ({
  role: 'assistant',
  content: '',
  tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
})
const finalRound = (obj) => ({ role: 'assistant', content: JSON.stringify(obj) })

/**
 * 注册工具覆盖：web_search 固定返回两条结果；fetch_url 按 URL 返回正文；
 * fill_input 是"执行层硬闸"的 tripwire——白名单外工具若被执行会被发现
 */
function setupOverrides() {
  toolHandler.init({ manager: { send: () => {} } })
  const state = { fetchLog: [], fillCalled: false }
  toolHandler.setToolOverrides({
    web_search: async (args) => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            query: args.query,
            engine: 'bing',
            results: [
              { title: 'MCP 官方文档', url: 'https://example.com/mcp' },
              { title: 'MCP 解析', url: 'https://example.com/mcp-2' },
            ],
          }),
        },
      ],
    }),
    fetch_url: async (args) => {
      state.fetchLog.push(args.url)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              url: args.url,
              title: `页面-${args.url}`,
              content: `这是 ${args.url} 的正文内容。`,
              charCount: 50,
            }),
          },
        ],
      }
    },
    fill_input: async () => {
      state.fillCalled = true
      return { content: [{ type: 'text', text: '不应被执行' }] }
    },
  })
  return state
}

// ===== normalizeWorkerResult：parse + 校验 + 降级三件套 =====

test('normalize: 非对象输出降级为不充分 + fallback gap', () => {
  for (const bad of [null, undefined, '文本']) {
    const r = normalizeWorkerResult(bad, '调研结果无法解析')
    assert.strictEqual(r.sufficient, false)
    assert.strictEqual(r.gap, '调研结果无法解析')
    assert.deepStrictEqual(r.points, [])
  }
})

test('normalize: sufficient 必须有要点背书（声称充分但零产出 → 不充分）', () => {
  const r = normalizeWorkerResult({ sufficient: true, points: [], gap: '' }, '')
  assert.strictEqual(r.sufficient, false)
})

test('normalize: 裸字符串要点降级为无来源；文本去重；sources 兜底并入要点来源', () => {
  const r = normalizeWorkerResult(
    {
      sufficient: true,
      points: [
        '裸要点',
        { text: '带来源要点', url: 'https://example.com/a', title: '页面A' },
        { text: '带来源要点', url: 'https://example.com/a', title: '页面A' }, // 重复文本去重
      ],
      gap: '',
      sources: [], // sources 漏记 → 从 points 的 url 兜底并入
    },
    ''
  )
  assert.strictEqual(r.sufficient, true)
  assert.strictEqual(r.points.length, 2)
  assert.deepStrictEqual(r.points[0], { text: '裸要点', url: '', title: '' })
  assert.deepStrictEqual(r.sources, [{ url: 'https://example.com/a', title: '页面A', truncated: false }])
})

test('normalize: 失败记录过滤空 URL', () => {
  const r = normalizeWorkerResult(
    { failures: [{ url: 'https://x.com', reason: '超时' }, { reason: '无url' }] },
    ''
  )
  assert.strictEqual(r.failures.length, 1)
  assert.strictEqual(r.failures[0].reason, '超时')
})

// ===== runTopicAgent：worker 正常链路 =====

test('worker: 工具白名单可见 + 结构化返回解析 + 归属标签', async () => {
  setupOverrides()
  const llm = createMockLLM({
    workerRounds: [
      toolCallRound('web_search', { query: 'MCP 协议' }),
      toolCallRound('fetch_url', { url: 'https://example.com/mcp' }, 'call_2'),
      finalRound({
        sufficient: true,
        points: [{ text: 'MCP 是模型上下文协议', url: 'https://example.com/mcp', title: 'MCP 官方文档' }],
        gap: '',
        sources: [{ url: 'https://example.com/mcp', title: 'MCP 官方文档' }],
        failures: [],
      }),
    ],
  })
  const result = await runTopicAgent({ question: 'MCP 是什么' }, { llmInstance: llm, maxSteps: 6 })
  assert.strictEqual(result.sufficient, true)
  assert.strictEqual(result.points[0].url, 'https://example.com/mcp')
  assert.deepStrictEqual(result.sources, [
    { url: 'https://example.com/mcp', title: 'MCP 官方文档', truncated: false },
  ])
  assert.strictEqual(result.meta.agent, 'research-worker')
  assert.strictEqual(result.meta.iterations, 3)
  // LLM 只能看到白名单工具（提示词层收窄）
  for (const call of llm.workerCalls) {
    assert.deepStrictEqual([...call.toolNames].sort(), [...WORKER_TOOL_NAMES].sort())
  }
})

test('worker: 执行层硬闸——白名单外工具即使被要求也跳过不执行', async () => {
  const state = setupOverrides()
  const llm = createMockLLM({
    workerRounds: [
      // 模型幻觉出写工具 fill_input（不在 web_search/fetch_url 白名单内）
      toolCallRound('fill_input', { selector: '#x', value: 'y' }),
      finalRound({
        sufficient: true,
        points: [{ text: '要点', url: 'https://example.com/mcp', title: '页面' }],
      }),
    ],
  })
  const result = await runTopicAgent({ question: 'q' }, { llmInstance: llm })
  assert.strictEqual(state.fillCalled, false, '白名单外工具不应真实执行')
  assert.strictEqual(result.sufficient, true)
})

test('worker: maxSteps 兜底——无限工具循环强制收敛并降级为不充分', async () => {
  setupOverrides()
  const llm = createMockLLM({ workerRounds: [toolCallRound('web_search', { query: 'x' })] })
  const result = await runTopicAgent({ question: 'q' }, { llmInstance: llm, maxSteps: 3 })
  assert.strictEqual(result.sufficient, false)
  assert.strictEqual(result.gap, '调研结果无法解析')
  assert.strictEqual(result.meta.iterations, 3)
})

test('worker: 父级 abort 级联——signal 已取消时 worker 抛 ABORTED', async () => {
  setupOverrides()
  const llm = createMockLLM({ workerRounds: [toolCallRound('web_search', { query: 'x' })] })
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    runTopicAgent({ question: 'q' }, { llmInstance: llm, signal: controller.signal }),
    (e) => e.code === 'ABORTED'
  )
})

// ===== workflow 集成（subagentMode）=====

test('workflow 子agent模式: plan→worker→compare→report→verify 全链路，State 形状与旧管线一致', async () => {
  setupOverrides()
  const llm = createMockLLM({
    plan: {
      subQuestions: [
        { question: 'MCP 是什么', queries: ['MCP 协议'] },
        { question: 'A2A 是什么', queries: ['A2A 协议'] },
      ],
    },
    workerRounds: [
      // 主题 1：搜索 → 抓页 → 充分返回
      toolCallRound('web_search', { query: 'MCP 协议' }),
      toolCallRound('fetch_url', { url: 'https://example.com/mcp' }, 'call_2'),
      finalRound({
        sufficient: true,
        points: [{ text: '要点一', url: 'https://example.com/mcp', title: 'MCP 官方文档' }],
        gap: '',
        sources: [{ url: 'https://example.com/mcp', title: 'MCP 官方文档' }],
      }),
      // 主题 2：直接充分返回
      finalRound({
        sufficient: true,
        points: [{ text: '要点二', url: 'https://example.com/a2a', title: 'A2A 解析' }],
        gap: '',
        sources: [{ url: 'https://example.com/a2a', title: 'A2A 解析' }],
      }),
    ],
    report: '# 研究报告',
    verify: { claims: [{ claim: '要点一', supported: true, sourceIndex: 1 }] },
  })
  const nodes = []
  const workflow = new ResearchWorkflow(llm, {
    subagentMode: true,
    maxTopics: 2,
    maxAttempts: 2,
    checkpoint: false,
  })
  const result = await workflow.start('浏览器 Agent 技术调研', {
    connectionId: 1,
    onProgress: (p) => {
      if (p.node) nodes.push(p.node)
    },
  })

  assert.strictEqual(result.success, true)
  // 主题产出：与旧管线同一 State 形状（points 是字符串数组，供 compare/report 消费）
  assert.strictEqual(result.state.plan[0].sufficient, true)
  assert.deepStrictEqual(result.state.plan[0].points, ['要点一'])
  assert.deepStrictEqual(result.state.plan[1].points, ['要点二'])
  // evidence 带溯源（verify 节点据此逐条核查）
  assert.strictEqual(result.state.evidence[0].url, 'https://example.com/mcp')
  assert.strictEqual(result.state.evidence[1].url, 'https://example.com/a2a')
  assert.strictEqual(result.state.evidence[1].topic, 'A2A 是什么')
  // 来源跨主题合并
  const urls = result.state.sources.map((s) => s.url)
  assert.ok(urls.includes('https://example.com/mcp'))
  assert.ok(urls.includes('https://example.com/a2a'))
  // 旧管线的单页 grade 提示词不应被调用（编排权确实下移了）
  assert.strictEqual(llm.legacyGradeCalls, 0)
  // DAG：worker 工具节点 + 终态节点都上屏
  assert.ok(nodes.some((n) => n.action === 'worker_tool' && n.status === 'running'))
  assert.ok(nodes.filter((n) => n.action === 'worker_result').length === 2)
  // 观测落痕：worker 生命周期进 trace-log
  const trace = fs.readFileSync(process.env.TRACE_FILE, 'utf8')
  assert.ok(trace.includes('research_worker_started'))
  assert.ok(trace.includes('research_worker_done'))
})

test('workflow 子agent模式: 信息不足时带 gap 提示重试，已读页面去重', async () => {
  setupOverrides()
  const llm = createMockLLM({
    plan: { subQuestions: [{ question: 'MCP 是什么', queries: ['MCP 协议'] }] },
    workerRounds: [
      // 第一轮：读到一页但信息不足
      toolCallRound('fetch_url', { url: 'https://example.com/mcp' }, 'call_1'),
      finalRound({
        sufficient: false,
        points: [{ text: '要点A', url: 'https://example.com/mcp', title: '页面1' }],
        gap: '缺少生态现状',
        sources: [{ url: 'https://example.com/mcp', title: '页面1' }],
      }),
      // 第二轮：换页面补齐
      finalRound({
        sufficient: true,
        points: [{ text: '要点B', url: 'https://example.com/mcp-eco', title: '页面2' }],
        gap: '',
        sources: [{ url: 'https://example.com/mcp-eco', title: '页面2' }],
      }),
    ],
    report: '# 报告',
  })
  const workflow = new ResearchWorkflow(llm, {
    subagentMode: true,
    maxTopics: 1,
    maxAttempts: 2,
    checkpoint: false,
  })
  const result = await workflow.start('研究问题', { connectionId: 1 })
  assert.strictEqual(result.success, true)
  // worker 被派发两轮；第二轮提示词带缺口说明与已读页面（避免重复读取）
  assert.strictEqual(llm.workerDispatches.length, 2)
  assert.ok(llm.workerDispatches[1].includes('上一轮调研的信息缺口'))
  assert.ok(llm.workerDispatches[1].includes('缺少生态现状'))
  assert.ok(llm.workerDispatches[1].includes('已读取过的页面'))
  assert.ok(llm.workerDispatches[1].includes('https://example.com/mcp'))
  // 两轮要点累计归并
  assert.deepStrictEqual(result.state.plan[0].points, ['要点A', '要点B'])
})

test('workflow 子agent模式: 重试耗尽 → 死胡同兜底（不阻塞研究，失败如实披露）', async () => {
  setupOverrides()
  const llm = createMockLLM({
    plan: { subQuestions: [{ question: 'MCP 是什么', queries: ['MCP 协议'] }] },
    workerRounds: [
      finalRound({
        sufficient: false,
        points: [],
        gap: '搜索无可用结果',
        sources: [],
        failures: [{ url: 'https://example.com/dead', reason: '页面读取超时' }],
      }),
      finalRound({ sufficient: false, points: [], gap: '仍无可用来源', sources: [] }),
    ],
    report: '# 报告',
  })
  const workflow = new ResearchWorkflow(llm, {
    subagentMode: true,
    maxTopics: 1,
    maxAttempts: 2,
    checkpoint: false,
  })
  const result = await workflow.start('研究问题', { connectionId: 1 })
  // 死胡同不阻塞：带着"信息不足"进报告（hitlMode 默认 on-deadend，无 onAsk 时不打断）
  assert.strictEqual(result.success, true)
  assert.strictEqual(result.state.plan[0].sufficient, false)
  // 失败如实披露（recordFailure 的字段是 target，报告里逐条列出）
  assert.ok(result.state.failures.some((f) => f.target === 'https://example.com/dead'))
  // worker 终态节点为 failed（DAG 断言在集成测试里已覆盖，这里聚焦 State 收敛）
})

test('workflow 旧管线: 默认关闭子 agent 模式，行为不变（回归守卫）', async () => {
  const llm = createMockLLM({
    plan: { subQuestions: [{ question: 'MCP 是什么', queries: ['MCP 协议'] }] },
    workerRounds: [],
    report: '# 报告',
  })
  // 不传 subagentMode → 旧管线：research 节点会走 searchTopicUrls/fetchAndGradeTopic
  // 需要 toolCaller 注入（worker 的 handleToolCall 覆盖机制只服务子 agent 路径）
  const workflow = new ResearchWorkflow(llm, { maxTopics: 1, checkpoint: false })
  // 旧管线的搜+抓通过依赖注入 mock；grade 走 '调研助手' 提示词
  workflow.toolCall = async (name, args) => {
    if (name === 'web_search') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ results: [{ title: '结果', url: 'https://example.com/mcp' }] }),
          },
        ],
      }
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ url: args.url, title: '页面', content: '正文内容', charCount: 10 }),
        },
      ],
    }
  }
  // grade 充分 → 单主题直接进 compare/report
  llm.chat = async (messages, tools, systemPrompt) => {
    if (systemPrompt && systemPrompt.includes('规划')) {
      return {
        role: 'assistant',
        content: JSON.stringify({ subQuestions: [{ question: 'MCP 是什么', queries: ['MCP'] }] }),
      }
    }
    if (systemPrompt && systemPrompt.includes('调研助手')) {
      return {
        role: 'assistant',
        content: JSON.stringify({ sufficient: true, points: ['旧管线要点'], gap: '' }),
      }
    }
    return { role: 'assistant', content: 'x' }
  }
  const result = await workflow.start('研究问题', { connectionId: 1 })
  assert.strictEqual(result.success, true)
  assert.strictEqual(result.state.plan[0].sufficient, true)
  assert.deepStrictEqual(result.state.plan[0].points, ['旧管线要点'])
  // 子 agent 模式未启用：worker 轮次为零
  assert.strictEqual(llm.workerCalls.length, 0)
})
