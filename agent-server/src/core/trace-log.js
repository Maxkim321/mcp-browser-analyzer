const fs = require('node:fs')
const path = require('node:path')

/**
 * 运行时可观测事件日志（dph-A 延伸：从"前端实时流"到"结构化落盘"）
 *
 * 记录 LLM 调用过程中用户/开发者关心但转瞬即逝的事件：
 * - llm_retry：瞬时错误退避重试（429/5xx/网络）——故障自愈不可见 = 用户以为没处理过
 * - llm_fallback：协议降级（如网关不支持 stream_options 自动降级重发）
 * - context_compressed：上下文压缩实际发生（何时触发、视图 token 前后值）
 *
 * 为什么不复用 event-log.js：事件溯源只记 user/assistant 对话轮是有意取舍
 * （投影口径一致，见 event-log.js 注释），观测事件进同一文件会污染投影。
 * 独立 JSONL 同样 append-only、永不改写——审计口径与账本一致。
 */

const DATA_DIR = path.join(__dirname, '..', '..', 'data')
// 路径可由 TRACE_FILE 覆盖（测试隔离用），默认 data/trace-log.jsonl
const TRACE_FILE = process.env.TRACE_FILE || path.join(DATA_DIR, 'trace-log.jsonl')
// 内存环形缓冲：dashboard 直接读，避免每次请求重读文件
const MEMORY_LIMIT = 200
const memoryRing = []

/**
 * 记录一条观测事件（append-only，落盘失败不影响主流程）
 * @param {object} event - { type, ...detail }
 * @returns {object} 带时间戳后的完整事件
 */
function record(event) {
  const entry = { ts: new Date().toISOString(), ...event }
  memoryRing.push(entry)
  if (memoryRing.length > MEMORY_LIMIT) memoryRing.shift()
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.appendFileSync(TRACE_FILE, JSON.stringify(entry) + '\n', 'utf8')
  } catch (error) {
    console.warn('[TraceLog] write failed:', error.message)
  }
  return entry
}

/** 最近 n 条事件（内存环形缓冲，dashboard 用） */
function recent(n = 50) {
  return memoryRing.slice(-Math.max(0, n))
}

/** 读取全部历史事件（dashboard 冷启动时内存为空，从文件回放） */
function readAll() {
  try {
    return fs
      .readFileSync(TRACE_FILE, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

/** 测试用：清空内存环形缓冲（不删文件） */
function resetMemory() {
  memoryRing.length = 0
}

module.exports = { record, recent, readAll, resetMemory, TRACE_FILE }
