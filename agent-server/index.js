// 加载环境变量配置
require('dotenv').config()

// 导入配置文件和工具模块
const config = require('./config.js')
const { tools } = require('./tools.js')

// 打印启动欢迎横幅
console.log('╔════════════════════════════════════════════════════════════╗')
console.log('║                    Agent Server 启动中...                      ║')
console.log('╚════════════════════════════════════════════════════════════╝')
console.log()

// 打印配置信息
console.log('📋 配置信息:')
console.log(`   - 服务端口: ${config.server.port}`)
console.log(`   - LLM 模型: ${config.llm.model}`)
console.log(`   - API Base: ${config.llm.baseURL}`)
console.log(`   - API Key: ${config.llm.apiKey ? '已配置' : '未配置'}`)
console.log()

// 打印可用工具列表
console.log('🔧 可用工具:')
tools.forEach((tool) => {
  console.log(`   - ${tool.name}: ${tool.description}`)
})
console.log()

// 启动 WebSocket 服务
require('./ws-server.js')

console.log('✅ WebSocket 服务已启动')
console.log()

// 打印最终提示信息
console.log('💡 提示:')
console.log('   - Agent Server 已准备就绪')
console.log('   - 等待 Chrome 插件连接...')
console.log('   - 使用 chat.js 进行交互式测试')
console.log()
console.log('─'.repeat(60))
