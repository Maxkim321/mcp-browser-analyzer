const WebSocket = require('ws')
const toolHandler = require('../tools/handler.js')
const { Agent } = require('../core/agent.js')
const { LLMClient } = require('../core/llm.js')
const { ResearchWorkflow } = require('../core/workflow.js')
const config = require('../config/index.js')
const { ACTION_PROMPTS, SYSTEM_PROMPT } = require('../config/prompts.js')
const { appendPageContext, appendPrefs } = require('../core/prompt-context.js')

const connectionAgents = new Map()

// 深度研究（M1-F8）：每连接只允许一个工作流运行（防止并发烧 token）
const activeWorkflows = new Map()
// HITL 等待答复：connectionId → { resolve, timer }
const pendingWorkflowAsks = new Map()

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

toolHandler.init({
  manager,
  send: (id, cmd) => manager.send(id, cmd),
  broadcast: (cmd) => manager.broadcast(cmd),
  getPerformance: (id) => manager.send(id, { type: 'get_performance' }),
})

/**
 * 启动 WebSocket 服务器
 * 监听端口 9999，处理客户端连接和消息
 */
const wss = new WebSocket.Server({ port: config.server.port })
console.log(`[WebSocket] Server started on port ${config.server.port}`)

/**
 * 处理新的客户端连接
 */
wss.on('connection', (ws) => {
  const connectionId = manager.add(ws)
  const agent = new Agent()
  connectionAgents.set(connectionId, agent)

  /**
   * 接收并处理客户端消息
   */
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString())
      console.log(`[Receive] From ${connectionId}:`, msg)
      await handleMessage(connectionId, msg, agent)
    } catch (err) {
      console.error('[Error] Parse message:', err)
    }
  })

  /**
   * 客户端断开连接
   */
  ws.on('close', () => {
    manager.remove(connectionId)
    connectionAgents.delete(connectionId)
    // 清理该连接的深度研究资源（工作流标记 + HITL 等待）
    activeWorkflows.delete(connectionId)
    const pendingAsk = pendingWorkflowAsks.get(connectionId)
    if (pendingAsk) {
      clearTimeout(pendingAsk.timer)
      pendingWorkflowAsks.delete(connectionId)
      pendingAsk.resolve({ cancel: true, text: '' })
    }
  })

  /**
   * 连接发生错误
   */
  ws.on('error', (err) => {
    console.error('[Error] Connection:', err)
    manager.remove(connectionId)
    connectionAgents.delete(connectionId)
    activeWorkflows.delete(connectionId)
    const pendingAsk = pendingWorkflowAsks.get(connectionId)
    if (pendingAsk) {
      clearTimeout(pendingAsk.timer)
      pendingWorkflowAsks.delete(connectionId)
      pendingAsk.resolve({ cancel: true, text: '' })
    }
  })
})

/**
 * 处理客户端消息
 * 根据消息类型分发到不同的处理逻辑
 * @param {number} id - 连接 ID
 * @param {object} msg - 消息对象
 * @param {Agent} agent - 该连接的 Agent 实例
 */
async function handleMessage(id, msg, agent) {
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
    case 'user_prompt':
      console.log('[Agent] Processing prompt:', msg.prompt)
      try {
        // M1-F8 深度研究：显式 action 或研究型提问 → 走 LangGraph 式状态机工作流
        const isResearch = msg.action === 'research' || isResearchPrompt(msg.prompt)
        if (isResearch) {
          await runResearch(id, msg.prompt)
          break
        }
        if (activeWorkflows.has(id)) {
          manager.send(id, {
            type: 'agent_response',
            success: false,
            content: '深度研究正在进行中，请等待其完成后再提问。',
          })
          break
        }
        manager.send(id, { type: 'thinking' })
        // 固定动作（总结/翻译/解释等）使用专用提示词驱动结构化输出
        // F1 轻量 pageContext + F5 偏好：仅普通对话注入（固定动作的 prompt 是严格模板，塞上下文会破坏结构化输出）
        let systemPrompt = msg.action ? ACTION_PROMPTS[msg.action] : SYSTEM_PROMPT
        if (!msg.action && msg.pageContext) {
          systemPrompt = appendPageContext(systemPrompt, msg.pageContext)
        }
        if (!msg.action && msg.prefs) {
          systemPrompt = appendPrefs(systemPrompt, msg.prefs)
        }
        // 将当前连接上下文透传给 Agent，工具调用可优先使用当前会话连接
        // onToken：LLM 文本增量实时分片推送（流式输出），最终结果仍由 agent_response 兜底
        const result = await agent.process(msg.prompt, {
          connectionId: id,
          systemPrompt,
          onToken: (chunk) => manager.send(id, { type: 'token', content: chunk }),
        })
        manager.send(id, {
          type: 'agent_response',
          success: result.success,
          content: result.content,
          error: result.error,
        })
      } catch (error) {
        console.error('[Agent] Error:', error)
        manager.send(id, {
          type: 'agent_response',
          success: false,
          content: '抱歉，处理你的请求时出错了。',
          error: error.message,
        })
      }
      break
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
    case 'clear_history':
      agent.clearHistory()
      manager.send(id, { type: 'history_cleared' })
      break
    case 'restore_session':
      // F4 会话持久化：插件把 chrome.storage.local 持久化的历史重放过来，
      // 重建新连接 Agent 的上下文（每次重连服务端都是全新 Agent，重放总是安全）
      {
        const count = agent.restoreHistory(msg.history)
        manager.send(id, { type: 'history_restored', count })
      }
      break
    default:
      console.warn(`[Message] Unknown message type from ${id}:`, msg.type)
      manager.send(id, {
        type: 'agent_response',
        success: false,
        content: '不支持的消息类型，请检查客户端协议。',
      })
      break
  }
}

