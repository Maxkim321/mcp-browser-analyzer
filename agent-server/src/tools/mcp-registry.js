const { createMcpClient } = require('../mcp/client.js')
const { tools, } = require('./index.js')
const { scanInjection } = require('../core/injection-guard.js')
const traceLog = require('../core/trace-log.js')

/**
 * MCP 工具注册中心（P9）——把第三方 MCP server 的工具纳管进本 agent 的治理管线
 *
 * 为什么"接入"本身要设安全闸：MCP 工具的描述与参数 schema 是**注册期攻击面**
 * （tool poisoning / line jumping，Invariant Labs 2025 / Trail of Bits 2025）——
 * 恶意指令藏在 description 里用户不可见，模型读 tools/list 时就被注入了，
 * 不需要任何调用发生。2026-07-28 规范连 initialize 都移除了、工具描述仍不设防，
 * 所以客户端侧的注册前扫描比以往更重要。
 *
 * 三道闸（顺序即安全设计）：
 * 1. **注入扫描（注册期）**：description + inputSchema 序列化文本过 injection-guard
 *    的 8 个中英模式；命中 → 拒绝注册 + trace 留痕（mcp_tool_rejected）。
 *    与运行时内容扫描（P7 检测不阻断）刻意不同：描述是**元数据**不是待分析数据，
 *    没有误报代价问题——宁错杀不放进 LLM 工具表。
 * 2. **dangerLevel 自动定级**：写暗示词 → write；只读暗示词 → read；
 *    两者都不匹配 → **默认 write**（宁严勿松：外来工具分不了级就按最危险处理，走人审）。
 * 3. **纳管**：工具定义 push 进 tools/index.js 共享数组（LLM 工具表、isWriteTool、
 *    pipeline 审批、轨迹判卷同一出口自动生效），处理器注册进 handler——调用走现有
 *    超时/取消/审批/事件溯源管线，MCP content 与本仓工具结果同形、零转换。
 *
 * 命名空间：注册后工具名强制前缀 mcp_<server>_，防与本地 15 工具或彼此冲突。
 */

const clients = new Map() // serverName -> client

const WRITE_HINTS = [
  'write', 'create', 'delete', 'remove', 'update', 'insert', 'send', 'submit',
  'edit', 'modify', 'move', 'rename', 'append', 'patch', 'upload', '保存', '写入',
  '删除', '创建', '修改', '发送', '提交', '上传', '移动', '重命名',
]
const READ_HINTS = [
  'read', 'get', 'list', 'search', 'fetch', 'query', 'view', 'find', 'check',
  '读取', '获取', '列出', '查询', '搜索', '查看', '检查',
]

/** dangerLevel 启发式：写暗示词优先（get_or_create 这类复合名按 write），都不中默认 write */
function guessDangerLevel(tool) {
  const text = `${tool.name} ${tool.description || ''}`.toLowerCase()
  if (WRITE_HINTS.some((h) => text.includes(h))) return 'write'
  if (READ_HINTS.some((h) => text.includes(h))) return 'read'
  return 'write'
}

function mcpToolName(serverName, toolName) {
  const sanitize = (s) => String(s).toLowerCase().replace(/[^a-z0-9_]/g, '_')
  return `mcp_${sanitize(serverName)}_${sanitize(toolName)}`
}

/**
 * 接入一个 MCP server：连接 → tools/list → 逐工具过三道闸 → 纳管
 * @returns {{registered: string[], rejected: Array<{tool, reason}>}}
 */
async function registerMcpServer({ name, command, args, env, shell, timeoutMs } = {}) {
  if (!name || !command) throw new Error('MCP server 配置缺少 name/command')
  const client = createMcpClient({ name, command, args, env, shell, timeoutMs })
  const remoteTools = await client.listTools()
  clients.set(name, client)

  const registered = []
  const rejected = []
  for (const tool of remoteTools) {
    const prefixed = mcpToolName(name, tool.name)
    // 闸 1：注册期注入扫描（描述 + schema 都是模型可见文本）
    const scanTarget = `${tool.description || ''} ${JSON.stringify(tool.inputSchema || {})}`
    const scan = scanInjection(scanTarget)
    if (scan.suspicious) {
      rejected.push({ tool: prefixed, reason: `疑似注入（${scan.matches.map((m) => m.id).join(',')}）` })
      traceLog.record({ type: 'mcp_tool_rejected', server: name, tool: prefixed, matches: scan.matches })
      continue
    }
    // 闸 2：自动定级（默认最危险）
    const dangerLevel = guessDangerLevel(tool)
    // 闸 3：纳管——定义进共享数组（LLM/审批/判卷同源），处理器进 handler
    const ok = require('./index.js').registerDynamicTool({
      name: prefixed,
      dangerLevel,
      description: `${tool.description || tool.name}（来源：MCP server「${name}」）`,
      inputSchema: tool.inputSchema || { type: 'object', properties: {} },
    })
    if (!ok) {
      rejected.push({ tool: prefixed, reason: '重名（已被注册）' })
      continue
    }
    require('./handler.js').registerToolHandler(prefixed, (toolArgs) =>
      client.callTool(tool.name, toolArgs)
    )
    registered.push(prefixed)
    traceLog.record({ type: 'mcp_tool_registered', server: name, tool: prefixed, dangerLevel })
  }
  return { registered, rejected }
}

/** 已接入的 server 与其纳管工具（dashboard/测试观测用） */
function listServers() {
  return [...clients.entries()].map(([name, client]) => ({
    name,
    alive: client.alive,
    tools: tools.filter((t) => t.name.startsWith(`mcp_${name}_`)).map((t) => ({
      name: t.name,
      dangerLevel: t.dangerLevel,
    })),
  }))
}

function shutdownAll() {
  for (const [, client] of clients) client.close()
  clients.clear()
}

module.exports = { registerMcpServer, listServers, shutdownAll, guessDangerLevel, mcpToolName }
