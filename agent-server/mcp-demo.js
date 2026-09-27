/**
 * MCP 真实落地演示（P9）：接入官方 filesystem server，验证三道闸 + 审批管线
 *
 * 前置：MCP_SERVERS 未配也能跑——本脚本自带 server 配置。
 * 场景：浏览器 agent 一句话把页面总结存进本地文件（save_note/write_file 是 write 级，走审批卡）。
 * 用法：pnpm -F agent-server mcp:demo
 */
require('dotenv').config()
const fs = require('fs')
const path = require('path')
const os = require('os')

const mcpRegistry = require('./src/tools/mcp-registry.js')
const { isWriteTool } = require('./src/tools/index.js')

async function main() {
  const scopeDir = path.join(os.tmpdir(), 'mcp-demo-scope')
  fs.mkdirSync(scopeDir, { recursive: true }) // server 要求目录必须已存在，否则启动即退
  console.log('=== MCP 落地演示：接入官方 @modelcontextprotocol/server-filesystem ===')
  console.log(`作用域目录（server 只能碰这里）: ${scopeDir}`)

  const { registered, rejected } = await mcpRegistry.registerMcpServer({
    name: 'fs',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', scopeDir],
    shell: process.platform === 'win32',
    timeoutMs: 60000,
  })
  console.log(`\n✅ 纳管 ${registered.length} 个工具：`)
  for (const name of registered) {
    console.log(`  - ${name}  [dangerLevel=${isWriteTool(name) ? 'write（走审批卡）' : 'read（零打断）'}]`)
  }
  if (rejected.length > 0) console.log(`🚫 拒绝注册：${JSON.stringify(rejected)}`)

  console.log('\n=== 已接入 server 视图（dashboard/trace 同源） ===')
  console.log(JSON.stringify(mcpRegistry.listServers(), null, 1))
  console.log('\n提示：配置到 .env 即可在真实对话中使用，例如')
  console.log(
    `MCP_SERVERS=[{"name":"fs","command":"npx","shell":true,"args":["-y","@modelcontextprotocol/server-filesystem","${scopeDir}"]}]\n`
  )
  mcpRegistry.shutdownAll()
}

main().catch((e) => {
  console.error('演示失败:', e.message)
  process.exit(1)
})
