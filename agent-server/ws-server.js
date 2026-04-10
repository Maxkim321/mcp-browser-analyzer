const WebSocket = require('ws')
const toolHandler = require('./tool-handler.js')
const { Agent } = require('./agent.js')
const config = require('./config.js')

const connectionAgents = new Map()

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
  })

  /**
   * 连接发生错误
   */
  ws.on('error', (err) => {
    console.error('[Error] Connection:', err)
    manager.remove(connectionId)
    connectionAgents.delete(connectionId)
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
  switch (msg.type) {
    case 'performance_data':
      console.log('[Data] Performance:', msg.payload)
      toolHandler.handlePluginResponse(id, msg)
      break
    case 'ping':
      manager.send(id, { type: 'pong' })
      break
    case 'user_prompt':
      console.log('[Agent] Processing prompt:', msg.prompt)
      try {
        manager.send(id, { type: 'thinking' })
        // 将当前连接上下文透传给 Agent，工具调用可优先使用当前会话连接
        const result = await agent.process(msg.prompt, { connectionId: id })
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
    case 'clear_history':
      agent.clearHistory()
      manager.send(id, { type: 'history_cleared' })
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

module.exports = {
  manager,
  wss,
  send: (id, cmd) => manager.send(id, cmd),
  broadcast: (cmd) => manager.broadcast(cmd),
  getPerformance: (id) => manager.send(id, { type: 'get_performance' }),
}
