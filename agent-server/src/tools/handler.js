const { v4: uuidv4 } = require('uuid')

/**
 * 待处理请求映射
 * 用于存储等待插件响应的 MCP 工具调用请求
 * key: requestId, value: { resolve, reject, timeout, traceId }
 */
const pendingRequests = new Map()

let ws = null

/**
 * 初始化 WebSocket 模块引用
 * 用于解决循环依赖问题，避免在模块加载时直接 require ws-server
 * @param {object} wsModule - WebSocket 模块对象，包含 manager、send、broadcast、getPerformance 等方法
 */
function init(wsModule) {
  ws = wsModule
}

module.exports.init = init

/**
 * 规范化并校验 connectionId
 * 支持工具参数显式传入，未传入时回退到上下文 connectionId
 * @param {number|string|undefined} providedId - 工具参数中的连接ID
 * @param {object} context - 运行上下文
 * @returns {number} 规范化后的连接ID
 */
function resolveConnectionId(providedId, context = {}) {
  const rawId = providedId ?? context.connectionId
  const normalized = Number(rawId)
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error('Invalid connectionId')
  }
  return normalized
}

/**
 * 追踪管理器
 * 用于记录和管理 MCP 工具调用的完整执行链路
 */
class TraceManager {
  constructor() {
    this.traces = new Map()
  }

  /**
   * 创建一个新的追踪记录
   * @param {string} [traceId] - 可选的追踪ID，不提供则自动生成
   * @param {string} [parentId] - 父追踪ID，用于嵌套调用
   * @param {string} name - 追踪名称，描述此次操作
   * @returns {object} 追踪对象
   */
  create(traceId, parentId, name) {
    const trace = {
      id: traceId || uuidv4(),
      parentId,
      name,
      startTime: Date.now(),
      endTime: null,
      status: 'pending',
      events: [],
    }
    this.traces.set(trace.id, trace)
    return trace
  }

  /**
   * 添加事件到追踪记录
   * @param {string} traceId - 追踪ID
   * @param {string} eventType - 事件类型
   * @param {object} data - 事件数据
   */
  addEvent(traceId, eventType, data) {
    const trace = this.traces.get(traceId)
    if (trace) {
      trace.events.push({
        type: eventType,
        timestamp: Date.now(),
        data,
      })
    }
  }

  /**
   * 完成追踪记录
   * @param {string} traceId - 追踪ID
   * @param {string} [status='success'] - 最终状态
   * @returns {object} 完成的追踪对象
   */
  complete(traceId, status = 'success') {
    const trace = this.traces.get(traceId)
    if (trace) {
      trace.endTime = Date.now()
      trace.status = status
    }
    return trace
  }

  /**
   * 获取追踪记录
   * @param {string} traceId - 追踪ID
   * @returns {object|null} 追踪对象
   */
  get(traceId) {
    return this.traces.get(traceId)
  }
}

const traceManager = new TraceManager()

/**
 * 处理 list_connections 工具
 * 列出当前所有连接的浏览器插件
 * @param {object} args - 工具参数
 * @param {string} traceId - 追踪ID
 * @returns {object} MCP 响应格式
 */
// eslint-disable-next-line no-unused-vars
function handleListConnections(args, traceId) {
  const ids = ws.manager.getIds()
  const count = ws.manager.getCount()
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ count, connectionIds: ids }, null, 2),
      },
    ],
  }
}

/**
 * 处理 get_browser_performance 工具
 * 向指定浏览器插件发送获取性能数据的指令，并等待响应
 * @param {object} args - 工具参数
 * @param {number} args.connectionId - 浏览器插件连接ID
 * @param {string} traceId - 追踪ID
 * @returns {Promise<object>} MCP 响应格式
 */
async function handleGetPerformance(args, traceId, context = {}) {
  const connectionId = resolveConnectionId(args.connectionId, context)
  const requestId = uuidv4()

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId)
      traceManager.complete(traceId, 'error')
      reject(new Error('Request timeout'))
    }, 10000)

    pendingRequests.set(requestId, {
      resolve,
      reject,
      timeout,
      traceId,
    })

    traceManager.addEvent(traceId, 'send_command', { connectionId, type: 'get_performance' })
    const sendSuccess = ws.send(connectionId, { type: 'get_performance', requestId })

    // 连接不可用时立即失败，避免无意义等待到超时
    if (!sendSuccess) {
      clearTimeout(timeout)
      pendingRequests.delete(requestId)
      traceManager.complete(traceId, 'error')
      reject(new Error(`Connection ${connectionId} not available`))
    }
  })
}

