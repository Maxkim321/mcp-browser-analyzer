const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// TRACE_FILE 必须在 require workflow 之前设置（trace-log 模块加载时读取）；
// node --test 每文件独立进程，不污染其他测试。
process.env.TRACE_FILE = path.join(os.tmpdir(), `trace-routing-${Date.now()}.jsonl`)

const toolHandler = require('../src/tools/handler.js')
const { ResearchWorkflow } = require('../src/core/workflow.js')

/**
 * P6 管线路由（legacy/subagent/auto）+ 死胡同升级兜底 单测
 *
 * 验证：
 * 1. auto 路由：plan 标注 depth → shallow 主题走旧管线、deep 主题走子 agent，
 *    路由决策落 trace（research_routed 带 pipeline 字段）
 * 2. 升级兜底（预判错误的安全网）：shallow 主题死胡同前先派一次 worker，
 *    救回则不打扰用户；worker 也失败才升级为真死胡同，且每主题只升一次
 * 3. 回归守卫：depth 缺省按 shallow；legacy 模式忽略 depth 强制走旧管线
 */

// ===== mock 基建 =====

function createMockLLM({ plan, grade, workerRounds = [], report = '# 报告', verify = null, queries = ['补充检索词'] }) {
  let workerCall = 0
  return {
    legacyGradeCalls: 0,
    workerDispatches: [], // worker 真实派发次数（末条消息为初始"研究子问题"提示词）
    async chat(messages, tools, systemPrompt) {
      if (systemPrompt && systemPrompt.includes('规划')) {
        return { role: 'assistant', content: JSON.stringify(plan) }
      }
      if (systemPrompt && systemPrompt.includes('检索词优化')) {
        return { role: 'assistant', content: JSON.stringify(queries) }
      }
      if (systemPrompt && systemPrompt.includes('事实核查')) {
        return { role: 'assistant', content: verify ? JSON.stringify(verify) : 'x' }
      }
      if (systemPrompt && systemPrompt.includes('调研助手')) {
        this.legacyGradeCalls++
        return { role: 'assistant', content: JSON.stringify(grade) }
      }
      return { role: 'assistant', content: 'x' }
    },
    async chatStream(messages, toolDefs, systemPrompt, onToken) {
      if (systemPrompt && systemPrompt.includes('调研 worker')) {
        const last = messages[messages.length - 1].content
        if (typeof last === 'string' && last.startsWith('研究子问题：')) {
          this.workerDispatches.push(last)
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

const finalRound = (obj) => ({ role: 'assistant', content: JSON.stringify(obj) })

/** 旧管线工具注入（workflow.toolCall 依赖注入，与现有 workflow 测试同一手法） */
function setupLegacyToolCaller(workflow) {
  workflow.toolCall = async (name, args) => {
    if (name === 'web_search') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ results: [{ title: '结果', url: 'https://example.com/page' }] }),
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
}

/** 子 agent 路径工具覆盖（handler.setToolOverrides，评测同一机制） */
function setupOverrides() {
  toolHandler.init({ manager: { send: () => {} } })
  toolHandler.setToolOverrides({
    web_search: async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ results: [{ title: '官方规范', url: 'https://fixture.local/spec' }] }),
        },
      ],
    }),
    fetch_url: async (args) => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ url: args.url, title: '页面', content: `${args.url} 的正文`, charCount: 10 }),
        },
      ],
    }),
  })
}

// ===== auto 路由 =====

test('auto 路由: shallow 主题走旧管线，deep 主题走子 agent，决策落 trace', async () => {
  setupOverrides()
  const llm = createMockLLM({
    plan: {
      subQuestions: [
        { question: 'MCP 是什么', queries: ['MCP'], depth: 'shallow' },
        { question: '规范参数是多少', queries: ['规范'], depth: 'deep' },
      ],
    },
    grade: { sufficient: true, points: ['旧管线要点'], gap: '' },
    workerRounds: [
      finalRound({
        sufficient: true,
        points: [{ text: 'worker 要点', url: 'https://fixture.local/spec', title: '官方规范' }],
        gap: '',
        sources: [{ url: 'https://fixture.local/spec', title: '官方规范' }],
      }),
    ],
    report: '# 报告',
  })
  const workflow = new ResearchWorkflow(llm, { routingMode: 'auto', maxTopics: 2, checkpoint: false })
  setupLegacyToolCaller(workflow)
  const result = await workflow.start('研究问题', { connectionId: 1 })

  assert.strictEqual(result.success, true)
  assert.strictEqual(result.state.plan[0].sufficient, true)
  assert.strictEqual(result.state.plan[1].sufficient, true)
  assert.ok(llm.legacyGradeCalls > 0, 'shallow 主题应走旧管线 grade')
  assert.strictEqual(llm.workerDispatches.length, 1, '只有 deep 主题派 worker')
  const trace = fs.readFileSync(process.env.TRACE_FILE, 'utf8')
  assert.ok(trace.includes('"pipeline":"legacy"'), '路由决策应记录 legacy')
  assert.ok(trace.includes('"pipeline":"worker"'), '路由决策应记录 worker')
})

