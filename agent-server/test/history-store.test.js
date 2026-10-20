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

// ---- P13 任务锚定：压缩不得弄丢当前任务（自动投递长流程的实测故障）----

test('P13 锚定回插：任务被卷进压缩前缀时原文回插视图（首次长流程场景）', async () => {
  // 模拟自动投递：任务消息在前，后续全是快照类大 tool 消息（压缩边界必然越过任务）
  const snapshot = (i) => `第${i}屏元素快照 ` + '元'.repeat(150)
  const raw = [{ role: 'user', content: '搜索前端岗位并自动投递27届应届生岗位，遇到App引导必须停止' }]
  for (let i = 1; i <= 5; i++) {
    raw.push({ ...toolCallMsg, tool_calls: [{ ...toolCallMsg.tool_calls[0], id: `c${i}` }] })
    raw.push({ role: 'tool', tool_call_id: `c${i}`, content: snapshot(i) })
  }
  const store = new HistoryStore({ strategy: 'rolling-summary', tokenBudget: 120 })
  store.replace(raw)
  const { messages, compressed, anchor } = await store.deriveView({ summarize: async (t) => `摘要(${t.length})` })
  assert.ok(compressed > 0, '快照超预算应触发压缩')
  assert.strictEqual(messages[0].role, 'system')
  // 任务原文必须完整保留在视图里（不能只活在有损摘要中），且紧跟摘要之后
  assert.ok(messages[1].role === 'user' && messages[1].content.includes('27届应届生'), '任务原文应回插在摘要之后')
  // 回插与锚点互斥：任务已原文在场，不再发锚点
  assert.strictEqual(anchor, null)
  // raw 只追加不改写
  assert.strictEqual(store.raw.length, 11)
})

test('P13 任务锚点：任务留在尾部时视图末尾收到锚点（多轮场景）', async () => {
  const raw = [
    { role: 'user', content: '旧轮次问题 ' + '旧'.repeat(100) },
    toolCallMsg,
    { role: 'tool', tool_call_id: 'c1', content: '果'.repeat(100) },
    { role: 'assistant', content: '答'.repeat(100) },
    { role: 'user', content: '继续投递下一个岗位' },
    { role: 'assistant', content: 'a' },
  ]
  const store = new HistoryStore({ strategy: 'rolling-summary', tokenBudget: 60 })
  store.replace(raw)
  const { messages, compressed, anchor } = await store.deriveView({ summarize: async () => '摘要' })
  assert.ok(compressed > 0)
  assert.ok(typeof anchor === 'string' && anchor.includes('继续投递下一个岗位'), '任务在尾部时应发锚点重申')
  const last = messages[messages.length - 1]
  assert.strictEqual(last.role, 'user')
  assert.ok(last.content.includes('任务锚点'), '锚点应是视图末尾一条 user 消息')
  // 任务原文本身也还在视图尾部（锚点是重申，不是替代）
  assert.ok(messages.some((m) => m.role === 'user' && m.content === '继续投递下一个岗位'))
})

test('P13 锚定回插：缓存命中路径同样捞回缓存前缀内的任务（纯 tool 轮次）', async () => {
  // 自动投递的真实形态：任务之后全是 tool 循环、没有新 user 消息——
  // 任务始终是最后一条 user 消息且落在缓存前缀内，缓存命中也必须把它捞回
  const long = (ch) => ch.repeat(80)
  const seeded = [
    { role: 'user', content: '闲聊 ' + long('旧') },
    { role: 'assistant', content: long('复') },
    { role: 'user', content: '自动投递27届应届生岗位 ' + long('背') },
    toolCallMsg,
    { role: 'tool', tool_call_id: 'c1', content: long('果') },
    { role: 'assistant', content: 'a' },
  ]
  const store = new HistoryStore({ strategy: 'rolling-summary', tokenBudget: 100 })
  store.replace(seeded)
  const first = await store.deriveView({ summarize: async () => '摘要1' })
  assert.ok(first.compressed > 0)
  assert.ok(first.messages.some((m) => m.role === 'user' && m.content.includes('27届应届生')), '任务在压缩前缀内应被回插')

  // 追加一组小体积 tool 循环（不推远压缩边界 → 缓存命中）
  store.append(
    { ...toolCallMsg, tool_calls: [{ ...toolCallMsg.tool_calls[0], id: 'c2' }] },
    { role: 'tool', tool_call_id: 'c2', content: 'x' }
  )
  const second = await store.deriveView({ summarize: async () => '摘要2' })
  assert.strictEqual(second.cached, true, '边界未越过缓存前缀应命中缓存')
  assert.ok(second.messages.some((m) => m.role === 'user' && m.content.includes('27届应届生')), '缓存命中路径同样回插任务')
  // tool 组原子性不受回插影响
  for (let i = 1; i < second.messages.length; i++) {
    if (second.messages[i].role === 'tool') {
      const prev = second.messages[i - 1]
      assert.ok(prev.role === 'assistant' && Array.isArray(prev.tool_calls))
    }
  }
})

test('P13：未触发压缩时无锚点（不额外注入）', async () => {
  const store = new HistoryStore({ strategy: 'rolling-summary', tokenBudget: 10000 })
  store.replace(seededHistory())
  const { anchor } = await store.deriveView({ summarize: async () => '不该被调用' })
  assert.strictEqual(anchor, null)
})
