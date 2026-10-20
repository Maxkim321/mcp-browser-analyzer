import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createTurnRegistry,
  appendTurnToken,
  finalizeTurnMessages,
  pickPersistable,
} from '../src/logic/turn-router.js'

/**
 * Turn 归属注册表单测（会话串台修复 + P15 服务端会话路由的客户端对端）：
 * bug 现场 = 回合进行中新建/切换会话，token 事件按"当前会话"落消息，
 * 旧回合的回答串进新会话。修复 = 回合事件按 sessionId 归属，切走后走缓冲、
 * 完成后落盘原会话；跨会话可并行（服务端多 Agent），各会话缓冲互不污染。
 * 这里锁注册表的状态机与消息定格/落盘过滤行为。
 */

const userMsg = (content) => ({ type: 'text', sender: 'user', content, timestamp: 1 })
const aiMsg = (content, extra = {}) => ({ type: 'text', sender: 'ai', content, timestamp: 2, ...extra })

test('归属判定：begin 后 has/busyIds 正确；end 移除；reset 全清', () => {
  const reg = createTurnRegistry()
  assert.equal(reg.has('s1'), false)
  reg.begin('s1', '标题')
  reg.begin('s2')
  assert.equal(reg.has('s1'), true)
  assert.deepEqual(reg.busyIds().sort(), ['s1', 's2'])
  const finished = reg.end('s1')
  assert.equal(finished.title, '标题')
  assert.equal(reg.has('s1'), false)
  reg.reset()
  assert.deepEqual(reg.busyIds(), [])
})

test('detach：截取最后一条用户消息之后的消息，并从原数组移除', () => {
  const reg = createTurnRegistry()
  reg.begin('s1')
  const messages = [userMsg('旧问题'), aiMsg('旧回答'), userMsg('新问题'), aiMsg('', { streaming: true })]
  const buffer = reg.detach('s1', messages)
  assert.equal(messages.length, 3)
  assert.equal(buffer.length, 1)
  assert.equal(buffer[0].streaming, true)
})

test('detach：isLocalNotice（停止生成回显）不作回合边界', () => {
  const reg = createTurnRegistry()
  reg.begin('s1')
  const messages = [
    userMsg('问题'),
    aiMsg('', { streaming: true }),
    { ...userMsg('停止生成'), isLocalNotice: true },
  ]
  const buffer = reg.detach('s1', messages)
  assert.equal(messages.length, 1)
  assert.equal(buffer.length, 2)
  assert.equal(buffer[0].streaming, true)
})

test('attach→detach 循环：切走再切回再切走，缓冲从实时数组重新截取不丢不重', () => {
  const reg = createTurnRegistry()
  reg.begin('s1')
  const messages = [userMsg('问题')]
  // 回合产生的两条消息已进 messages（前台直写期）
  messages.push(aiMsg('第一段', { streaming: true }))
  // 切走：抽离
  let buffer = reg.detach('s1', messages)
  assert.equal(messages.length, 1)
  assert.equal(buffer.length, 1)
  // 后台 token 增量写缓冲
  appendTurnToken(buffer, '，第二段')
  // 切回：并回，后台事件恢复直写（缓冲引用换新数组，旧引用不残留内容语义）
  reg.attach('s1', messages)
  assert.equal(reg.record('s1').buffer.length, 0)
  assert.equal(messages.length, 2)
  assert.equal(messages[1].content, '第一段，第二段')
  // 再切走：重新截取，之前并回的内容不丢不重
  buffer = reg.detach('s1', messages)
  assert.equal(messages.length, 1)
  assert.equal(buffer.length, 1)
  assert.equal(buffer[0].content, '第一段，第二段')
})

test('多会话并行：两个后台回合的缓冲互不污染', () => {
  const reg = createTurnRegistry()
  reg.begin('A', '会话A')
  reg.begin('B', '会话B')
  appendTurnToken(reg.record('A').buffer, 'A 的回答')
  appendTurnToken(reg.record('B').buffer, 'B 的回答')
  assert.equal(reg.record('A').buffer[0].content, 'A 的回答')
  assert.equal(reg.record('B').buffer[0].content, 'B 的回答')
  // A 结束不影响 B
  const a = reg.end('A')
  assert.equal(a.title, '会话A')
  assert.equal(reg.has('B'), true)
  assert.equal(reg.record('B').buffer[0].content, 'B 的回答')
})

