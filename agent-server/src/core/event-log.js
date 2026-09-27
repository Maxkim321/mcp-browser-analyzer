const fs = require('node:fs')
const path = require('node:path')

/**
 * dph-B 事件溯源会话日志（对标 DeepSeek Harness append-only 事件日志）
 * - append-only JSONL 文件：每行一个事件 {seq, type, content, ts}，只追加不修改 → 可审计、可回放
 * - seq 是事件的主键（单调递增）：append-only 日志没有主键只能被"读"，有了主键才能被"寻址"——
 *   部分重放（upToSeq）、增量投影（记"已投影到 seq=N"）、完整性校验（跳号=丢数据）都建立在它之上
 * - 模型历史从事件投影：agent 上下文由 user/assistant 事件重建，不依赖前端重放
 * - 断点续跑：服务端崩溃/重启后，同一 sessionId 提问时先投影重建上下文，再继续
 *
 * 为什么只记 user/assistant 文本轮：
 * 工具调用过程（tool_calls + tool 结果）只服务于"得出最终答案"，不进入长期上下文；
 * 前端 F4 重放也是同一口径，投影结果与前端重放一致，双端不打架。
 */

const DATA_DIR = path.join(__dirname, '../../data')
const EVENTS_DIR = path.join(DATA_DIR, 'events')

function ensureDir() {
  fs.mkdirSync(EVENTS_DIR, { recursive: true })
}

function fileOf(sessionId) {
  // sessionId 由前端生成（时间戳-随机串），作为文件名需做安全过滤
  const safe = String(sessionId || '').replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(EVENTS_DIR, `${safe}.jsonl`)
}

// 每会话的内存 seq 游标（sessionId → 已分配的最大 seq）。
// 单进程内 appendFileSync 串行化，游标只需在首次触碰会话文件时从磁盘种子化一次。
const seqCursors = new Map()

/** 回扫文件取已分配的最大 seq（存量无 seq 的旧格式行按行号计），保证重启后序号不回退 */
function seedSeq(sessionId) {
  const file = fileOf(sessionId)
  if (!fs.existsSync(file)) return 0
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
  let max = 0
  lines.forEach((line, i) => {
    try {
      const e = JSON.parse(line)
      const stored = Number(e && e.seq)
      max = Math.max(max, Number.isInteger(stored) && stored > 0 ? stored : 0, i + 1)
    } catch {
      max = Math.max(max, i + 1) // 坏行也占一个位置
    }
  })
  return max
}

function nextSeq(sessionId) {
  if (!seqCursors.has(sessionId)) {
    seqCursors.set(sessionId, seedSeq(sessionId))
  }
  const next = seqCursors.get(sessionId) + 1
  seqCursors.set(sessionId, next)
  return next
}

/**
 * 追加一条事件（append-only，不做任何修改）
 * @param {string} sessionId - 会话 ID
 * @param {'user'|'assistant'} type - 事件类型
 * @param {string} content - 消息内容
 * @param {object} extra - 附加字段（如 action）；seq 是日志主键，extra 不可覆盖
 */
function appendEvent(sessionId, type, content, extra = {}) {
  if (!sessionId || typeof content !== 'string' || content.trim() === '') return
  ensureDir()
  const seq = nextSeq(sessionId)
  const line = JSON.stringify({ type, content, ts: Date.now(), ...extra, seq })
  fs.appendFileSync(fileOf(sessionId), `${line}\n`, 'utf8')
}

/**
 * 读取某会话的全部事件（按写入顺序）
 * @param {string} sessionId - 会话 ID
 * @param {object} [opts]
 * @param {number} [opts.upToSeq] - 只返回 seq ≤ 该值的事件（部分重放/时间旅行分叉的游标）
 * @returns {Array<{seq,type,content,ts}>} 事件数组
 */
function getEvents(sessionId, opts = {}) {
  if (!sessionId) return []
  const { upToSeq } = opts
  const file = fileOf(sessionId)
  if (!fs.existsSync(file)) return []
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
  const events = []
  let cursor = 0
  for (const line of lines) {
    try {
      const e = JSON.parse(line)
      if (e && (e.type === 'user' || e.type === 'assistant') && typeof e.content === 'string') {
        // 存量无 seq 的旧格式行按读取顺序补齐；有 seq 的行以存储值为准（跳号如实保留，可作完整性依据）
        const stored = Number(e.seq)
        if (Number.isInteger(stored) && stored > 0) {
          cursor = Math.max(cursor, stored)
        } else {
          cursor += 1
          e.seq = cursor
        }
        if (Number.isFinite(upToSeq) && e.seq > upToSeq) continue
        events.push(e)
      }
    } catch {
      // 坏行跳过（append-only 不应发生，防御性处理）
    }
  }
  return events
}

/**
 * 把事件投影成 OpenAI 格式对话历史（模型上下文）
 * 过滤空消息，保证角色合法；与前端 F4 buildOpenAIHistory 同口径
 * @param {Array} events - 事件数组
 * @returns {Array<{role:'user'|'assistant',content:string}>}
 */
function projectToHistory(events) {
  const history = []
  for (const e of events || []) {
    const role = e.type === 'user' ? 'user' : 'assistant'
    const content = String(e.content || '').trim()
    if (!content) continue
    const last = history[history.length - 1]
    // 合并连续同角色（保持角色交替，符合 API 规范）
    if (last && last.role === role) {
      last.content += `\n${content}`
    } else {
      history.push({ role, content })
    }
  }
  return history
}

module.exports = { appendEvent, getEvents, projectToHistory }
