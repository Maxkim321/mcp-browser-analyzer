const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createConnectionSessions } = require('../src/communication/session-registry.js')

/**
 * P15 会话注册表单测：Agent 生命周期绑定 sessionId。
 * 锁不变量：会话上下文隔离 / 会话内回合串行且跨会话并行 / LRU 只驱逐空闲会话 /
 * restore 替换语义幂等 / 取消精确到会话。
 */

const stubAgent = () => ({
  history: [],
  clearHistory() {
    this.history = []
  },
  restoreHistory(h) {
    this.history = [...(h || [])]
    return this.history.length
  },
})

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

test('getOrCreate：同会话复用同一 Agent，不同会话各自实例', () => {
  let created = 0
  const reg = createConnectionSessions({ createAgent: () => (created++, stubAgent()) })
  const a1 = reg.getOrCreate('s1')
  const a2 = reg.getOrCreate('s1')
  const b1 = reg.getOrCreate('s2')
  assert.equal(created, 2)
  assert.equal(a1, a2)
  assert.notEqual(a1, b1)
})

test('LRU：超过上限驱逐最久未用的空闲会话；运行中/排队中的不驱逐', async () => {
  const reg = createConnectionSessions({ createAgent: () => stubAgent(), maxSessions: 2 })
  const a = reg.getOrCreate('s1')
  reg.getOrCreate('s2')
  await delay(5)
  // s1 有运行中回合 → 创建 s3 时应驱逐 s2（s1 忙不驱逐）
  reg.registerTurn('s1', new AbortController())
  reg.getOrCreate('s3')
  assert.equal(reg.get('s1'), a, '运行中回合的会话不被驱逐')
  assert.equal(reg.get('s2'), null, '最久未用的空闲会话被驱逐')

  // 全忙：允许暂时超限，不驱逐
  reg.registerTurn('s3', new AbortController())
  reg.getOrCreate('s4')
  assert.equal(reg.size(), 3)
})

test('enqueueTurn：同会话串行，跨会话并行', async () => {
  const reg = createConnectionSessions({ createAgent: () => stubAgent() })
  const order = []
  let releaseA
  const gateA = new Promise((r) => (releaseA = r))
  // 会话 A 的回合先占住（挂起）
  reg.enqueueTurn('A', async () => {
    order.push('A-start')
    await gateA
    order.push('A-end')
  })
  await delay(5)
  // 会话 A 排第二个、会话 B 同时进——B 不该被 A 阻塞
  reg.enqueueTurn('A', async () => order.push('A2'))
  reg.enqueueTurn('B', async () => order.push('B'))
  await delay(20)
  assert.deepEqual(order, ['A-start', 'B'], '跨会话并行：B 不等 A')
  releaseA()
  await delay(20)
  assert.deepEqual(order, ['A-start', 'B', 'A-end', 'A2'], '同会话串行：A2 等 A-end')
})

test('enqueueTurn：同会话积压超过上限拒绝（busy），前一个失败不阻断后续', async () => {
  const reg = createConnectionSessions({ createAgent: () => stubAgent() })
  let release
  const gate = new Promise((r) => (release = r))
  reg.enqueueTurn('A', async () => {
    throw new Error('回合失败')
  })
  reg.enqueueTurn('A', async () => {
    await gate
  })
  const third = reg.enqueueTurn('A', async () => {})
  // 第一个正在执行、第二个排队 → 第三到已达 MAX_QUEUED_PER_SESSION 上限
  assert.equal(third.ok, false)
  assert.equal(third.reason, 'busy')
  release()
  await delay(20)
  // 失败不阻断：后续回合照常执行
  let ran = false
  reg.enqueueTurn('A', async () => (ran = true))
  await delay(20)
  assert.equal(ran, true)
})

test('取消精确到会话：abortTurn 只停目标会话', async () => {
  const reg = createConnectionSessions({ createAgent: () => stubAgent() })
  const c1 = new AbortController()
  const c2 = new AbortController()
  reg.registerTurn('s1', c1)
  reg.registerTurn('s2', c2)
  assert.equal(reg.hasActiveTurn('s1'), true)
  assert.equal(reg.abortTurn('s1'), true)
  assert.equal(c1.signal.aborted, true)
  assert.equal(c2.signal.aborted, false, '其他会话不受影响')
  assert.equal(reg.abortTurn('s1'), false, '再取消一次无回合可停')
  assert.deepEqual(reg.abortAllTurns(), ['s2'])
  assert.equal(reg.hasActiveTurn('s2'), false)
})

test('restoreSession 替换语义幂等；clearSession/clearAll/dispose', () => {
  const reg = createConnectionSessions({ createAgent: () => stubAgent() })
  const agent = reg.getOrCreate('s1')
  agent.history = [{ role: 'user', content: '旧的' }]
  const n = reg.restoreSession('s1', [{ role: 'user', content: '新的' }])
  assert.equal(n, 1)
  assert.deepEqual(agent.history, [{ role: 'user', content: '新的' }], '替换而非追加')
  // 再次 restore 同内容：仍是一条（幂等，不会翻倍）
  reg.restoreSession('s1', [{ role: 'user', content: '新的' }])
  assert.equal(agent.history.length, 1)

  reg.clearSession('s1')
  assert.equal(agent.history.length, 0)
  reg.getOrCreate('s2').history = [{ role: 'user', content: 'x' }]
  reg.clearAll()
  assert.equal(reg.get('s2').history.length, 0)

  reg.registerTurn('s3', new AbortController())
  reg.dispose()
  assert.equal(reg.hasActiveTurn('s3'), false, 'dispose 取消全部回合')
  assert.equal(reg.size(), 0)
})
