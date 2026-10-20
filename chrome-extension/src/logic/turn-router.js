/**
 * Turn 归属注册表（会话串台修复，P15 服务端会话路由的客户端对端）
 *
 * 背景：一条 WS 连接承载多个会话的回合流。P14 起服务端把回合绑定 sessionId，
 * 全部回合事件（token/agent_step/审批卡/agent_response）带 sessionId 回传；
 * 客户端据此把"不属于当前查看会话"的事件写进该会话的后台缓冲，回合结束
 * 落盘归属会话存储并提示——回答永远回到它发起的会话，不串台。
 *
 * 会话可以并行（服务端跨会话并行执行），因此注册表按 sessionId 维护多条
 * 回合记录；同一时刻只有"当前查看会话"的回合消息活在 messages 数组里
 * （前台直写），其余会话的消息在各自缓冲中（普通对象，不渲染无响应式开销）。
 *
 * 回合消息的边界取"最后一条用户消息之后"：所有发送入口（输入框/快捷按钮/
 * 划词/知识点补全）都先落一条 user 消息再调 sendPrompt，且回合进行中同会话
 * 禁止再发送（服务端会话内串行排队），因此该边界恒等于本回合产生的消息，
 * 切走再切回的循环里重新扫描天然正确（不依赖会过期的下标）。
 */

/** 回合边界：最后一条用户消息之后（isLocalNotice 是本地操作回显，不作边界） */
const lastUserCut = (messages) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m && m.sender === 'user' && !m.isLocalNotice) return i + 1
  }
  return messages.length
}

export function createTurnRegistry() {
  /** sessionId → { title, buffer: Array, discarded: boolean } */
  const turns = new Map()

  /** 回合开始（sendPrompt 成功出站后乐观标记；服务端事件带 sessionId 为准） */
  const begin = (sessionId, title = '') => {
    turns.set(sessionId, { title, buffer: [], discarded: false })
    return turns.get(sessionId)
  }

  const has = (sessionId) => turns.has(sessionId)
  const record = (sessionId) => turns.get(sessionId) || null
  const busyIds = () => Array.from(turns.keys())

  /**
   * fg→bg：把该会话回合已产生的消息从当前消息数组抽离进缓冲（切走时调用）
   */
  const detach = (sessionId, messages) => {
    const turn = turns.get(sessionId)
    if (!turn) return []
    turn.buffer = messages.splice(lastUserCut(messages))
    return turn.buffer
  }

  /** bg→fg：该会话缓冲并回消息数组，事件恢复直写（切回时调用） */
  const attach = (sessionId, messages) => {
    const turn = turns.get(sessionId)
    if (!turn) return
    messages.push(...turn.buffer)
    turn.buffer = []
  }

  /** 归属会话被删除/清空：回合跑完但收尾不落盘、不提示 */
  const discard = (sessionId) => {
    const turn = turns.get(sessionId)
    if (turn) turn.discarded = true
  }

  /** 回合结束：交出记录并移除（调用方用 buffer/title 做落盘与提示） */
  const end = (sessionId) => {
    const finished = turns.get(sessionId) || null
    turns.delete(sessionId)
    return finished
  }

  /** 全部复位（WS 断连：服务端 abort 所有回合，回合已死） */
  const reset = () => turns.clear()

  return { begin, has, record, busyIds, detach, attach, discard, end, reset }
}

/**
 * HITL 卡片插入（审批卡/深度研究询问）：按时间线插到"正在流式的气泡"之前——
 * 卡片发生在回合中段，而最终结论复用同一个流式气泡继续生长，若 push 到末尾
 * 会让结论排在审批卡上方（时间线颠倒）。无流式气泡时按到达顺序追加。
 * 业界同构：Claude Code 权限提示内联于时间线发生点、ChatGPT 工具 chip 按序嵌入。
 */
export function insertBeforeStreaming(list, card) {
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i] && list[i].streaming) {
      list.splice(i, 0, card)
      return card
    }
  }
  list.push(card)
  return card
}

/**
 * 后台回合的 token 增量：追加到缓冲末尾的流式消息（无则创建一条）
 * 缓冲消息是普通对象（后台不渲染、无响应式需求），切回前台并入 messages 后
 * 由调用方走 reactive 代理直写路径
 */
export function appendTurnToken(buffer, content) {
  let last = buffer.length ? buffer[buffer.length - 1] : null
  if (!last || last.type !== 'text' || !last.streaming) {
    last = { type: 'text', sender: 'ai', content: '', timestamp: Date.now(), streaming: true }
    buffer.push(last)
  }
  last.content += content
  return last
}

/**
 * 回合收尾：把缓冲定格成最终消息（后台 agent_response 到达时调用）
 * - 有流式消息：成功用最终完整内容覆盖增量（防分片丢失内容不全），失败保留已
 *   流出增量并追加错误行（cancelled 同路径，与前台口径一致）
 * - 无流式消息（秒回/纯错误回合）：成功且带内容补一条完整回答，失败补错误消息
 */
export function finalizeTurnMessages(buffer, { success, content, error, memory_refs, meta } = {}) {
  const msgs = (buffer || []).map((m) => ({ ...m }))
  const streaming = [...msgs].reverse().find((m) => m.streaming)
  if (streaming) {
    streaming.content = success
      ? String(content || '')
      : `${streaming.content}\n\n错误: ${content || error || ''}`
    streaming.streaming = false
    if (success && Array.isArray(memory_refs) && memory_refs.length) streaming.memoryRefs = memory_refs
    if (success && meta) streaming.tierMeta = meta
    return msgs
  }
  if (success && content) {
    msgs.push({
      type: 'text',
      sender: 'ai',
      content: String(content),
      timestamp: Date.now(),
      memoryRefs: Array.isArray(memory_refs) ? memory_refs : [],
      tierMeta: meta || null,
    })
  } else if (!success && (content || error)) {
    msgs.push({
      type: 'text',
      sender: 'ai',
      content: `错误: ${content || error || ''}`,
      timestamp: Date.now(),
    })
  }
  return msgs
}

/**
 * 落盘过滤（与 SidePanel flushSession 同口径）：审批卡是瞬态消息不落盘
 * （重放出的是 requestId 已死的僵尸卡片），半条流式残影不落盘
 */
export function pickPersistable(messages) {
  return (messages || []).filter((m) => m.type !== 'write_approval' && !m.streaming)
}
