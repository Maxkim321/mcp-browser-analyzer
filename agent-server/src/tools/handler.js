const { v4: uuidv4 } = require('uuid')
const { runLighthouseAudit } = require('./lighthouse.js')

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
 * 处理 run_lighthouse_audit 工具
 * 在服务端启动 headless Chrome 跑完整 Lighthouse 审计，
 * 不经过浏览器插件转发，插件离线也可用
 * @param {object} args - 工具参数
 * @param {string} args.url - 要审计的页面 URL
 * @param {string[]} [args.categories] - 要审计的分类，默认全部四类
 * @param {string} traceId - 追踪ID
 * @returns {Promise<object>} MCP 响应格式
 */
async function handleLighthouseAudit(args, traceId) {
  const { url } = args
  const { categories } = args

  traceManager.addEvent(traceId, 'lighthouse_start', { url, categories })
  const summary = await runLighthouseAudit(url, { categories })
  traceManager.addEvent(traceId, 'lighthouse_done', { scores: summary.scores })

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(summary, null, 2),
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
 * 处理 navigate_to 工具
 * 向浏览器插件发送导航指令，等待页面加载完成
 * @param {object} args - 工具参数
 * @param {string} args.url - 要导航到的URL
 * @param {string} traceId - 追踪ID
 * @param {object} context - 运行上下文
 * @returns {Promise<object>} MCP响应格式
 */
async function handleNavigateTo(args, traceId, context = {}) {
  const connectionId = resolveConnectionId(args.connectionId, context)
  const { url } = args
  const requestId = uuidv4()

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId)
      traceManager.complete(traceId, 'error')
      reject(new Error('Navigation timeout'))
    }, 60000)

    pendingRequests.set(requestId, {
      resolve,
      reject,
      timeout,
      traceId,
    })

    traceManager.addEvent(traceId, 'navigate', { connectionId, url })
    const sendSuccess = ws.send(connectionId, { type: 'navigate_to', requestId, url })

    if (!sendSuccess) {
      clearTimeout(timeout)
      pendingRequests.delete(requestId)
      traceManager.complete(traceId, 'error')
      reject(new Error(`Connection ${connectionId} not available`))
    }
  })
}

/**
 * 处理 reload_page 工具
 * 向浏览器插件发送刷新页面指令
 * @param {object} args - 工具参数
 * @param {boolean} args.ignoreCache - 是否忽略缓存
 * @param {string} traceId - 追踪ID
 * @param {object} context - 运行上下文
 * @returns {Promise<object>} MCP响应格式
 */
async function handleReloadPage(args, traceId, context = {}) {
  const connectionId = resolveConnectionId(args.connectionId, context)
  const { ignoreCache = false } = args
  const requestId = uuidv4()

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId)
      traceManager.complete(traceId, 'error')
      reject(new Error('Reload timeout'))
    }, 60000)

    pendingRequests.set(requestId, {
      resolve,
      reject,
      timeout,
      traceId,
    })

    traceManager.addEvent(traceId, 'reload', { connectionId, ignoreCache })
    const sendSuccess = ws.send(connectionId, { type: 'reload_page', requestId, ignoreCache })

    if (!sendSuccess) {
      clearTimeout(timeout)
      pendingRequests.delete(requestId)
      traceManager.complete(traceId, 'error')
      reject(new Error(`Connection ${connectionId} not available`))
    }
  })
}

/**
 * 处理 wait_for_load 工具
 * 等待页面加载完成
 * @param {object} args - 工具参数
 * @param {number} args.timeout - 超时时间
 * @param {string} traceId - 追踪ID
 * @param {object} context - 运行上下文
 * @returns {Promise<object>} MCP响应格式
 */
