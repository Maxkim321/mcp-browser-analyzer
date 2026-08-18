const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const eventLog = require('../src/core/event-log.js')

const DATA_DIR = path.join(__dirname, '../data/events')

test('dph-B: append + get 保持写入顺序', () => {
  const sid = `test-${Date.now()}`
  eventLog.appendEvent(sid, 'user', '你好')
  eventLog.appendEvent(sid, 'assistant', '你好！有什么可以帮你？')
  eventLog.appendEvent(sid, 'user', '总结一下')
  const events = eventLog.getEvents(sid)
  assert.strictEqual(events.length, 3)
  assert.strictEqual(events[0].type, 'user')
  assert.strictEqual(events[0].content, '你好')
  assert.strictEqual(events[1].type, 'assistant')
  assert.strictEqual(events[2].type, 'user')
  assert.ok(events[0].ts > 0)
  // 清理
  fs.rmSync(path.join(DATA_DIR, `${sid}.jsonl`), { force: true })
})

test('dph-B: 空/无效 sessionId 与空内容不写入', () => {
  const before = fs.readdirSync(DATA_DIR).length
  eventLog.appendEvent('', 'user', 'x')
  eventLog.appendEvent('sid-x', 'user', '   ')
  eventLog.appendEvent('sid-x', 'assistant', undefined)
  assert.strictEqual(fs.readdirSync(DATA_DIR).length, before)
  // 非法字符 sessionId 被过滤成安全文件名
  eventLog.appendEvent('a/b', 'user', 'ok')
  assert.ok(fs.existsSync(path.join(DATA_DIR, 'a_b.jsonl')))
  fs.rmSync(path.join(DATA_DIR, 'a_b.jsonl'), { force: true })
})

test('dph-B: projectToHistory 投影为 OpenAI 交替消息', () => {
  const history = eventLog.projectToHistory([
    { type: 'user', content: 'Q1' },
    { type: 'user', content: 'Q2' }, // 连续 user 应合并
    { type: 'assistant', content: 'A1' },
    { type: 'assistant', content: '   ' }, // 空内容应跳过
  ])
  assert.deepStrictEqual(history, [
    { role: 'user', content: 'Q1\nQ2' },
    { role: 'assistant', content: 'A1' },
  ])
})

test('dph-B: 断点续跑（崩溃重启后重建上下文）', () => {
  const sid = `test-recover-${Date.now()}`
  // 第一段对话
  eventLog.appendEvent(sid, 'user', '我上次问了什么？')
  eventLog.appendEvent(sid, 'assistant', '你问我上次问了什么。')
  // 模拟重启：从事件投影
  const events = eventLog.getEvents(sid)
  const history = eventLog.projectToHistory(events)
  assert.strictEqual(history.length, 2)
  assert.strictEqual(history[0].role, 'user')
  assert.strictEqual(history[1].role, 'assistant')
  assert.strictEqual(history[1].content, '你问我上次问了什么。')
  // 清理
  fs.rmSync(path.join(DATA_DIR, `${sid}.jsonl`), { force: true })
})
