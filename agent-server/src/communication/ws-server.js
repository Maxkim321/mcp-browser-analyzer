const http = require('node:http')
const WebSocket = require('ws')
const { v4: uuidv4 } = require('uuid')
const toolHandler = require('../tools/handler.js')
const { listCapabilities } = require('../tools/capabilities.js')
const { Agent } = require('../core/agent.js')
const { LLMClient } = require('../core/llm.js')
const { ResearchWorkflow } = require('../core/workflow.js')
const { createPermissionCheck } = require('../core/approval.js')
const { createConnectionSessions } = require('./session-registry.js')
const config = require('../config/index.js')
const {
  ACTION_PROMPTS,
  SYSTEM_PROMPT,
  currentDateLine,
} = require('../config/prompts.js')
const { appendPageContext, appendPrefs } = require('../core/prompt-context.js')
const eventLog = require('../core/event-log.js')
const memoryWire = require('../memory/wire.js')
const usageTracker = require('../core/usage-tracker.js')
const traceLog = require('../core/trace-log.js')
const dashboard = require('./dashboard.js')

// P3 浏览记忆开关（MEMORY_ENABLED=off 可关闭，默认开启）
const MEMORY_ENABLED = process.env.MEMORY_ENABLED !== 'off'

// P15 会话路由：连接Id → 会话注册表（每会话一个 Agent，上下文隔离；
// 会话内回合串行排队、跨会话并行；见 session-registry.js）
const connectionSessions = new Map()
// P12c 收尾：最后活跃连接（user_prompt 到达即标记）——回合中通道重建（zhipin 页
// reload/WS 重连）会让回合开始时固化的 connectionId 失效，工具调用据此回落到
// 用户当前的真实会话，而不是撞死在断掉的旧通道上
let lastActiveConnectionId = null

// 深度研究（M1-F8）：会话级运行标记（`${connectionId}:${sessionId}`）——
// 同会话只允许一个工作流，跨会话可并行
const activeWorkflows = new Map()
// HITL 等待答复：`${connectionId}:${sessionId}` → { resolve, timer }
const pendingWorkflowAsks = new Map()
// P4 写操作审批等待：approvalId → { resolve, timer, cleanup }
const pendingWriteApprovals = new Map()

const workflowKeyOf = (id, sessionId) => `${id}:${sessionId || ''}`

/**
 * P4 分级权限 HITL：写操作审批往返
 * 推送 write_approval（含工具名/参数/一句话说明）到侧边栏 → 用户放行或拒绝
 * 超时/取消/连接断开一律视为拒绝——审批是授权语义，等不到授权 = 没有授权
 * @param {number} id - 连接 ID
 * @param {string} toolName - 写工具名
 * @param {object} args - 工具参数（审批卡片展示 selector/value）
 * @param {AbortSignal} [signal] - 取消信号
 * @param {Array} [taint] - P7 注入染色证据（本轮检出的可疑来源，卡片据此亮警告）
 * @returns {Promise<{approved:boolean,note?:string,timeout?:boolean}>}
 */
function requestWriteApproval(id, toolName, args, signal, taint = []) {
  return new Promise((resolve) => {
    const approvalId = uuidv4()
    const settle = (result) => {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
      pendingWriteApprovals.delete(approvalId)
      resolve(result)
    }
    const timer = setTimeout(() => settle({ approved: false, timeout: true }), config.agent.writeApprovalTimeout)
    const onAbort = () => settle({ approved: false, note: '任务已取消' })
    if (signal) {
      if (signal.aborted) return settle({ approved: false, note: '任务已取消' })
      signal.addEventListener('abort', onAbort, { once: true })
    }
    pendingWriteApprovals.set(approvalId, { resolve: settle, connectionId: id })
    const sent = manager.send(id, {
      type: 'write_approval',
      requestId: approvalId,
      tool: toolName,
      args,
      taint: Array.isArray(taint) ? taint : [],
    })
    // 连接不可用：没有审批人，直接拒绝（不留 120s 空等）
    if (!sent) settle({ approved: false, note: '侧边栏连接不可用，无法请求审批' })
  })
}

