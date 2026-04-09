require('dotenv').config()
const { Agent } = require('./agent.js')
const { tools } = require('./tools.js')
const readline = require('readline')

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

const agent = new Agent()

function askQuestion(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve)
  })
}

async function chat() {
  console.log('🤖 欢迎来到火山引擎豆包聊天！')
  console.log('💬 输入消息开始对话，输入 "exit" 或 "quit" 退出')
  console.log('🔄 输入 "clear" 清空对话历史')
  console.log('🔧 可用工具:')
  tools.forEach((tool) => {
    console.log(`   - ${tool.name}: ${tool.description}`)
  })
  console.log('─'.repeat(60))

  while (true) {
    const userInput = await askQuestion('\n👤 你: ')

    if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
      console.log('👋 再见！')
      rl.close()
      break
    }

    if (userInput.toLowerCase() === 'clear') {
      agent.clearHistory()
      console.log('✅ 对话历史已清空')
      continue
    }

    if (!userInput.trim()) {
      continue
    }

    console.log('\n🤖 豆包正在思考...')

    try {
      const result = await agent.process(userInput)
      console.log(`\n🤖 豆包: ${result.content}`)
    } catch (error) {
      console.error('\n❌ 错误:', error.message)
    }
  }
}

chat()
