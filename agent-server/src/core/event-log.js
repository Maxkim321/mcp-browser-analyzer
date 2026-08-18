const fs = require('node:fs')
const path = require('node:path')

/**
 * dph-B 事件溯源会话日志（对标 DeepSeek Harness append-only 事件日志）
 * - append-only JSONL 文件：每行一个事件 {type, content, ts}，只追加不修改 → 可审计、可回放
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

/**
 * 追加一条事件（append-only，不做任何修改）
 * @param {string} sessionId - 会话 ID
 * @param {'user'|'assistant'} type - 事件类型
 * @param {string} content - 消息内容
 * @param {object} extra - 附加字段（如 action）
 */
function appendEvent(sessionId, type, content, extra = {}) {
  if (!sessionId || typeof content !== 'string' || content.trim() === '') return
  ensureDir()
  const line = JSON.stringify({ type, content, ts: Date.now(), ...extra })
  fs.appendFileSync(fileOf(sessionId), `${line}\n`, 'utf8')
}

/**
 * 读取某会话的全部事件（按写入顺序）
 * @param {string} sessionId - 会话 ID
 * @returns {Array<{type,content,ts}>} 事件数组
 */
function getEvents(sessionId) {
  if (!sessionId) return []
  const file = fileOf(sessionId)
  if (!fs.existsSync(file)) return []
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
  const events = []
  for (const line of lines) {
    try {
      const e = JSON.parse(line)
      if (e && (e.type === 'user' || e.type === 'assistant') && typeof e.content === 'string') {
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
