const { spawn } = require('child_process')

/**
 * MCP（Model Context Protocol）客户端 —— stdio 传输 + JSON-RPC 2.0，零依赖
 *
 * 协议兼容两代（P9 面试点）：
 * - 2026-07-28 规范（SEP-2575）把 initialize/initialized 握手移除、协议核心转向
 *   stateless——请求通过 _meta 自带协议版本与客户端身份；
 * - 存量 stdio server 仍普遍要求先 initialize 才响应 tools/list。
 * 所以这里"**先探测、被拒再握手**"：直接发 tools/list，报错才走
 * initialize → notifications/initialized → 重试一次。两种形态都兼容，探测失败
 * 本身也是可观测事件（trace），而不是静默假设。
 *
 * 与本仓工具结果格式的巧合闭环：tools/call 返回 { content: [{type:'text',text}] }
 * 与 handler 的工具结果同形，MCP 工具纳管后无需任何结果转换。
 */

const DEFAULT_TIMEOUT_MS = 20000

function createMcpClient({ name, command, args = [], env, shell = false, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let child = null
  let seq = 0
  let dead = false
  let stderrTail = ''
  const pending = new Map() // id -> { resolve, reject, timer }
  const stdoutBuffer = { value: '' }

  function handleLine(line) {
    const trimmed = line.trim()
    if (!trimmed) return
    let msg
    try {
      msg = JSON.parse(trimmed)
    } catch {
      return // 非 JSON 行（server 日志混入 stdout）直接忽略，不炸连接
    }
    if (msg.id == null || !pending.has(msg.id)) return // notification / 未知 id
    const entry = pending.get(msg.id)
    clearTimeout(entry.timer)
    pending.delete(msg.id)
    if (msg.error) {
      const err = new Error(`MCP ${name} ${msg.error.message || 'request failed'}`)
      err.code = msg.error.code
      entry.reject(err)
    } else {
      entry.resolve(msg.result)
    }
  }

  function start() {
    if (child) return child
    child = spawn(command, args, {
      env: { ...process.env, ...(env || {}) },
      shell,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdoutBuffer.value += chunk
      let idx
      while ((idx = stdoutBuffer.value.indexOf('\n')) >= 0) {
        const line = stdoutBuffer.value.slice(0, idx)
        stdoutBuffer.value = stdoutBuffer.value.slice(idx + 1)
        handleLine(line)
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk).slice(-2000) // 只留尾部，报错时带上
    })
    child.on('exit', (code) => {
      dead = true
      for (const [, entry] of pending) {
        clearTimeout(entry.timer)
        entry.reject(new Error(`MCP ${name} 进程退出（code=${code}）${stderrTail ? ': ' + stderrTail.slice(-200) : ''}`))
      }
      pending.clear()
    })
    return child
  }

  function request(method, params, { timeout = timeoutMs } = {}) {
    if (dead) return Promise.reject(new Error(`MCP ${name} 已退出，无法调用 ${method}`))
    start()
    const id = ++seq
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`MCP ${name} ${method} 超时（${timeout}ms）`))
      }, timeout)
      pending.set(id, { resolve, reject, timer })
      child.stdin.write(payload)
    })
  }

  function notify(method, params) {
    start()
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  }

  /**
   * 列出服务端工具：先探测（stateless server 直接应答），报错再握手重试（存量 server）
   */
  async function listTools() {
    try {
      const r = await request('tools/list', {})
      return r?.tools || []
    } catch {
      // 探测被拒 = 存量形态，走握手再重试（不区分错误码：非 stateless server 的拒绝语不一）
      await request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'mcp-browser-analyzer', version: '1.0.0' },
      })
      notify('notifications/initialized', {})
      const r = await request('tools/list', {})
      return r?.tools || []
    }
  }

  /** 调用远程工具；isError 结果按错误上抛（让 pipeline 的重试/留痕看到失败） */
  async function callTool(toolName, toolArgs, { timeout } = {}) {
    const result = await request('tools/call', { name: toolName, arguments: toolArgs || {} }, { timeout })
    if (result?.isError) {
      const text = (result.content || []).map((c) => c.text || '').join('\n')
      throw new Error(`MCP 工具 ${toolName} 执行失败: ${text.slice(0, 300)}`)
    }
    return result
  }

  function close() {
    dead = true
    for (const [, entry] of pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error(`MCP ${name} 客户端关闭`))
    }
    pending.clear()
    if (child && child.exitCode === null) child.kill()
  }

  return { name, listTools, callTool, close, get alive() { return !dead } }
}

module.exports = { createMcpClient }