test('appendTurnToken：无流式消息则创建，有则续写；卡片打断后再来 token 新开一条', () => {
  const buffer = []
  appendTurnToken(buffer, '你好')
  appendTurnToken(buffer, '，世界')
  assert.equal(buffer.length, 1)
  assert.equal(buffer[0].content, '你好，世界')
  assert.equal(buffer[0].streaming, true)
  // 中间插了一张卡片（如后台等待审批）
  buffer.push({ type: 'write_approval', sender: 'ai' })
  appendTurnToken(buffer, '新的一句')
  assert.equal(buffer.length, 3)
  assert.equal(buffer[2].content, '新的一句')
})

test('finalizeTurnMessages：成功用最终内容覆盖增量；失败保留增量并追加错误行', () => {
  const ok = finalizeTurnMessages([aiMsg('部分内', { streaming: true })], {
    success: true,
    content: '最终完整内容',
  })
  assert.equal(ok.length, 1)
  assert.equal(ok[0].content, '最终完整内容')
  assert.equal(ok[0].streaming, false)

  const bad = finalizeTurnMessages([aiMsg('部分内', { streaming: true })], {
    success: false,
    content: '已停止本次回答。',
    error: 'cancelled',
  })
  assert.equal(bad[0].content, '部分内\n\n错误: 已停止本次回答。')
  assert.equal(bad[0].streaming, false)
})

test('finalizeTurnMessages：无流式消息时补全量消息（成功带引用/档位，失败补错误）', () => {
  const ok = finalizeTurnMessages([], { success: true, content: '秒回', memory_refs: ['m1'], meta: { tier: 'light' } })
  assert.equal(ok.length, 1)
  assert.deepEqual(ok[0].memoryRefs, ['m1'])
  assert.deepEqual(ok[0].tierMeta, { tier: 'light' })

  const bad = finalizeTurnMessages([], { success: false, error: 'boom' })
  assert.equal(bad.length, 1)
  assert.equal(bad[0].content, '错误: boom')

  // 成功但无内容（纯工具回合无输出）：不补空消息
  assert.equal(finalizeTurnMessages([], { success: true, content: '' }).length, 0)
})

test('finalizeTurnMessages：不改动传入缓冲（拷贝后定格）', () => {
  const buffer = [aiMsg('部分', { streaming: true })]
  finalizeTurnMessages(buffer, { success: true, content: '完整' })
  assert.equal(buffer[0].content, '部分')
  assert.equal(buffer[0].streaming, true)
})

test('pickPersistable：审批卡与半条流式残影不落盘，其余保留', () => {
  const msgs = [
    userMsg('问题'),
    { type: 'write_approval', sender: 'ai' },
    aiMsg('回答', { trace: [] }),
    aiMsg('半条', { streaming: true }),
  ]
  const kept = pickPersistable(msgs)
  assert.deepEqual(
    kept.map((m) => m.content),
    ['问题', '回答']
  )
})

test('discard：删除归属会话后回合跑完不落盘（discarded 标记），end 取出', () => {
  const reg = createTurnRegistry()
  reg.begin('s1', '标题')
  reg.discard('s1')
  const finished = reg.end('s1')
  assert.equal(finished.discarded, true)
  assert.equal(finished.title, '标题')
  assert.equal(reg.has('s1'), false)
})

test('detach/attach/end：无记录的会话调用是空操作', () => {
  const reg = createTurnRegistry()
  const messages = [userMsg('问题'), aiMsg('回答')]
  assert.deepEqual(reg.detach('nope', messages), [])
  assert.equal(messages.length, 2)
  reg.attach('nope', messages)
  assert.equal(messages.length, 2)
  assert.equal(reg.end('nope'), null)
})
