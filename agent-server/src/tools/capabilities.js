const { tools } = require('./index.js')
const { listServers } = require('./mcp-registry.js')

/**
 * 能力清单聚合（P10 能力可见性）——给侧边栏"工具箱"面板一个只读数据源
 *
 * 用户在聊天界面看不到引擎盖下有什么：内置工具、MCP 纳管了什么、
 * 哪些是写操作要过审批。这个模块把分散在两处的注册表聚成一个快照：
 * - 内置工具：tools 共享数组（MCP 注册也 push 进同一数组，按 mcp_ 前缀区分）
 * - MCP server：listServers() 给分组与存活态；description 从共享数组按名回查补齐
 *   （listServers 只吐 name/dangerLevel，喂不动 UI）
 *
 * 纯读函数：不改任何注册表状态。WS list_capabilities 按需拉取、注册完成广播，
 * 两个通道共用此快照——面板数据永远来自真实注册表，不硬编码。
 */
function listCapabilities() {
  const descByName = new Map(tools.map((t) => [t.name, t.description || '']))
  return {
    builtin: tools
      .filter((t) => !t.name.startsWith('mcp_'))
      .map((t) => ({
        name: t.name,
        description: t.description || '',
        dangerLevel: t.dangerLevel || 'read',
      })),
    mcpServers: listServers().map((s) => ({
      name: s.name,
      alive: s.alive,
      tools: s.tools.map((t) => ({
        name: t.name,
        dangerLevel: t.dangerLevel,
        description: descByName.get(t.name) || '',
      })),
    })),
  }
}

module.exports = { listCapabilities }