/**
 * 连接管理器 - 管理所有 WebSocket 客户端连接
 * 支持单个连接发送、广播等操作
 */
class ConnectionManager {
  constructor() {
    this.connections = new Map()
    this.nextId = 1
  }

  /**
   * 添加新的客户端连接
   * @param {WebSocket} ws - WebSocket 连接实例
   * @returns {number} 连接 ID
   */
  add(ws) {
    const id = this.nextId++
    this.connections.set(id, ws)
    console.log(`[Connection] New client connected, id: ${id}`)
    return id
  }

  /**
   * 移除客户端连接
   * @param {number} id - 连接 ID
   */
  remove(id) {
    this.connections.delete(id)
    console.log(`[Connection] Client disconnected, id: ${id}`)
  }

  /**
   * 向指定连接发送消息
   * @param {number} id - 连接 ID
   * @param {object} message - 消息对象
   * @returns {boolean} 是否发送成功
   */
  send(id, message) {
    const ws = this.connections.get(id)
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message))
      console.log(`[Send] To ${id}:`, message)
      return true
    }
    console.log(`[Send] Connection ${id} not available`)
    return false
  }

  /**
   * 向所有连接广播消息
   * @param {object} message - 消息对象
   */
  broadcast(message) {
    console.log('[Broadcast]', message)
    // eslint-disable-next-line no-unused-vars
    this.connections.forEach((ws, id) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message))
      }
    })
  }

  /**
   * 获取所有连接 ID
   * @returns {number[]} 连接 ID 数组
   */
  getIds() {
    return Array.from(this.connections.keys())
  }

  /**
   * 获取当前连接数量
   * @returns {number} 连接数量
   */
  getCount() {
    return this.connections.size
  }
}

const manager = new ConnectionManager()

/**
 * 推送用量汇总（用量条数据源）：本会话 + 服务进程两级，light 占比让分级路由可见
 * @param {number} id - 连接 ID
 */
function pushUsageSummary(id) {
  const session = usageTracker.summaryFor(id)
  const total = usageTracker.totalsSnapshot()
  manager.send(id, {
    type: 'usage_summary',
    session: { ...session, lightShare: usageTracker.lightShare(session) },
    total: { ...total, lightShare: usageTracker.lightShare(total) },
  })
}

/**
 * 校验并清洗插件下发的 LLM 配置
 * 插件端配置页可覆盖服务端 .env，但不能信任前端数据：
 *  - 只接受白名单字段，避免把 stream / messages 之类的字段混进 LLMClient
 *  - baseURL 必须是 http(s)，防止 file:// 之类的协议
 *  - 空字符串视为「不覆盖」，让服务端保留自己的默认值
 * @param {object} raw - 插件传来的 llmConfig
 * @returns {object} 清洗后的配置，无有效字段时返回空对象（即完全用服务端默认）
 */