/**
 * 处理 broadcast_message 工具
 * 向所有连接的浏览器插件广播消息
 * @param {object} args - 工具参数
 * @param {string} args.message - 要广播的消息内容
 * @param {string} traceId - 追踪ID
 * @returns {object} MCP 响应格式
 */
function handleBroadcastMessage(args, traceId) {
  const { message } = args
  traceManager.addEvent(traceId, 'broadcast', { message })
  ws.broadcast({ type: 'broadcast', message })
  return {
    content: [
      {
        type: 'text',
        text: 'Message broadcasted successfully',
      },
    ],
  }
}

/**
 * 处理 todo_write 工具
 * 接收任务列表并格式化返回给LLM
 * @param {object} args - 工具参数
 * @param {Array} args.todos - 任务列表
 * @param {string} traceId - 追踪ID
 * @returns {object} MCP响应格式
 */
function handleTodoWrite(args, traceId) {
  const { todos } = args
  
  traceManager.addEvent(traceId, 'todo_updated', { todos })
  
  const summary = formatTodoSummary(todos)
  return {
    content: [
      {
        type: 'text',
        text: summary,
      },
    ],
  }
}

/**
 * 格式化任务列表为友好的可读格式
 * 添加进度百分比、状态图标和优先级图标
 * @param {Array} todos - 任务列表
 * @returns {string} 格式化后的任务摘要
 */
function formatTodoSummary(todos) {
  if (!todos || todos.length === 0) {
    return '暂无任务'
  }
  
  const completed = todos.filter(t => t.status === 'completed').length
  const total = todos.length
  const progress = Math.round((completed / total) * 100)
  
  let summary = `📋 任务列表 (${progress}% 完成)\n`
  summary += `─`.repeat(40) + '\n'
  
  todos.forEach((todo) => {
    let statusIcon = ''
    switch (todo.status) {
      case 'completed':
        statusIcon = '✅'
        break
      case 'in_progress':
        statusIcon = '🔄'
        break
      default:
        statusIcon = '⏳'
    }
    
    let priorityIcon = ''
    switch (todo.priority) {
      case 'high':
        priorityIcon = '🔴'
        break
      case 'medium':
        priorityIcon = '🟡'
        break
      default:
        priorityIcon = '🟢'
    }
    
    summary += `${statusIcon} ${priorityIcon} [${todo.id}] ${todo.content}\n`
  })
  
  return summary
}

const toolHandlers = {
  list_connections: handleListConnections,
  get_browser_performance: handleGetPerformance,
  broadcast_message: handleBroadcastMessage,
  todo_write: handleTodoWrite,
}

/**
 * 处理 MCP 工具调用
 * @param {string} name - 工具名称
 * @param {object} args - 工具参数
 * @returns {Promise<object>} MCP 响应格式
 */
async function handleToolCall(name, args, context = {}) {
  if (!ws || !ws.manager) {
    throw new Error('WebSocket module is not initialized')
  }

  const traceId = uuidv4()
  traceManager.create(traceId, null, `tool:${name}`)
  traceManager.addEvent(traceId, 'tool_call', { name, args })

  try {
    const handler = toolHandlers[name]
    if (!handler) {
      throw new Error(`Unknown tool: ${name}`)
    }

    const result = await handler(args, traceId, context)
    traceManager.complete(traceId, 'success')
    return result
  } catch (error) {
    traceManager.addEvent(traceId, 'error', { message: error.message })
    traceManager.complete(traceId, 'error')
    throw error
  }
}

/**
 * 处理来自浏览器插件的响应消息
 * 将插件返回的数据匹配到对应的待处理请求并完成
 * @param {number} connectionId - 连接ID
 * @param {object} msg - 插件消息对象
 */
function handlePluginResponse(connectionId, msg) {
  if (msg.type === 'performance_data' && msg.requestId) {
    const pending = pendingRequests.get(msg.requestId)
    if (pending) {
      clearTimeout(pending.timeout)
      pendingRequests.delete(msg.requestId)
      traceManager.addEvent(pending.traceId, 'receive_data', msg.payload)
      pending.resolve({
        content: [
          {
            type: 'text',
            text: JSON.stringify(msg.payload, null, 2),
          },
        ],
      })
      traceManager.complete(pending.traceId, 'success')
    }
  }
}

module.exports = {
  init,
  handleToolCall,
  handlePluginResponse,
  traceManager,
}
