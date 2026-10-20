const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createWriteMutex } = require('../src/tools/write-mutex.js')
const { createWorkingTabRegistry } = require('../src/tools/working-tabs.js')

/**
 * P16 并行安全单测：跨会话写互斥 + 会话工作 tab 粘性。
 * 锁不变量：FIFO 串行/等待超时可自纠/持锁者抛错仍释放；
 * 注册表不变量：按会话隔离/回捕更新/回合清理/连接前缀清理/LRU。
 */

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

test('writeMutex：互斥——同一时刻只有一个持有者', async () => {
  const m = createWriteMutex({})
  const order = []
  let release
  const gate = new Promise((r) => (release = r))
  const first = m.runExclusive(async () => {
    order.push('A-start')
    await gate
    order.push('A-end')
  })
  await delay(5)
  const second = m.runExclusive(async () => order.push('B'))
  assert.equal(m.isBusy(), true)
  assert.equal(m.queueLength(), 1)
  release()
  await Promise.all([first, second])
  assert.deepEqual(order, ['A-start', 'A-end', 'B'], 'B 等 A 释放后才执行')
})

test('writeMutex：FIFO 公平——按到达顺序拿锁', async () => {
  const m = createWriteMutex({})
  const order = []
  let release
  const gate = new Promise((r) => (release = r))
  const held = m.runExclusive(async () => {
    await gate
  })
  await delay(5)
  const p2 = m.runExclusive(async () => order.push('second'))
  const p3 = m.runExclusive(async () => order.push('third'))
  await delay(5)
  release()
  await Promise.all([held, p2, p3])
  assert.deepEqual(order, ['second', 'third'])
})

test('writeMutex：等待超时抛可自纠错误，不影响持锁者与后续排队', async () => {
  const m = createWriteMutex({ timeoutMs: 50 })
  let release
  const gate = new Promise((r) => (release = r))
  const held = m.runExclusive(async () => {
    await gate
  })
  await delay(5)
  await assert.rejects(
    m.runExclusive(async () => {}),
    /另一会话正在执行浏览器写操作.*稍后重试/
  )
  release()
  await held
  // 超时者被移出队列：后续照常拿锁
  let ran = false
  await m.runExclusive(async () => (ran = true))
  assert.equal(ran, true)
})

test('writeMutex：持锁者抛错仍释放，下一个照常执行', async () => {
  const m = createWriteMutex({})
  await assert.rejects(m.runExclusive(async () => {
    throw new Error('动作失败')
  }), /动作失败/)
  let ran = false
  await m.runExclusive(async () => (ran = true))
  assert.equal(ran, true)
})

test('workingTabs：按会话隔离，capture 更新，clear/前缀清理', () => {
  const reg = createWorkingTabRegistry({})
  reg.capture('1:sA', 101)
  reg.capture('1:sB', 202)
  assert.equal(reg.get('1:sA'), 101)
  assert.equal(reg.get('1:sB'), 202)
  // 同会话再次触碰更新
  reg.capture('1:sA', 111)
  assert.equal(reg.get('1:sA'), 111)
  // 非 tabId 不捕获
  reg.capture('1:sA', undefined)
  assert.equal(reg.get('1:sA'), 111)
  // 回合清理只清自己
  reg.clear('1:sA')
  assert.equal(reg.get('1:sA'), null)
  assert.equal(reg.get('1:sB'), 202)
  // 连接前缀清理
  reg.capture('2:sC', 303)
  reg.clearConnection('1')
  assert.equal(reg.get('1:sB'), null)
  assert.equal(reg.get('2:sC'), 303)
})

test('workingTabs：LRU 驱逐最久未用（get 刷新），上限内不驱逐', () => {
  const reg = createWorkingTabRegistry({ maxTabs: 2 })
  reg.capture('a', 1)
  reg.capture('b', 2)
  assert.equal(reg.get('a'), 1) // 刷新 a
  reg.capture('c', 3) // 超 cap → 驱逐 b（最久未用）
  assert.equal(reg.get('b'), null)
  assert.equal(reg.get('a'), 1)
  assert.equal(reg.get('c'), 3)
})
