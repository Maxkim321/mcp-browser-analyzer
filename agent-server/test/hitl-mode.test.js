const { test } = require('node:test')
const assert = require('node:assert/strict')
const { ResearchWorkflow } = require('../src/core/workflow.js')

/**
 * 分级 HITL 行为测试
 * 核心断言：默认模式（on-deadend）下，正常路径零打断；
 * 只有死胡同 / 预算告警这些"LLM 不该替用户拍板"的分叉才打断
 */

const PLAN = {
  subQuestions: [
    { question: '主题一', queries: ['q1'] },
    { question: '主题二', queries: ['q2'] },
  ],
}

/**
 * 构造 mock LLM + mock 工具
 * @param {object} opts - { sufficient: grade 是否判足, searchCountPerTopic: 每主题可搜出的 URL 数 }
 */
function createMocks({ sufficient = true } = {}) {
  let searchSeq = 0
  const llm = {
    async chat(messages) {
      const text = String(messages[0]?.content)
      if (text.startsWith('研究问题：')) {
        return { role: 'assistant', content: JSON.stringify(PLAN) }
      }
      if (text.includes('检索词') && text.includes('信息缺口')) {
        // 查询改写：给一个新检索词（tier 路由不影响行为）
        return { role: 'assistant', content: JSON.stringify(['改写后的检索词']) }
      }
      // grade
      return {
        role: 'assistant',
        content: JSON.stringify(sufficient ? { points: ['要点'], sufficient: true } : { points: ['要点'], sufficient: false, gap: '缺数据' }),
      }
    },
    async chatStream() {
      return { role: 'assistant', content: '## 报告\n完成' }
    },
  }
  const toolCaller = async (name, args) => {
    if (name === 'web_search') {
      searchSeq++
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ results: [{ title: `来源${searchSeq}`, url: `https://s.example.com/${searchSeq}` }] }),
          },
        ],
      }
    }
    // fetch_url
    return {
      content: [{ type: 'text', text: JSON.stringify({ url: args.url, title: '页面', content: '正文内容' }) }],
    }
  }
  return { llm, toolCaller }
}

test('hitl on-deadend（默认）: 正常路径全程零打断', async () => {
  const { llm, toolCaller } = createMocks({ sufficient: true })
  const asks = []
  const wf = new ResearchWorkflow(llm, { toolCaller, checkpoint: false })
  const result = await wf.start('研究问题', {
    onAsk: async (q, options) => {
      asks.push({ q, options })
      return { cancel: false, text: options?.[0] || '继续研究' }
    },
  })

  assert.strictEqual(result.success, true)
  assert.strictEqual(asks.length, 0, '两个主题都顺利调研完成，不应打断用户')
})

test('hitl on-deadend: 死胡同主题打断且提供止损选项，自定义方向可插队', async () => {
  const { llm, toolCaller } = createMocks({ sufficient: false })
  const asks = []
  const wf = new ResearchWorkflow(llm, { toolCaller, checkpoint: false, maxAttempts: 2 })
  const result = await wf.start('研究问题', {
    onAsk: async (q, options) => {
      asks.push({ q, options })
      // 第一次死胡同：插入新方向（新主题）；第二次：选择直接出报告
      return asks.length === 1
        ? { cancel: false, text: '补充调查方向' }
        : { cancel: true, text: '' }
    },
  })

  assert.ok(asks.length >= 2, '两个主题都死胡同 + 插入的方向也死胡同，应各问一次')
  assert.ok(asks[0].q.includes('信息仍不足'), '死胡同问题应说明信息不足')
  assert.deepEqual(asks[0].options, ['跳过继续', '直接出报告'])
  assert.ok(
    result.state.plan.some((t) => t.question === '补充调查方向'),
    '用户自定义方向应被插入为待调研主题'
  )
  assert.strictEqual(result.success, true)
  assert.strictEqual(result.state.step, 'done', '选择出报告后仍应产出报告')
})

test('hitl off: 死胡同也不打断，全程连跑', async () => {
  const { llm, toolCaller } = createMocks({ sufficient: false })
  const asks = []
  const wf = new ResearchWorkflow(llm, { toolCaller, checkpoint: false, hitlMode: 'off' })
  const result = await wf.start('研究问题', {
    onAsk: async (q) => {
      asks.push(q)
      return { cancel: false, text: '继续研究' }
    },
  })

  assert.strictEqual(result.success, true)
  assert.strictEqual(asks.length, 0, 'off 模式死胡同也不应打断')
})

test('hitl every-topic: 旧行为保留，每个主题推进后必问', async () => {
  const { llm, toolCaller } = createMocks({ sufficient: true })
  const asks = []
  const wf = new ResearchWorkflow(llm, { toolCaller, checkpoint: false, hitlMode: 'every-topic' })
  const result = await wf.start('研究问题', {
    onAsk: async (q) => {
      asks.push(q)
      return { cancel: false, text: '继续研究' }
    },
  })

  assert.strictEqual(result.success, true)
  assert.strictEqual(asks.length, 1, '2 个主题只在前 1 次推进后询问（最后一主题后已无"下一个"）')
  assert.ok(asks[0].includes('是否继续研究下一个主题'))
})

test('hitl on-deadend: 累计页数达预算上限时告警一次，继续后不重复问', async () => {
  const { llm, toolCaller } = createMocks({ sufficient: true })
  const asks = []
  const wf = new ResearchWorkflow(llm, {
    toolCaller,
    checkpoint: false,
    maxTotalPages: 1,
  })
  const result = await wf.start('研究问题', {
    onAsk: async (q) => {
      asks.push(q)
      return { cancel: false, text: '继续研究' }
    },
  })

  assert.strictEqual(result.success, true)
  assert.strictEqual(asks.length, 1, '预算告警只问一次')
  assert.ok(asks[0].includes('预算上限'))
  // 继续后研究正常跑完且两个主题都完成了调研（sources 各 +1）
  assert.strictEqual(result.state.sources.length, 2)
})

test('hitl on-deadend: 预算告警时选"直接出报告"立即收手', async () => {
  const { llm, toolCaller } = createMocks({ sufficient: true })
  const wf = new ResearchWorkflow(llm, { toolCaller, checkpoint: false, maxTotalPages: 1 })
  const result = await wf.start('研究问题', {
    onAsk: async () => ({ cancel: false, text: '直接出报告' }),
  })

  assert.strictEqual(result.success, true)
  assert.ok(result.state.sources.length < 2, '选择出报告后不应再调研剩余主题')
})

test('兼容旧参数: hitl:false → off，hitl:true → every-topic', async () => {
  const { llm, toolCaller } = createMocks({ sufficient: true })
  const off = new ResearchWorkflow(llm, { toolCaller, checkpoint: false, hitl: false })
  const legacy = new ResearchWorkflow(llm, { toolCaller, checkpoint: false, hitl: true })
  assert.strictEqual(off.hitlMode, 'off')
  assert.strictEqual(legacy.hitlMode, 'every-topic')
})