function sanitizeLLMConfig(raw) {
  if (!raw || typeof raw !== 'object') return {}
  const clean = {}

  const baseURL = String(raw.baseURL || '')
    .trim()
    .replace(/\/+$/, '')
  if (baseURL && /^https?:\/\//i.test(baseURL)) clean.baseURL = baseURL

  const apiKey = String(raw.apiKey || '').trim()
  if (apiKey) clean.apiKey = apiKey

  const model = String(raw.model || '').trim()
  if (model) clean.model = model

  // temperature 允许 0，必须用 isFinite 判断而非真值判断
  const temperature = Number(raw.temperature)
  if (Number.isFinite(temperature) && temperature >= 0 && temperature <= 2) {
    clean.temperature = temperature
  }

  return clean
}

/**
 * 日志脱敏：apiKey 绝不能明文进日志（终端记录/日志文件都可能被他人看到）
 * @param {object} msg - 原始消息
 * @returns {object} 可安全打印的副本
 */
function redactForLog(msg) {
  if (!msg?.llmConfig?.apiKey) return msg
  return {
    ...msg,
    llmConfig: { ...msg.llmConfig, apiKey: '***redacted***' },
  }
}

toolHandler.init({
  manager,
  send: (id, cmd) => manager.send(id, cmd),
  broadcast: (cmd) => manager.broadcast(cmd),
  getPerformance: (id) => manager.send(id, { type: 'get_performance' }),
})

/**
 * 启动服务器：HTTP 与 WebSocket 同端口共存
 * - WebSocket 走 upgrade（插件/客户端连接，协议不变）
 * - HTTP GET 交给 dashboard（/ → 仪表盘页，/api/* → 度量数据）
 */
const server = http.createServer((req, res) => dashboard.handleRequest(req, res))
const wss = new WebSocket.Server({ server })
server.listen(config.server.port, () => {
  console.log(`[Server] Listening on port ${config.server.port} (WS + Dashboard)`)
  console.log(`[Dashboard] http://localhost:${config.server.port}/dashboard`)
})

/**
 * 处理新的客户端连接
 */
wss.on('connection', (ws) => {
  const connectionId = manager.add(ws)
  // P15 会话路由：连接持有会话注册表（每会话一个 Agent，上下文隔离），
  // 不再是单 Agent 全会话轮流共用
  const sessions = createConnectionSessions({ createAgent: () => new Agent() })
  connectionSessions.set(connectionId, sessions)

  /**
   * 接收并处理客户端消息
   */
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString())
      console.log(`[Receive] From ${connectionId}:`, redactForLog(msg))
      await handleMessage(connectionId, msg, sessions)
    } catch (err) {
      console.error('[Error] Parse message:', err)
    }
  })

  /**
   * 客户端断开连接
   */
  ws.on('close', () => {
    manager.remove(connectionId)
    // P15：连接内全部会话 Agent 随连接销毁（运行中回合的 abort 由 dispose 完成，
    // 避免孤儿 fetch 空耗 token）
    sessions.dispose()
    connectionSessions.delete(connectionId)
    // P16：清理该连接全部会话的工作 tab 记录
    toolHandler.clearWorkingTabsForConnection(connectionId)
    // P4 分级权限：审批人下线，等待中的写操作审批全部拒绝
    denyPendingApprovals(connectionId)
    // 清理该连接的深度研究资源（会话级工作流标记 + HITL 等待）
    cleanupConnectionWorkflows(connectionId)
  })

  /**
   * 连接发生错误
   */
  ws.on('error', (err) => {
    console.error('[Error] Connection:', err)
    manager.remove(connectionId)
    sessions.dispose()
    connectionSessions.delete(connectionId)
    toolHandler.clearWorkingTabsForConnection(connectionId)
    denyPendingApprovals(connectionId)
    cleanupConnectionWorkflows(connectionId)
  })
})

/**
 * 连接断开/出错时：清理该连接全部会话的深度研究资源
 * （会话级 key 为 `${connectionId}:${sessionId}`，按前缀匹配）
 */
function cleanupConnectionWorkflows(connectionId) {
  const prefix = `${connectionId}:`
  for (const key of Array.from(activeWorkflows.keys())) {
    if (key.startsWith(prefix)) activeWorkflows.delete(key)
  }
  for (const key of Array.from(pendingWorkflowAsks.keys())) {
    if (!key.startsWith(prefix)) continue
    const pendingAsk = pendingWorkflowAsks.get(key)
    clearTimeout(pendingAsk.timer)
    pendingWorkflowAsks.delete(key)
    pendingAsk.resolve({ cancel: true, text: '' })
  }
}

/**
 * 连接断开/出错时：该连接所有等待中的写操作审批一律拒绝（审批人已不在线）
 * @param {number} id - 连接 ID
 */
function denyPendingApprovals(id) {
  for (const [approvalId, pending] of pendingWriteApprovals) {
    if (pending.connectionId === id) {
      pendingWriteApprovals.delete(approvalId)
      pending.resolve({ approved: false, note: '侧边栏已断开，审批拒绝' })
    }
  }
}

/**
 * 执行一个回合（P15 会话路由）：从 user_prompt 入队后真正跑的部分。
 * 每个回合绑定 sessionId——上下文取该会话自己的 Agent，全部事件带 sessionId
 * 回传（前端据此把事件路由回发起会话，切走后进后台缓冲）
 * @param {number} id - 连接 ID
 * @param {object} msg - user_prompt 消息
 * @param {ReturnType<createConnectionSessions>} sessions - 会话注册表
 * @param {string} sessionId - 归属会话
 */
