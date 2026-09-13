const { test } = require('node:test')
const assert = require('node:assert/strict')
const { HistoryStore } = require('../src/core/history-store.js')

/**
 * dph-C 派生视图测试：raw 只追加不改写，视图按策略派生
 * 旧模型的故障（原地压缩切坏 tool 组）在新模型里由"出口对齐 + 组原子性"双重防御
 */

const toolCallMsg = {
  role: 'assistant',
  content: null,
  tool_calls: [{ id: 'c1', type: 'function', function: { name: 't', arguments: '{}' } }],
}

function seededHistory() {
  return [
    { role: 'user', content: '第一轮问题' },
    toolCallMsg,
    { role: 'tool', tool_call_id: 'c1', content: '工具结果' },
    { role: 'assistant', content: '第一轮回答' },
    { role: 'user', content: '第二轮问题' },
    { role: 'assistant', content: '第二轮回答' },
  ]
}

test('no-compress: 视图等于 raw，且 raw 不被派生改写', async () => {
  const store = new HistoryStore({ strategy: 'no-compress', tokenBudget: 5 })
  store.replace(seededHistory())
  const { messages, compressed } = await store.deriveView()
  assert.strictEqual(compressed, 0)
  assert.strictEqual(messages.length, store.raw.length)
  // 派生后再 derive，raw 仍是完整 6 条（旧模型会把它压缩掉）
  await store.deriveView()
  assert.strictEqual(store.raw.length, 6)
})

test('rolling-summary: 超预算时摘要+保留尾部，剩余视图不以孤儿 tool 开头', async () => {
  const store = new HistoryStore({ strategy: 'rolling-summary', tokenBudget: 5 })
  store.replace(seededHistory())
  const summarizeCalls = []
  const { messages, compressed } = await store.deriveView({
    summarize: async (text) => {
      summarizeCalls.push(text)
      return `摘要(${text.length})`
    },
  })
  assert.ok(compressed > 0, '小预算应触发压缩')
  assert.strictEqual(messages[0].role, 'system')
  assert.ok(messages[0].content.includes('早期对话摘要'))
  assert.notStrictEqual(messages[1] && messages[1].role, 'tool')
  // 原子性：tool 结果不能作为视图开头独立存在（要么随组压缩，要么跟完整组保留）
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].role === 'tool') {
      const prev = messages[i - 1]
      assert.ok(prev.role === 'assistant' && Array.isArray(prev.tool_calls))
    }
  }
  assert.ok(summarizeCalls.length === 1)
})

test('rolling-summary: 缓存复用——raw 增长但边界未越过已压缩前缀时不再重新摘要', async () => {
  // 确定性尺寸：前 4 条每条 ~80 token（会被压缩），尾部 2 条各 1 token（热消息）
  const long = (ch) => ch.repeat(80)
  const seeded = [
    { role: 'user', content: long('早') },
    toolCallMsg,
    { role: 'tool', tool_call_id: 'c1', content: long('果') },
    { role: 'assistant', content: long('答') },
    { role: 'user', content: 'q' },
    { role: 'assistant', content: 'a' },
  ]
  const store = new HistoryStore({ strategy: 'rolling-summary', tokenBudget: 100 })
  store.replace(seeded)
  let calls = 0
  const summarize = async () => {
    calls++
    return `摘要${calls}`
  }
  const first = await store.deriveView({ summarize })
  assert.ok(first.compressed > 0)
  assert.strictEqual(calls, 1)
  const prefixLen = store._cache.prefixLen

  // 追加 2 条短消息：总 token 超预算但边界 count 不超过已压缩前缀 → 缓存命中
  store.append({ role: 'user', content: 'q2' }, { role: 'assistant', content: 'a2' })
  const second = await store.deriveView({ summarize })
  assert.strictEqual(calls, 1, '缓存命中时不应再次调用摘要')
  assert.strictEqual(second.cached, true)
  assert.strictEqual(store._cache.prefixLen, prefixLen)
  assert.ok(second.messages[0].content.includes('摘要1'))
  // 新消息必须出现在视图里
  assert.ok(second.messages.some((m) => m.content === 'a2'))
})

test('truncate: 对照策略直接丢最老消息，不生成摘要', async () => {
  const store = new HistoryStore({ strategy: 'truncate', tokenBudget: 5 })
  store.replace(seededHistory())
  const { messages, compressed } = await store.deriveView({ summarize: async () => '不该被调用' })
  assert.ok(compressed > 0)
  assert.ok(!messages.some((m) => m.role === 'system' && m.content.includes('摘要')))
  assert.notStrictEqual(messages[0] && messages[0].role, 'tool', 'truncate 出口同样不能有孤儿 tool')
})

test('trimRaw: 头部裁剪对齐 tool 组并使缓存失效', async () => {
  const store = new HistoryStore({ rawLimit: 4, strategy: 'rolling-summary', tokenBudget: 5 })
  store.replace(seededHistory())
  await store.deriveView({ summarize: async () => '旧摘要' })
  assert.ok(store._cache, '压缩后应有缓存')

  store.append({ role: 'user', content: 'x1' }, { role: 'assistant', content: 'x2' }, { role: 'user', content: 'x3' })
  // 6+3=9 条 > rawLimit 4 → 头部裁剪；起点落在 tool 上时对齐
  assert.ok(store.raw.length <= 5)
  assert.notStrictEqual(store.raw[0] && store.raw[0].role, 'tool', 'raw 头部不能是孤儿 tool')
  assert.strictEqual(store._cache, null, 'raw 前缀变化后缓存必须失效')
})
