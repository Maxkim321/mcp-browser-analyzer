const { Server } = require('@modelcontextprotocol/sdk/server/index.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')

const ws = require('./ws-server.js')

/**
 * 初始化 MCP 服务器
 */
const server = new Server(
  { name: 'browser-analyzer-server', version: '1.0.0' },
  { capabilities: {} }
)

/**
 * 主函数 - 启动服务器
 */
async function main() {
  console.log('[Server] Starting...')

  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[MCP] Server running on stdio')

  setupCli()
}

/**
 * 设置交互式命令行
 * 支持通过命令行测试 WebSocket 功能
 * 后期可以删除，模拟AI此处为
 */
function setupCli() {
  console.log('[Test] Commands: list, getperf <id>, broadcast <msg>, exit')

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
      case 'exit':
        process.exit(0)
    }
  })
}

main().catch((err) => {
  console.error('[Server] Error:', err)
  process.exit(1)
})