test('升级兜底: shallow 预判错误 → 死胡同前派 worker 救回，不打扰用户', async () => {
  setupOverrides()
  const llm = createMockLLM({
    plan: { subQuestions: [{ question: '规范参数是多少', queries: ['规范'], depth: 'shallow' }] },
    grade: { sufficient: false, points: ['旧管线要点'], gap: '答案在规范原文中' },
    workerRounds: [
      finalRound({
        sufficient: true,
        points: [{ text: '规范要点', url: 'https://fixture.local/spec', title: '官方规范' }],
        gap: '',
        sources: [{ url: 'https://fixture.local/spec', title: '官方规范' }],
      }),
    ],
    report: '# 报告',
  })
  const workflow = new ResearchWorkflow(llm, {
    routingMode: 'auto',
    maxTopics: 1,
    maxAttempts: 2,
    checkpoint: false,
  })
  setupLegacyToolCaller(workflow)
  // 救回后不应触发 deadend 打断——onAsk 间谍断言未被调用
  let asked = 0
  const result = await workflow.start('研究问题', {
    connectionId: 1,
    onAsk: async () => {
      asked++
      return { cancel: false, text: '继续研究' }
    },
  })
  assert.strictEqual(result.success, true)
  assert.strictEqual(result.state.plan[0].sufficient, true, '升级 worker 应救回主题')
  assert.strictEqual(llm.workerDispatches.length, 1)
  assert.strictEqual(asked, 0, '救回后不应打断用户')
  const trace = fs.readFileSync(process.env.TRACE_FILE, 'utf8')
  assert.ok(trace.includes('research_escalated'))
})

test('升级兜底: worker 也救不回 → 才算真死胡同，且每主题只升一次', async () => {
  setupOverrides()
  const llm = createMockLLM({
    plan: { subQuestions: [{ question: '规范参数', queries: ['规范'], depth: 'shallow' }] },
    grade: { sufficient: false, points: ['要点'], gap: '答案在规范原文中' },
    workerRounds: [
      finalRound({ sufficient: false, points: [], gap: '规范也读取失败', sources: [] }),
    ],
    report: '# 报告',
  })
  const workflow = new ResearchWorkflow(llm, {
    routingMode: 'auto',
    maxTopics: 1,
    maxAttempts: 2,
    checkpoint: false,
  })
  setupLegacyToolCaller(workflow)
  const result = await workflow.start('研究问题', { connectionId: 1 })
  assert.strictEqual(result.success, true)
  assert.strictEqual(result.state.plan[0].sufficient, false)
  assert.strictEqual(llm.workerDispatches.length, 1, '升级只发生一次（escalated 标记防重复）')
  const trace = fs.readFileSync(process.env.TRACE_FILE, 'utf8')
  assert.ok(trace.includes('"rescued":false'), '升级结果应留痕')
})

test('回归守卫: depth 缺省按 shallow；legacy 模式忽略 depth 强制旧管线', async () => {
  setupOverrides()
  // depth 缺省（老 checkpoint / plan 漏标）→ shallow → 旧管线
  const llm = createMockLLM({
    plan: { subQuestions: [{ question: '规范参数', queries: ['规范'] }] },
    grade: { sufficient: true, points: ['要点'], gap: '' },
    report: '# 报告',
  })
  const workflow = new ResearchWorkflow(llm, { routingMode: 'auto', maxTopics: 1, checkpoint: false })
  setupLegacyToolCaller(workflow)
  const result = await workflow.start('研究问题', { connectionId: 1 })
  assert.strictEqual(result.success, true)
  assert.strictEqual(llm.workerDispatches.length, 0, 'depth 缺省 → shallow → 旧管线')
  assert.ok(llm.legacyGradeCalls > 0)

  // legacy 模式即使 depth=deep 也不派 worker（三态守卫）
  const llm2 = createMockLLM({
    plan: { subQuestions: [{ question: '规范参数', queries: ['规范'], depth: 'deep' }] },
    grade: { sufficient: true, points: ['要点'], gap: '' },
    report: '# 报告',
  })
  const wf2 = new ResearchWorkflow(llm2, { routingMode: 'legacy', maxTopics: 1, checkpoint: false })
  setupLegacyToolCaller(wf2)
  const r2 = await wf2.start('研究问题', { connectionId: 1 })
  assert.strictEqual(r2.success, true)
  assert.strictEqual(llm2.workerDispatches.length, 0, 'legacy 模式不派 worker')
})