async function runTurn(id, msg, sessions, sessionId) {
  try {
    const agent = sessions.getOrCreate(sessionId)
    // 插件配置页下发的模型配置：校验后覆盖服务端 .env 默认值（空字段仍用服务端默认）
    // 注意在执行时（而非入队时）应用——排队等到的回合用最新配置
    agent.llm.applyConfig(sanitizeLLMConfig(msg.llmConfig))
    // M1-F8 深度研究占用中：同会话拒绝普通提问（跨会话不受影响）
    if (activeWorkflows.has(workflowKeyOf(id, sessionId))) {
      manager.send(id, {
        type: 'agent_response',
        success: false,
        content: '深度研究正在进行中，请等待其完成后再提问。',
        sessionId,
      })
      return
    }
    // dph-B 事件溯源：同一会话崩溃/重启后，Agent 内存为空时用事件日志投影重建上下文（断点续跑）
    if (sessionId && agent.isEmptyHistory()) {
      const events = eventLog.getEvents(sessionId)
      if (events.length > 0) {
        const count = agent.restoreHistory(eventLog.projectToHistory(events))
        console.log(`[EventLog] Rebuilt ${count} messages from events for session ${sessionId}`)
      }
    }
    manager.send(id, { type: 'thinking', sessionId })
    // 固定动作（总结/翻译/解释等）使用专用提示词驱动结构化输出
    // F1 轻量 pageContext + F5 偏好：仅普通对话注入（固定动作的 prompt 是严格模板，塞上下文会破坏结构化输出）
    let systemPrompt = msg.action ? ACTION_PROMPTS[msg.action] : SYSTEM_PROMPT
    if (!msg.action && msg.pageContext) {
      systemPrompt = appendPageContext(systemPrompt, msg.pageContext)
    }
    if (!msg.action && msg.prefs) {
      systemPrompt = appendPrefs(systemPrompt, msg.prefs)
    }
    if (!msg.action) {
      // 相对日期（"下周五"）解析的基准：运行时计算（东八区+星期），非启动时固化
      systemPrompt = `${systemPrompt}

${currentDateLine()}`
    }
    // P3 浏览记忆：提问时检索相关旧卡片注入上下文（固定动作不注入，避免破坏结构化模板）
    // P8：recallForPrompt 改为 async（混合检索需查询向量化）
    let memoryRefs = []
    if (!msg.action && MEMORY_ENABLED) {
      const recalled = await memoryWire.recallForPrompt(msg.prompt, msg.pageContext)
      if (recalled) {
        systemPrompt = `${systemPrompt}\n\n${recalled.block}`
        memoryRefs = recalled.refs
        console.log(`[Memory] Recalled ${recalled.refs.length} cards for prompt`)
      }
    }
    // 将当前连接上下文透传给 Agent，工具调用可优先使用当前会话连接
    // onToken：LLM 文本增量实时分片推送（流式输出），最终结果仍由 agent_response 兜底
    // dph-A：AbortController 支持用户取消；onStep 把 Turn 内每个 Step（推理/工具）事件下发前端
    // P15：controller 按会话注册——cancel_request(sessionId) 精确停这一回合
    const controller = new AbortController()
    sessions.registerTurn(sessionId, controller)
    // P4 分级权限：为本次任务构造写操作审批闭包
    // （读操作零打断；写操作逐次审批；预算/dry-run/审计口径见 approval.js）
    const permissionCheck = createPermissionCheck({
      requestApproval: ({ toolName, args, taint }) =>
        requestWriteApproval(id, toolName, args, controller.signal, taint, sessionId),
      writeBudget: config.agent.maxWriteActions,
      dryRun: config.agent.writeDryRun,
      sessionId,
    })
    // dph-B：记录本次用户提问事件（append-only）
    if (sessionId)
      eventLog.appendEvent(sessionId, 'user', String(msg.prompt || '').trim(), {
        action: msg.action,
      })
    try {
      const result = await agent.process(msg.prompt, {
        connectionId: id,
        sessionId,
        systemPrompt,
        signal: controller.signal,
        permissionCheck,
        // P11：知识点补全是纯对话 action——空数组白名单 = 工具硬闸，
        // LLM 侧不再携带 15 个工具定义（省 token，也杜绝补全误触发浏览器操作）
        tools: msg.action === 'knowledge_complete' ? [] : undefined,
        onToken: (chunk) => manager.send(id, { type: 'token', content: chunk, sessionId }),
        onStep: (stepInfo) => manager.send(id, { type: 'agent_step', ...stepInfo, sessionId }),
      })
      manager.send(id, {
        type: 'agent_response',
        success: result.success,
        content: result.content,
        error: result.error,
        memory_refs: memoryRefs.length > 0 ? memoryRefs : undefined,
        // 档位 badge：本条回答实际生效的档位/模型（路由决策从黑盒变可见）
        meta: result.meta,
        sessionId,
      })
      pushUsageSummary(id)
      // dph-B：记录回答事件（仅成功且有内容时，append-only）
      if (sessionId && result.success && result.content) {
        eventLog.appendEvent(sessionId, 'assistant', String(result.content).trim())
      }
      // P3 浏览记忆：成功回答 + 页面上下文 → 写卡片（跨页面记忆的数据来源）
      if (result.success && result.content && MEMORY_ENABLED) {
        const card = memoryWire.rememberFromResult(msg.pageContext, result.content)
        if (card) console.log(`[Memory] Card saved: ${card.title.slice(0, 40)}`)
      }
    } finally {
      sessions.releaseTurn(sessionId)
      // P16：回合结束清除该会话的工作 tab（下个回合重新解析，避免粘到已过期页面）
      toolHandler.clearWorkingTab(id, sessionId)
    }
  } catch (error) {
    // dph-A 可取消：用户主动取消/连接断开导致的 abort，回复"已停止"，不当作系统错误
    if (error?.code === 'ABORTED' || error?.name === 'AbortError') {
      manager.send(id, {
        type: 'agent_response',
        success: false,
        content: '已停止本次回答。',
        error: 'cancelled',
        sessionId,
      })
    } else {
      console.error('[Agent] Error:', error)
      manager.send(id, {
        type: 'agent_response',
        success: false,
        content: '抱歉，处理你的请求时出错了。',
        error: error.message,
        sessionId,
      })
    }
  }
}