async function handleWaitForLoad(args, traceId, context = {}) {
  const connectionId = resolveConnectionId(args.connectionId, context)
  const { timeout = 30000 } = args
  const requestId = uuidv4()

  return new Promise((resolve, reject) => {
    const timeoutTimer = setTimeout(() => {
      pendingRequests.delete(requestId)
      traceManager.complete(traceId, 'error')
      reject(new Error('Wait for load timeout'))
    }, timeout)

    pendingRequests.set(requestId, {
      resolve,
      reject,
      timeout: timeoutTimer,
      traceId,
    })

    traceManager.addEvent(traceId, 'wait_for_load', { connectionId, timeout })
    const sendSuccess = ws.send(connectionId, { type: 'wait_for_load', requestId, timeout })

    if (!sendSuccess) {
      clearTimeout(timeoutTimer)
      pendingRequests.delete(requestId)
      traceManager.complete(traceId, 'error')
      reject(new Error(`Connection ${connectionId} not available`))
    }
  })
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

/**
 * 处理 get_page_content 工具
 * 向浏览器插件发送获取页面正文的指令，并等待响应
 * @param {object} args - 工具参数
 * @param {number} [args.maxChars] - 返回内容最大字符数
 * @param {string} traceId - 追踪ID
 * @param {object} context - 运行上下文
 * @returns {Promise<object>} MCP响应格式
 */
async function handleGetPageContent(args, traceId, context = {}) {
  const connectionId = resolveConnectionId(args.connectionId, context)
  const { maxChars = 12000 } = args
  const requestId = uuidv4()

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId)
      traceManager.complete(traceId, 'error')
      reject(new Error('Page content timeout'))
    }, 30000)

    pendingRequests.set(requestId, {
      resolve,
      reject,
      timeout,
      traceId,
    })

    traceManager.addEvent(traceId, 'send_command', { connectionId, type: 'get_page_content', maxChars })
    const sendSuccess = ws.send(connectionId, { type: 'get_page_content', requestId, maxChars })

    if (!sendSuccess) {
      clearTimeout(timeout)
      pendingRequests.delete(requestId)
      traceManager.complete(traceId, 'error')
      reject(new Error(`Connection ${connectionId} not available`))
    }
  })
}

/**
 * 处理 fetch_url 工具（深度研究 M1-F8）
 * 向插件发送"后台新开 tab 读取指定 URL 正文"指令，等待响应
 * 与 get_page_content 复用同一套 requestId 异步匹配机制，区别是读指定 URL 而非当前页
 * @param {object} args - 工具参数
 * @param {string} args.url - 要读取的 URL
 * @param {number} [args.maxChars] - 返回内容最大字符数
 * @param {string} traceId - 追踪ID
 * @param {object} context - 运行上下文
 * @returns {Promise<object>} MCP响应格式
 */
async function handleFetchUrl(args, traceId, context = {}) {
  const connectionId = resolveConnectionId(args.connectionId, context)
  const { url } = args
  const { maxChars = 12000 } = args
  const requestId = uuidv4()

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId)
      traceManager.complete(traceId, 'error')
      reject(new Error('Fetch url timeout'))
    }, 45000)

    pendingRequests.set(requestId, {
      resolve,
      reject,
      timeout,
      traceId,
    })

    traceManager.addEvent(traceId, 'send_command', { connectionId, type: 'fetch_url', url, maxChars })
    const sendSuccess = ws.send(connectionId, { type: 'fetch_url', requestId, url, maxChars })

    if (!sendSuccess) {
      clearTimeout(timeout)
      pendingRequests.delete(requestId)
      traceManager.complete(traceId, 'error')
      reject(new Error(`Connection ${connectionId} not available`))
    }
  })
}

/**
 * 处理 web_search 工具（深度研究 M1-F8）
 * 向插件发送"后台新开搜索结果页并提取结果链接"指令，等待响应
 * 深度研究必须先搜到真实 URL 再抓正文，避免让 LLM 凭记忆编造不存在的链接
 * @param {object} args - 工具参数
 * @param {string} args.query - 搜索关键词
 * @param {number} [args.maxResults] - 返回结果条数上限
 * @param {string} traceId - 追踪ID
 * @param {object} context - 运行上下文
 * @returns {Promise<object>} MCP响应格式
 */
async function handleWebSearch(args, traceId, context = {}) {
  const connectionId = resolveConnectionId(args.connectionId, context)
  const { query } = args
  const { maxResults = 5 } = args
  const requestId = uuidv4()

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId)
      traceManager.complete(traceId, 'error')
      reject(new Error('Web search timeout'))
    }, 45000)

    pendingRequests.set(requestId, {
      resolve,
      reject,
      timeout,
      traceId,
    })

    traceManager.addEvent(traceId, 'send_command', { connectionId, type: 'web_search', query, maxResults })
    const sendSuccess = ws.send(connectionId, { type: 'web_search', requestId, query, maxResults })

    if (!sendSuccess) {
      clearTimeout(timeout)
      pendingRequests.delete(requestId)
      traceManager.complete(traceId, 'error')
      reject(new Error(`Connection ${connectionId} not available`))
    }
  })
}

/**
 * 写操作通用执行（P4 分级权限 HITL）
 * 前置审批已在 tool-pipeline 的 permissionCheck 完成，这里只负责执行：
 * 向插件发 write_action 指令 → content script 在页面 DOM 上执行 → 回传结果
 * @param {string} action - 动作类型：click / fill / select
 * @param {object} args - {selector, value?, description?}
 * @param {string} traceId - 追踪ID
 * @param {object} context - 运行上下文
 * @returns {Promise<object>} MCP 响应格式
 */
