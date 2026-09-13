const path = require('node:path')
const os = require('node:os')
// 测试隔离：必须在 require trace-log 之前设置（模块加载时固化路径），
// 否则测试的 readall_probe 会写进真实 trace-log.jsonl 污染 dashboard 数据
process.env.TRACE_FILE = path.join(os.tmpdir(), `trace-log-test-${process.pid}.jsonl`)
const { test, describe, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const traceLog = require('../src/core/trace-log.js')
const usageTracker = require('../src/core/usage-tracker.js')
const { summarize, costOf } = require('../src/core/usage-stats.js')

/**
 * 运行时可观测三件套：trace-log（事件留痕）/ usage-tracker（实时聚合）/ usage-stats（账本聚合）
 */

// ===== trace-log =====

describe('trace-log', () => {
  beforeEach(() => traceLog.resetMemory())

  test('record：事件带时间戳，进内存环形缓冲', () => {
    const entry = traceLog.record({ type: 'llm_retry', attempt: 1 })
    assert.equal(entry.type, 'llm_retry')
    assert.ok(entry.ts, '应带 ts')
    assert.equal(traceLog.recent().length, 1)
    assert.equal(traceLog.recent()[0].attempt, 1)
  })

  test('环形缓冲：超过上限丢弃最老的（内存态不无限增长）', () => {
    for (let i = 0; i < 210; i++) traceLog.record({ type: 'x', i })
    const ring = traceLog.recent(1000)
    assert.equal(ring.length, 200)
    assert.equal(ring[0].i, 10, '最老 10 条应被挤出')
    assert.equal(ring[ring.length - 1].i, 209)
  })

  test('readAll：能从文件回放历史事件（append-only 不改写）', () => {
    traceLog.record({ type: 'readall_probe', marker: 'trace-log-test' })
    const all = traceLog.readAll()
    assert.ok(all.some((e) => e.type === 'readall_probe' && e.marker === 'trace-log-test'))
  })
})

// ===== usage-tracker =====

describe('usage-tracker', () => {
  beforeEach(() => usageTracker.reset())

  const call = (over = {}) => ({
    model: 'deepseek-chat',
    tier: null,
    prompt_tokens: 1000,
    completion_tokens: 100,
    ...over,
  })

  test('record：未绑定时归到 unattributed，全局累计正确', () => {
    usageTracker.record(call())
    usageTracker.record(call())
    const total = usageTracker.totalsSnapshot()
    assert.equal(total.calls, 2)
    assert.equal(total.promptTokens, 2000)
    assert.equal(total.completionTokens, 200)
    assert.ok(total.cost > 0, '按单价表应算出成本')
    assert.equal(usageTracker.summaryFor(1).calls, 0, '未绑定连接不串账')
  })

  test('bindConnection：会话归因 + light 档占比', () => {
    usageTracker.bindConnection(7)
    usageTracker.record(call({ tier: 'light' }))
    usageTracker.record(call())
    const s = usageTracker.summaryFor(7)
    assert.equal(s.calls, 2)
    assert.equal(s.byTier.light.calls, 1)
    assert.equal(usageTracker.lightShare(s), 50)
    assert.equal(usageTracker.totalsSnapshot().calls, 2)
  })

  test('reset：清空内存态', () => {
    usageTracker.bindConnection(1)
    usageTracker.record(call())
    usageTracker.reset()
    assert.equal(usageTracker.totalsSnapshot().calls, 0)
    assert.equal(usageTracker.summaryFor(1).calls, 0)
  })
})

// ===== usage-stats（与 cost-report 同源的聚合算法） =====

describe('usage-stats', () => {
  const pricing = { 'm-a': { input: 2, output: 8 } } // 元/百万 token

  test('costOf：input/output 分开计价', () => {
    // 1M input * 2 + 1M output * 8 = 10 元
    assert.equal(costOf({ model: 'm-a', prompt_tokens: 1e6, completion_tokens: 1e6 }, pricing), 10)
    assert.equal(
      costOf({ model: 'unknown-model', prompt_tokens: 1e6 }, pricing),
      0,
      '未配价模型不瞎算'
    )
  })

  test('summarize：按档位/模型/日聚合，tier 缺省归 main', () => {
    const entries = [
      {
        model: 'm-a',
        tier: 'light',
        prompt_tokens: 500000,
        completion_tokens: 0,
        ts: '2026-09-12T01:00:00Z',
      },
      {
        model: 'm-a',
        tier: null,
        prompt_tokens: 500000,
        completion_tokens: 1000000,
        ts: '2026-09-12T02:00:00Z',
      },
      {
        model: 'm-a',
        tier: 'light',
        prompt_tokens: 0,
        completion_tokens: 0,
        ts: '2026-09-11T03:00:00Z',
      },
    ]
    const s = summarize(entries, pricing)
    assert.equal(s.totals.calls, 3)
    assert.equal(s.totals.cost, 10) // 1M input*2 + 1M output*8
    const light = s.byTier.find((t) => t.key === 'light')
    const main = s.byTier.find((t) => t.key === 'main')
    assert.equal(light.calls, 2)
    assert.equal(main.calls, 1)
    assert.equal(s.byDay.length, 2, '跨两天按日分桶')
    assert.equal(s.byDay[0].key, '2026-09-11', '按日升序')
    assert.equal(s.byModel.length, 1)
  })
})