/**
 * 处理客户端消息
 * 根据消息类型分发到不同的处理逻辑
 * @param {number} id - 连接 ID
 * @param {object} msg - 消息对象
 * @param {ReturnType<createConnectionSessions>} sessions - 该连接的会话注册表
 */
async function handleMessage(id, msg, sessions) {
  // P4 写操作审批答复：必须先于 requestId 分支处理（答复也带 requestId，
  // 落到 toolHandler 会查不到 pending 而被静默丢弃，审批方将一直挂到超时）
  if (msg.type === 'write_approval_answer') {
    const pending = pendingWriteApprovals.get(msg.requestId)
    if (pending) {
      pending.resolve({
        approved: msg.approved === true,
        note: msg.approved ? undefined : String(msg.note || '用户拒绝了该写操作'),
      })
    }
    return
  }

  // 统一处理工具响应：只要插件回了 requestId，就交给 tool handler 匹配 pending request
  // 这可以覆盖 performance_data / navigate_to_result / reload_result / wait_for_load_result 等类型
  if (msg.requestId) {
    toolHandler.handlePluginResponse(id, msg)
    return
  }

  switch (msg.type) {
    case 'ping':
      manager.send(id, { type: 'pong' })
      break
    case 'user_prompt': {
      lastActiveConnectionId = id
      console.log('[Agent] Processing prompt:', msg.prompt)
      // 用量归因：本连接发起的所有 LLM 调用（含深度研究）计入该会话
      usageTracker.bindConnection(id)
      // P15 会话路由：回合按 sessionId 入队——会话内串行（同会话连发不交叉），
      // 跨会话并行（各自独立的 Agent 上下文）
      const sessionId = String(msg.sessionId || '')
      const enqueued = sessions.enqueueTurn(sessionId, () =>
        msg.action === 'research'
          ? runResearch(id, msg.prompt, sanitizeLLMConfig(msg.llmConfig), sessionId, sessions)
          : runTurn(id, msg, sessions, sessionId)
      )
      if (!enqueued.ok) {
        manager.send(id, {
          type: 'agent_response',
          success: false,
          content: '该会话已有回合在执行或排队中，请等待完成后再提问。',
          error: 'session_busy',
          sessionId,
        })
      }
      break
    }
    case 'workflow_answer':
      // M1-F8 HITL：用户对 workflow_ask 的答复（继续/停止/自定义方向）
      {
        const pendingAsk = pendingWorkflowAsks.get(id)
        if (pendingAsk) {
          clearTimeout(pendingAsk.timer)
          pendingWorkflowAsks.delete(id)
          pendingAsk.resolve({
            cancel: msg.cancel === true,
            text: String(msg.answer || '').trim(),
          })
        }
      }
      break
    case 'cancel_request':
      // dph-A + P15 可取消：带 sessionId 精确取消该会话的回合；不带则取消该连接全部
      // （旧客户端兼容）——跨会话并行后"停止"必须指明停谁
      {
        const sid = String(msg.sessionId || '')
        const stopped = sid ? sessions.abortTurn(sid) : sessions.abortAllTurns().length > 0
        if (stopped) console.log(`[Agent] Cancel requested: session ${sid || '(all)'}`)
        manager.send(id, { type: 'cancel_ack', sessionId: sid || undefined })
      }
      break
    case 'clear_history':
      // P15：带 sessionId 清该会话上下文（删除会话时同步服务端）；不带则清全部（旧语义兜底）
      {
        const sid = String(msg.sessionId || '')
        if (sid) sessions.clearSession(sid)
        else sessions.clearAll()
        manager.send(id, { type: 'history_cleared', sessionId: sid || undefined })
      }
      break
    case 'restore_session':
      // F4 会话持久化 + P15 会话路由：把持久化历史重放到指定会话的 Agent。
      // store.replace 是替换语义——幂等，无需先 clear_history（切换会话即恢复该会话上下文）；
      // 运行中回合的会话由客户端负责跳过重放（重放会与运行中回合的上下文竞争）
      {
        const sid = String(msg.sessionId || '')
        const count = sessions.restoreSession(sid, msg.history)
        manager.send(id, { type: 'history_restored', count, sessionId: sid })
      }
      break
    case 'list_capabilities':
      // P10 能力可见性：面板按需拉取真实注册表快照（内置 + MCP）。
      // 注意本消息不能带 requestId——会被上方 requestId 分支拦去 handlePluginResponse
      manager.send(id, { type: 'capabilities', capabilities: listCapabilities() })
      break
    default:
      console.warn(`[Message] Unknown message type from ${id}:`, msg.type)
      // 不能回 agent_response——前端把它当"回合结束"处理，版本偏差下会把
      // 正在后台运行的回合误收尾。协议不匹配用独立类型表达（前端仅告警）
      manager.send(id, {
        type: 'unsupported',
        content: '不支持的消息类型，请检查客户端协议。',
      })
      break
  }
}

