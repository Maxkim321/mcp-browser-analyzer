require('dotenv').config()

const ws = require('./ws-server.js')

/**
 * 主函数 - 启动 Agent 服务器
 * 启动 WebSocket 服务并初始化交互式命令行测试界面
 */
async function main() {
  console.log('[Agent Server] Starting...')
  setupCli()
}

/**
 * 设置交互式命令行测试界面
 * 支持通过命令行手动测试 WebSocket 功能
 * 可用命令：list, getperf <id>, broadcast <msg>, exit
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
  console.error('[Agent Server] Error:', err)
  process.exit(1)
})
