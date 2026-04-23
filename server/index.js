const { Server } = require('@modelcontextprotocol/sdk/server/index.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')

const ws = require('./ws-server.js')
const { tools } = require('./tools.js')
const { handleToolCall, traceManager } = require('./tool-handler.js')

/**
 * 初始化 MCP 服务器
 * 配置服务器名称、版本和能力声明
 */
const server = new Server(
  { name: 'browser-analyzer-server', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

/**
 * 注册 MCP tools/list 请求处理器
 * 返回所有可用的工具列表
 */
server.setRequestHandler('tools/list', async () => {
  return { tools }
})

/**
 * 注册 MCP tools/call 请求处理器
 * 执行指定的工具调用并返回结果
 * @param {string} name - 工具名称
 * @param {object} arguments - 工具参数
 */
server.setRequestHandler('tools/call', async ({ name, arguments: args }) => {
  return await handleToolCall(name, args)
})

/**
 * 主函数 - 启动服务器
 * 建立 MCP 传输连接并启动交互式命令行测试界面
 */
async function main() {
  console.log('[Server] Starting...')

  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[MCP] Server running on stdio')

  setupCli()
}

/**
 * 设置交互式命令行测试界面
 * 支持通过命令行手动测试 WebSocket 功能
 * 可用命令：list, getperf <id>, broadcast <msg>, trace <id>, exit
 */
function setupCli() {
  console.log('[Test] Commands: list, getperf <id>, broadcast <msg>, trace <id>, exit')

  process.stdin.on('data', (data) => {
    const input = data.toString().trim()
    if (!input) return

    const [cmd, ...args] = input.split(' ')
    switch (cmd) {
      case 'list':
        console.log('[Test] Clients:', ws.manager.getCount(), 'IDs:', ws.manager.getIds())
        break
      case 'getperf':
        args[0] && ws.getPerformance(parseInt(args[0]))
        break
      case 'broadcast':
        args.length && ws.broadcast({ type: 'broadcast', message: args.join(' ') })
        break
      case 'trace':
        args[0] && console.log('[Trace]', JSON.stringify(traceManager.get(args[0]), null, 2))
        break
      case 'exit':
        process.exit(0)
    }
  })
}

main().catch((err) => {
  console.error('[Server] Error:', err)
  process.exit(1)
})