async function handleWriteAction(action, args, traceId, context = {}) {
  const connectionId = resolveConnectionId(args.connectionId, context)
  // P12a：selector → ref（元素引用身份），执行前由内容脚本校验（WeakRef+指纹）
  // P12b：fill_form 批量字段（审批卡一次展示全部，旧值→新值）
  const { ref, value, fields } = args
  const requestId = uuidv4()

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId)
      traceManager.complete(traceId, 'error')
      reject(new Error(`Write action timeout: ${action}`))
    }, 30000)

    pendingRequests.set(requestId, { resolve, reject, timeout, traceId })

    traceManager.addEvent(traceId, 'write_action', {
      connectionId,
      action,
      ref: ref || (Array.isArray(fields) ? fields.map((f) => f.ref).join(',') : null),
      value: value || undefined,
      fields: Array.isArray(fields) ? fields.length : undefined,
    })
    const sendSuccess = ws.send(connectionId, {
      type: 'write_action',
      requestId,
      action,
      ref,
      value,
      fields,
    })

    if (!sendSuccess) {
      clearTimeout(timeout)
      pendingRequests.delete(requestId)
      traceManager.complete(traceId, 'error')
      reject(new Error(`Connection ${connectionId} not available`))
    }
  })
}

/**
 * 枚举页面可交互元素（写操作的前置定位，只读）
 * @param {object} args - {maxElements?, connectionId?}
 * @param {string} traceId - 追踪ID
 * @param {object} context - 运行上下文
 * @returns {Promise<object>} MCP 响应格式
 */
async function handleGetInteractiveElements(args, traceId, context = {}) {
  const connectionId = resolveConnectionId(args.connectionId, context)
  const { maxElements = 30 } = args
  const requestId = uuidv4()

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId)
      traceManager.complete(traceId, 'error')
      reject(new Error('Get interactive elements timeout'))
    }, 30000)

    pendingRequests.set(requestId, { resolve, reject, timeout, traceId })

    traceManager.addEvent(traceId, 'send_command', { connectionId, type: 'get_interactive_elements' })
    const sendSuccess = ws.send(connectionId, {
      type: 'get_interactive_elements',
      requestId,
      maxElements,
    })

    if (!sendSuccess) {
      clearTimeout(timeout)
      pendingRequests.delete(requestId)
      traceManager.complete(traceId, 'error')
      reject(new Error(`Connection ${connectionId} not available`))
    }
  })
}

const toolHandlers = {
  navigate_to: handleNavigateTo,
  reload_page: handleReloadPage,
  wait_for_load: handleWaitForLoad,
  list_connections: handleListConnections,
  get_browser_performance: handleGetPerformance,
  run_lighthouse_audit: handleLighthouseAudit,
  get_page_content: handleGetPageContent,
  fetch_url: handleFetchUrl,
  web_search: handleWebSearch,
  broadcast_message: handleBroadcastMessage,
  todo_write: handleTodoWrite,
  get_interactive_elements: handleGetInteractiveElements,
  click_element: (args, traceId, context) => handleWriteAction('click', args, traceId, context),
  fill_input: (args, traceId, context) => handleWriteAction('fill', args, traceId, context),
  select_option: (args, traceId, context) => handleWriteAction('select', args, traceId, context),
  fill_form: (args, traceId, context) => handleWriteAction('fill_form', args, traceId, context),
  wait_for: handleWaitFor,
}

/**
 * P12b 等待页面文本出现（点击/提交后的异步结果等待，只读）
 * RPC 超时随请求的 timeoutMs 缩放（+10s 余量），避免固定 30s 截断 20s 等待
 */
async function handleWaitFor(args, traceId, context = {}) {
  const connectionId = resolveConnectionId(args.connectionId, context)
  const texts = Array.isArray(args.texts) ? args.texts.map(String) : []
  const timeoutMs = Math.min(Math.max(Number(args.timeoutMs) || 8000, 1000), 20000)
  if (texts.length === 0) throw new Error('wait_for 需要至少一个候选文本')
  const requestId = uuidv4()

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId)
      traceManager.complete(traceId, 'error')
      reject(new Error('wait_for timeout'))
    }, timeoutMs + 10000)

    pendingRequests.set(requestId, { resolve, reject, timeout, traceId })

    traceManager.addEvent(traceId, 'send_command', { connectionId, type: 'wait_for', texts, timeoutMs })
    const sendSuccess = ws.send(connectionId, {
      type: 'wait_for',
      requestId,
      texts,
      timeoutMs,
    })

    if (!sendSuccess) {
      clearTimeout(timeout)
      pendingRequests.delete(requestId)
      traceManager.complete(traceId, 'error')
      reject(new Error(`Connection ${connectionId} not available`))
    }
  })
}