/**
 * 研究型提问检测（M1-F8 意图路由）
 * 关键词规则可控、可讲、零成本；显式 action: 'research' 始终触发
 * 精确意图路由（LLM 判断）会增加一次调用成本，第一版用规则，后续可升级
 */
function isResearchPrompt(prompt) {
  if (typeof prompt !== 'string' || prompt.trim().length < 8) return false
  return /研究|调研|调查|对比|搞清楚|查明白|分析报告|研究报告|区别|差异|来龙去脉|原理|机制/.test(prompt)
}

/**
 * 运行深度研究工作流（M1-F8）
 * - 注册 activeWorkflows 防止并发
 * - 推送 workflow_progress（进度）
 * - HITL：workflow_ask 推送 + 等待 workflow_answer
 * - 完成/失败后发 agent_response（报告即最终答复），并清理 checkpoint
 */
async function runResearch(id, question) {
  if (activeWorkflows.has(id)) {
    manager.send(id, {
      type: 'agent_response',
      success: false,
      content: '深度研究正在进行中，请等待其完成后再提问。',
    })
    return
  }

  const workflow = new ResearchWorkflow(new LLMClient(), {
    maxTopics: 3,
    maxPagesPerTopic: 3,
    maxAttempts: 2,
  })
  activeWorkflows.set(id, workflow)

  const sendAsk = (askQuestion, options) =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingWorkflowAsks.delete(id)
        resolve({ cancel: false, text: '继续研究', timeout: true })
      }, 120000) // HITL 超时兜底：用户不答复 2 分钟后默认继续，不挂死工作流
      pendingWorkflowAsks.set(id, { resolve, timer })
      manager.send(id, {
        type: 'workflow_ask',
        question: askQuestion,
        options: options || ['继续研究', '停止研究'],
      })
    })

  try {
    const result = await workflow.start(question, {
      connectionId: id,
      onProgress: (progress) => manager.send(id, { type: 'workflow_progress', ...progress }),
      onAsk: sendAsk,
      onToken: (chunk) => manager.send(id, { type: 'token', content: chunk }),
    })
    manager.send(id, {
      type: 'agent_response',
      success: result.success,
      content: result.content,
      error: result.error,
    })
    // 研究结束：清理 checkpoint，避免重复恢复
    workflow.clearCheckpoint(result.state?.taskId)
  } catch (error) {
    console.error('[Workflow] Error:', error)
    manager.send(id, {
      type: 'agent_response',
      success: false,
      content: '深度研究执行出错。',
      error: error.message,
    })
  } finally {
    activeWorkflows.delete(id)
    const pendingAsk = pendingWorkflowAsks.get(id)
    if (pendingAsk) {
      clearTimeout(pendingAsk.timer)
      pendingWorkflowAsks.delete(id)
    }
  }
}

/**
 * 把轻量页面上下文附加到系统提示词（F1）——见 ../core/prompt-context.js
 */

module.exports = {
  manager,
  wss,
  send: (id, cmd) => manager.send(id, cmd),
  broadcast: (cmd) => manager.broadcast(cmd),
  getPerformance: (id) => manager.send(id, { type: 'get_performance' }),
  appendPageContext,
  appendPrefs,
}
