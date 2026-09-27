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

// ===== seq 主键（事件寻址：部分重放/增量投影/完整性校验的地基） =====

test('dph-B seq: 追加时分配单调递增序号并持久化落盘', () => {
  const sid = `test-seq-${Date.now()}`
  eventLog.appendEvent(sid, 'user', 'q1')
  eventLog.appendEvent(sid, 'assistant', 'a1')
  eventLog.appendEvent(sid, 'user', 'q2')

  const events = eventLog.getEvents(sid)
  assert.deepStrictEqual(
    events.map((e) => e.seq),
    [1, 2, 3]
  )
  // 落盘行里真带 seq（不是读取时才补的）
  const raw = fs
    .readFileSync(path.join(DATA_DIR, `${sid}.jsonl`), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
  assert.deepStrictEqual(
    raw.map((e) => e.seq),
    [1, 2, 3]
  )
  fs.rmSync(path.join(DATA_DIR, `${sid}.jsonl`), { force: true })
})

test('dph-B seq: 旧格式行（无 seq）按位置补齐，新旧行混存序号不回退', () => {
  const sid = `test-seq-legacy-${Date.now()}`
  const file = path.join(DATA_DIR, `${sid}.jsonl`)
  // 直接写入两条旧格式行（无 seq 字段，模拟历史数据）
  fs.writeFileSync(
    file,
    JSON.stringify({ type: 'user', content: '旧1', ts: 1 }) +
      '\n' +
      JSON.stringify({ type: 'assistant', content: '旧2', ts: 2 }) +
      '\n'
  )
  const legacy = eventLog.getEvents(sid)
  assert.deepStrictEqual(
    legacy.map((e) => e.seq),
    [1, 2]
  )
  // 追加新事件：seq 从 3 继续（重启种子化取 max(存储 seq, 行号)），不与补齐值冲突
  eventLog.appendEvent(sid, 'user', '新3')
  const mixed = eventLog.getEvents(sid)
  assert.strictEqual(mixed.length, 3)
  assert.strictEqual(mixed[2].seq, 3)
  assert.strictEqual(mixed[2].content, '新3')
  fs.rmSync(file, { force: true })
})

test('dph-B seq: upToSeq 部分读取（时间旅行分叉的游标）', () => {
  const sid = `test-seq-partial-${Date.now()}`
  eventLog.appendEvent(sid, 'user', 'q1')
  eventLog.appendEvent(sid, 'assistant', 'a1')
  eventLog.appendEvent(sid, 'user', 'q2')

  assert.strictEqual(eventLog.getEvents(sid, { upToSeq: 1 }).length, 1)
  assert.deepStrictEqual(
    eventLog.getEvents(sid, { upToSeq: 2 }).map((e) => e.seq),
    [1, 2]
  )
  // 不传 upToSeq = 全量（旧行为不变）
  assert.strictEqual(eventLog.getEvents(sid).length, 3)
  fs.rmSync(path.join(DATA_DIR, `${sid}.jsonl`), { force: true })
})

test('dph-B seq: extra 不可覆盖 seq（日志主键由日志分配）', () => {
  const sid = `test-seq-guard-${Date.now()}`
  eventLog.appendEvent(sid, 'user', 'x', { seq: 999 })
  const events = eventLog.getEvents(sid)
  assert.strictEqual(events[0].seq, 1)
  fs.rmSync(path.join(DATA_DIR, `${sid}.jsonl`), { force: true })
})