/**
 * 工具覆盖表（评测用）
 * setToolOverrides 注册后，handleToolCall 命中的工具不再经插件转发，
 * 而是执行覆盖函数（args, context) => Promise<{content:[{type:'text',text}]}>。
 * 用途：评测环境把 get_page_content/fetch_url 指向本地 fixture，
 * 使黄金考题离线可复现，同时保留完整编排链路。
 */
let toolOverrides = {}
function setToolOverrides(map) {
  toolOverrides = map || {}
}

/** P9：动态工具处理器注册口（MCP 等外部工具的调用实现挂进来；定义在 tools/index.js） */
function registerToolHandler(name, fn) {
  if (typeof name === 'string' && name && typeof fn === 'function') toolHandlers[name] = fn
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
    const override = toolOverrides[name]
    if (override) {
      const result = await override(args, context)
      traceManager.complete(traceId, 'success')
      return result
    }

    const handler = toolHandlers[name]
    if (!handler) {
      throw new Error(`Unknown tool: ${name}`)
    }

    // dph-A 可取消：等待插件响应期间若 signal abort，立即 reject 并清理 pending
    const abortError = () => Object.assign(new Error('Tool cancelled'), { code: 'ABORTED' })
    const signal = context.signal

    let result
    if (signal) {
      if (signal.aborted) throw abortError()
      result = await new Promise((resolve, reject) => {
        const onAbort = () => {
          // 清理本 trace 尚未完成的 pending request，避免残留 timeout 与后台任务
          for (const [requestId, entry] of pendingRequests) {
            if (entry.traceId === traceId) {
              clearTimeout(entry.timeout)
              pendingRequests.delete(requestId)
            }
          }
          reject(abortError())
        }
        signal.addEventListener('abort', onAbort, { once: true })
        // Promise.resolve 包装：handler 可能是同步函数（如 todo_write），直接 .then 会 TypeError
        Promise.resolve(handler(args, traceId, context)).then(
          (value) => {
            signal.removeEventListener('abort', onAbort)
            resolve(value)
          },
          (err) => {
            signal.removeEventListener('abort', onAbort)
            reject(err)
          }
        )
      })
    } else {
      result = await handler(args, traceId, context)
    }
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
  if (msg.requestId) {
    const pending = pendingRequests.get(msg.requestId)
    if (pending) {
      clearTimeout(pending.timeout)
      pendingRequests.delete(msg.requestId)

      // 插件明确报错时必须 reject：否则失败会被伪装成"成功但没内容"，
      // 上层（深度研究）无法区分"页面没正文"和"抓取压根失败"，最终报出无来源空报告
      const pluginError = msg.payload?.error || (msg.success === false ? msg.error : null)
      if (pluginError) {
        traceManager.addEvent(pending.traceId, 'error', { message: String(pluginError) })
        traceManager.complete(pending.traceId, 'error')
        pending.reject(new Error(String(pluginError)))
        return
      }

      // 根据消息类型添加不同的追踪事件
      let eventType = 'receive_response'
      let responseText = 'Operation completed successfully'

      if (msg.type === 'performance_data') {
        eventType = 'receive_data'
        responseText = JSON.stringify(msg.payload, null, 2)
      } else if (msg.type === 'interactive_elements' && msg.payload?.snapshot) {
        // P12a：伪 HTML 快照直接给 LLM（Skyvern A/B：HTML 表示优于 JSON——
        // 成功率 +3.9%、token -11%），结构化 elements 留在 payload 供评测/审计
        responseText = `页面可交互元素快照（ref 来自最近一次枚举，失效会被拒绝并要求重新枚举）：\n${msg.payload.snapshot}`
      } else if (msg.type === 'write_action_result' && msg.payload?.info) {
        // 写动作结果用人类可读 info（含"页面有响应/无变化"自诊字段），不灌 JSON
        const fieldsLine = Array.isArray(msg.payload.fields)
          ? '；' + msg.payload.fields.map((f) => `${f.label}: ${f.before}→${f.after}`).join('，')
          : ''
        responseText =
          (msg.payload.value ? `${msg.payload.info}（当前值: ${msg.payload.value}）` : msg.payload.info) + fieldsLine
      } else if (msg.type === 'wait_for_result') {
        // P12b：等待结果人类可读化
        responseText = msg.payload?.found
          ? `等待完成：页面已出现「${msg.payload.matched}」（${msg.payload.waitedMs ?? '?'}ms）`
          : `等待超时：候选文本均未在页面出现${msg.payload?.info ? '（' + msg.payload.info + '）' : ''}`
      } else if (msg.payload) {
        responseText = JSON.stringify(msg.payload, null, 2)
      } else if (msg.message) {
        responseText = msg.message
      }
      
      traceManager.addEvent(pending.traceId, eventType, msg.payload || msg)
      pending.resolve({
        content: [
          {
            type: 'text',
            text: responseText,
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
  setToolOverrides,
  registerToolHandler,
  traceManager,
}
