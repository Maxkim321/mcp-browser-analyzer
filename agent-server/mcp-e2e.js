/**
 * P9 MCP 全真端到端测试（区别于单测的假 server）：真 LLM 决策 + 真 filesystem MCP server + 真磁盘写入
 *
 * 链路：registerMcpServer（npx 真 server 子进程）→ Agent（真 LLM）自主决定调用 mcp_fs_* 工具
 *      → 工具流水线（dangerLevel 定级 → 写操作审批 → 超时/留痕）→ MCP JSON-RPC → server → 真实文件系统
 *
 * 诚实边界：审批环节由脚本程序化"点击允许"（与插件审批卡走同一 createPermissionCheck 代码路径，
 * 仅 WS 传输层不同）；其余全部为真——LLM 是真模型、server 是真进程、文件真落盘。
 *
 * 用法：pnpm -F agent-server mcp:e2e   （需 ARK_API_KEY 可用）
 */
require('dotenv').config()
const fs = require('fs')
const path = require('path')

const handler = require('./src/tools/handler.js')
const mcpRegistry = require('./src/tools/mcp-registry.js')
const { Agent } = require('./src/core/agent.js')
const { createPermissionCheck } = require('./src/core/approval.js')
const memoryWire = require('./src/memory/wire.js')
const { SYSTEM_PROMPT } = require('./src/config/prompts.js')

const SCOPE = path.join(__dirname, 'mcp-e2e-scope')
const TARGET = path.join(SCOPE, '真机测试.md')

// handleToolCall 有 WS 初始化门槛（本地工具要连浏览器扩展）；脚本按评测既有模式注入 stub manager，
// 让 MCP 工具走同一条分发/流水线入口——与 memory-arm 评测同一做法
handler.init({ manager: { getIds: () => [], getCount: () => 0 }, send: () => true })

async function runPrompt(agent, prompt, { label }) {
  console.log(`\n━━━ ${label} ━━━`)
  console.log(`👤 用户: ${prompt}`)
  // 与 ws-server 相同的组装方式：记忆召回（auto→hybrid，真查询向量化）注入 systemPrompt
  const recalled = await memoryWire.recallForPrompt(prompt)
  const systemPrompt = recalled ? `${SYSTEM_PROMPT}\n\n${recalled.block}` : SYSTEM_PROMPT
  if (recalled) {
    console.log(
      `🧠 [记忆召回 ${recalled.refs.length} 张] channels: ${recalled.refs
        .map((r) => `${r.channels?.bm25 ? 'K' : ''}${r.channels?.vector ? 'V' : ''}` || '?')
        .join(',')}`
    )
  }
  const steps = []
  const result = await agent.process(prompt, {
    connectionId: 1,
    systemPrompt,
    permissionCheck: createPermissionCheck({
      // 审批 = 插件端用户点"允许"的程序化等价（同一 createPermissionCheck 契约），真实 UI 在扩展侧边栏
      requestApproval: async ({ toolName, args }) => {
        console.log(`  🔔 [审批卡] ${toolName} → ✅ 允许（程序化点击，真机由用户在侧边栏点击）`)
        return { approved: true, note: 'e2e 自动允许' }
      },
      writeBudget: 8,
    }),
    onStep: (s) => {
      if (s.tool || s.toolName) steps.push(s.toolName || s.tool)
    },
  })
  console.log(`🤖 Agent: ${String(result.content || result.error || '').slice(0, 300)}`)
  console.log(`🔧 实际调用工具序列: ${steps.join(' → ') || '(无)'}`)
  return { result, steps }
}

async function main() {
  fs.rmSync(SCOPE, { recursive: true, force: true })
  fs.mkdirSync(SCOPE, { recursive: true })
  // 预置一个真实文件，让"列目录/读文件"有真数据可读
  fs.writeFileSync(path.join(SCOPE, 'README.md'), '# MCP e2e 作用域\n这是 filesystem server 的真实作用域目录。\n')

  console.log('=== 1) 接入真实 MCP server（npx @modelcontextprotocol/server-filesystem）===')
  const { registered, rejected } = await mcpRegistry.registerMcpServer({
    name: 'fs',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', SCOPE],
    shell: process.platform === 'win32',
    timeoutMs: 60000,
  })
  console.log(`纳管 ${registered.length}: ${registered.join(', ')}`)
  if (rejected.length) console.log(`拒绝: ${JSON.stringify(rejected)}`)
  if (registered.length === 0) throw new Error('没有工具被纳管')

  const agent = new Agent()

  console.log('\n=== 2) 真机测试：读（零打断）===')
  const r1 = await runPrompt(
    agent,
    `用你的文件工具列出 ${SCOPE} 目录下有哪些文件，并告诉我每个文件名。不要使用其他工具。`,
    { label: 'TEST-1 列目录（read，应零审批直接执行）' }
  )

  console.log('\n=== 3) 真机测试：写（走审批卡）===')
  const r2 = await runPrompt(
    agent,
    `用文件写入工具在 ${SCOPE} 目录创建文件「真机测试.md」，内容为：\n# MCP 全链路真机测试\n本文件由 Browser Assistant agent 通过 MCP 协议真实写入。`,
    { label: 'TEST-2 写文件（write，应弹审批 → 允许 → 真实落盘）' }
  )

  console.log('\n=== 4) 真机测试：回读验证 ===')
  const r3 = await runPrompt(
    agent,
    `用文件读取工具读取 ${SCOPE} 目录下「真机测试.md」的完整内容并原样告诉我。`,
    { label: 'TEST-3 读回文件（read）' }
  )

  console.log('\n=== 5) 磁盘真值验证（绕开 agent，直接看文件系统）===')
  const exists = fs.existsSync(TARGET)
  const disk = exists ? fs.readFileSync(TARGET, 'utf8') : '(文件不存在)'
  console.log(`文件存在: ${exists}`)
  console.log(`磁盘内容: ${disk.trim().slice(0, 200)}`)
  const pass =
    exists &&
    disk.includes('MCP 全链路真机测试') &&
    r2.steps.some((s) => String(s).includes('write')) &&
    r3.steps.some((s) => String(s).includes('read'))
  console.log(`\n${pass ? '✅ 全真链路 PASS：LLM 决策 → MCP 协议调用 → 审批 → 真实落盘 → 回读一致' : '❌ FAIL'}`)
  mcpRegistry.shutdownAll()
  process.exit(pass ? 0 : 1)
}

main().catch((e) => {
  console.error('e2e 失败:', e.message)
  process.exit(1)
})
