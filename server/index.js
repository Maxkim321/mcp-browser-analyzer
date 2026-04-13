require('dotenv').config()
const { Server } = require('@modelcontextprotocol/sdk/server/index.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')

const server = new Server(
  {
    name: 'browser-analyzer-server',
    version: '1.0.0',
  },
  {
    capabilities: {},
  }
)

// 使用环境变量
const modelApiKey = process.env.MODEL_API_KEY
const modelName = process.env.MODEL_NAME

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('Browser Analyzer MCP Server running on stdio')
  console.error(`Using model: ${modelName}`)
}

main().catch((error) => {
  console.error('Server error:', error)
  process.exit(1)
})
