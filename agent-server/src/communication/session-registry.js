/**
 * 连接内会话注册表（P15 服务端会话路由）
 *
 * 背景：P14 修复了会话串台，但服务端仍是"一条 WS 连接 = 一个 Agent = 一份
 * conversationHistory"，所有会话轮流共用（切换靠 clear+重放换剧本）。这带来
 * 三个结构性限制：① 同一连接上两个会话的提问无法并行（token 流会交叉）；
 * ② 切会话必须 clear/重放（运行中回合不敢动，只能延迟同步）；③ 会话上下文
 * 的生命周期依附在连接上而非会话上。
 *
 * 本模块把 Agent 的生命周期绑定到 sessionId：
 *   - 每会话一个 Agent（上下文隔离），LRU 上限防内存无界
 *   - 会话内回合串行排队（同一会话连发不交叉），跨会话并行
 *   - 回合按会话注册 AbortController（取消精确到会话）
 *   - restore 直接替换该会话 Agent 的历史（store.replace 幂等，无需先 clear）
 */

/** 同一会话允许排队（不含正在执行）的回合上限，超过拒绝防止无界积压 */
const MAX_QUEUED_PER_SESSION = 2

function createConnectionSessions({ createAgent, maxSessions = 8 }) {
  if (typeof createAgent !== 'function') throw new Error('createAgent is required')

  /** sessionId → { agent, lastUsedAt } */
  const sessions = new Map()
  /** sessionId → AbortController（运行中回合） */
  const turns = new Map()
  /** sessionId → 串行链尾 Promise */
  const queues = new Map()
  /** sessionId → 排队中回合数（不含正在执行的） */
  const pending = new Map()

  /** 取会话 Agent（不创建） */
  const get = (sessionId) => sessions.get(sessionId)?.agent || null

  const evictIfNeeded = (keepSessionId) => {
    if (sessions.size <= maxSessions) return
    // 只驱逐：无运行中回合、无排队回合、最久未用的会话；全忙则允许暂时超限
    let oldestKey = null
    let oldestTs = Infinity
    for (const [key, entry] of sessions) {
      if (key === keepSessionId || turns.has(key) || (pending.get(key) || 0) > 0) continue
      if (entry.lastUsedAt < oldestTs) {
        oldestTs = entry.lastUsedAt
        oldestKey = key
      }
    }
    if (oldestKey !== null) {
      sessions.delete(oldestKey)
      console.log(`[Session] Evicted idle session agent (cap ${maxSessions}): ${oldestKey}`)
    }
  }

  /** 取或创建会话 Agent（LRU 触碰 + 淘汰） */
  const getOrCreate = (sessionId) => {
    let entry = sessions.get(sessionId)
    if (!entry) {
      entry = { agent: createAgent(sessionId), lastUsedAt: 0 }
      sessions.set(sessionId, entry)
      evictIfNeeded(sessionId)
    }
    entry.lastUsedAt = Date.now()
    return entry.agent
  }

  const hasActiveTurn = (sessionId) => turns.has(sessionId)
  const activeTurnSessionIds = () => Array.from(turns.keys())
  const registerTurn = (sessionId, controller) => turns.set(sessionId, controller)
  const releaseTurn = (sessionId) => turns.delete(sessionId)

  /** 取消指定会话的运行中回合，返回是否有回合被取消 */
  const abortTurn = (sessionId) => {
    const controller = turns.get(sessionId)
    if (!controller) return false
    controller.abort()
    turns.delete(sessionId)
    return true
  }

  /** 取消该连接全部运行中回合，返回被取消的会话列表 */
  const abortAllTurns = () => {
    const ids = Array.from(turns.keys())
    ids.forEach(abortTurn)
    return ids
  }

  /**
   * 会话内串行排队执行回合（跨会话并行）。前一个回合失败不阻断后续排队。
   * 同会话积压超过 MAX_QUEUED_PER_SESSION 时拒绝，返回 { ok:false, reason:'busy' }
   */
  const enqueueTurn = (sessionId, runFn) => {
    const now = pending.get(sessionId) || 0
    if (now >= MAX_QUEUED_PER_SESSION) return { ok: false, reason: 'busy' }
    pending.set(sessionId, now + 1)
    const prev = queues.get(sessionId) || Promise.resolve()
    const next = prev
      .catch(() => {})
      .then(() => {
        const left = (pending.get(sessionId) || 1) - 1
        if (left <= 0) pending.delete(sessionId)
        else pending.set(sessionId, left)
        return runFn()
      })
      .catch((err) => console.error('[Session] Turn failed:', err))
    queues.set(sessionId, next)
    return { ok: true }
  }

  /** 清空会话上下文（仅已存在的会话；不存在的新会话本就没有历史） */
  const clearSession = (sessionId) => {
    const agent = get(sessionId)
    if (agent) agent.clearHistory()
  }

  /** 清空该连接全部会话上下文（clear_history 不带 sessionId 的旧语义兜底） */
  const clearAll = () => {
    for (const entry of sessions.values()) entry.agent.clearHistory()
  }

  /** 恢复会话上下文（替换语义，幂等；restoreHistory 内部做消息清洗） */
  const restoreSession = (sessionId, history) => getOrCreate(sessionId).restoreHistory(history)

  /** 连接关闭：取消全部回合并清空注册表 */
  const dispose = () => {
    abortAllTurns()
    sessions.clear()
    queues.clear()
    pending.clear()
  }

  return {
    get,
    getOrCreate,
    hasActiveTurn,
    activeTurnSessionIds,
    registerTurn,
    releaseTurn,
    enqueueTurn,
    abortTurn,
    abortAllTurns,
    clearSession,
    clearAll,
    restoreSession,
    dispose,
    size: () => sessions.size,
  }
}

module.exports = { createConnectionSessions, MAX_QUEUED_PER_SESSION }