/**
 * 运行深度研究工作流（M1-F8）
 * - 注册 activeWorkflows 防止并发
 * - 推送 workflow_progress（进度）
 * - HITL：workflow_ask 推送 + 等待 workflow_answer
 * - 完成/失败后发 agent_response（报告即最终答复），并清理 checkpoint
 * @param {number} id - 连接 ID
 * @param {string} question - 研究问题
 * @param {object} [llmOverride] - 插件配置页下发的模型配置（已校验）
 * @param {string} sessionId - 归属会话（P15：深度研究会话隔离，事件带 sessionId）
 * @param {ReturnType<createConnectionSessions>} [sessions] - 会话注册表（回合取消注册）
 */
async function runResearch(id, question, llmOverride = {}, sessionId = '', sessions = null) {
  const wfKey = workflowKeyOf(id, sessionId)
  if (activeWorkflows.has(wfKey)) {
    manager.send(id, {
      type: 'agent_response',
      success: false,
      content: '深度研究正在进行中，请等待其完成后再提问。',
      sessionId,
    })
    return
  }

  // 工作流用独立的 LLMClient，同样要应用插件下发的配置，否则深度研究会走服务端默认模型
  const workflow = new ResearchWorkflow(new LLMClient(llmOverride), {
    maxTopics: 3,
    maxPagesPerTopic: 3,
    maxAttempts: 2,
    // P6 管线路由（RESEARCH_ROUTING=legacy/subagent/auto）：auto 按 plan 的 depth 标注分流
    routingMode: config.research.routing,
    workerMaxSteps: config.research.workerMaxSteps,
  })
  activeWorkflows.set(wfKey, workflow)

  // dph-A 可取消：深度研究也注册 AbortController，cancel_request 才能中止整个工作流
  // （此前这里没注册，导致点"停止"时取不到 controller，取消空转）；P15 按会话注册
  const controller = new AbortController()
  if (sessions) sessions.registerTurn(sessionId, controller)

  // sendAsk 透传打断证据（kind/topic/attempts/预算），前端 HITL 卡片据此展示"为什么打断"
  const sendAsk = (askQuestion, options, evidence) =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingWorkflowAsks.delete(wfKey)
        resolve({ cancel: false, text: '继续研究', timeout: true })
      }, 120000) // HITL 超时兜底：用户不答复 2 分钟后默认继续，不挂死工作流
      pendingWorkflowAsks.set(wfKey, { resolve, timer })
      manager.send(id, {
        type: 'workflow_ask',
        question: askQuestion,
        options: options || ['继续研究', '停止研究'],
        evidence,
        sessionId,
      })
    })

  try {
    const result = await workflow.start(question, {
      connectionId: id,
      onProgress: (progress) =>
        manager.send(id, { type: 'workflow_progress', ...progress, sessionId }),
      onAsk: sendAsk,
      onToken: (chunk) => manager.send(id, { type: 'token', content: chunk, sessionId }),
      signal: controller.signal,
    })
    manager.send(id, {
      type: 'agent_response',
      success: result.success,
      content: result.content,
      error: result.error,
      sessionId,
    })
    // 研究结束：清理 checkpoint，避免重复恢复
    workflow.clearCheckpoint(result.state?.taskId)
    pushUsageSummary(id)
  } catch (error) {
    // dph-A 可取消：识别取消信号，回复"已停止"，不当作系统错误
    if (error?.code === 'ABORTED' || error?.name === 'AbortError') {
      manager.send(id, {
        type: 'agent_response',
        success: false,
        content: '已停止本次回答。',
        error: 'cancelled',
        sessionId,
      })
    } else {
      console.error('[Workflow] Error:', error)
      manager.send(id, {
        type: 'agent_response',
        success: false,
        content: '深度研究执行出错。',
        error: error.message,
        sessionId,
      })
    }
  } finally {
    if (sessions) sessions.releaseTurn(sessionId)
    activeWorkflows.delete(wfKey)
    const pendingAsk = pendingWorkflowAsks.get(wfKey)
    if (pendingAsk) {
      clearTimeout(pendingAsk.timer)
      pendingWorkflowAsks.delete(wfKey)
    }
  }
}

/**
 * 把轻量页面上下文附加到系统提示词（F1）——见 ../core/prompt-context.js
 */

module.exports = {
  manager,
  wss,
  getLastActiveConnectionId: () => {
    if (lastActiveConnectionId !== null && manager.getIds().includes(lastActiveConnectionId)) {
      return lastActiveConnectionId
    }
    const ids = manager.getIds()
    return ids.length > 0 ? Math.max(...ids) : null
  },
  send: (id, cmd) => manager.send(id, cmd),
  broadcast: (cmd) => manager.broadcast(cmd),
  getPerformance: (id) => manager.send(id, { type: 'get_performance' }),
  appendPageContext,
  appendPrefs,
}
