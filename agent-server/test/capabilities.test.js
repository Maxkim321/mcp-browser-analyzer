const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const { tools } = require('../src/tools/index.js')
const { registerMcpServer, shutdownAll } = require('../src/tools/mcp-registry.js')
const { listCapabilities } = require('../src/tools/capabilities.js')

const FAKE = path.join(__dirname, 'fixtures', 'fake-mcp-server.cjs')

test('capabilities：内置工具快照——不含 mcp_ 前缀、描述齐全、未声明定级默认 read', () => {
  const snap = listCapabilities()
  assert.ok(snap.builtin.length >= 15, '内置工具应全量在列')
  assert.ok(snap.builtin.every((t) => !t.name.startsWith('mcp_')), 'MCP 工具不混入内置区')
  assert.ok(snap.builtin.every((t) => t.description), '每个工具都有 description 喂 UI')
  const click = snap.builtin.find((t) => t.name === 'click_element')
  assert.strictEqual(click.dangerLevel, 'write', '内置写工具定级原样透出')
  const list = snap.builtin.find((t) => t.name === 'list_connections')
  assert.strictEqual(list.dangerLevel, 'read', '未声明定级的内置工具默认 read')
  assert.strictEqual(snap.mcpServers.length, 0, '未配置 MCP 时 server 区为空')
})

test('capabilities：MCP 纳管后快照——server 分组/存活态/description 补齐/定级映射一致', async () => {
  try {
    const { registered } = await registerMcpServer({
      name: 'cap',
      command: process.execPath,
      args: [FAKE, '--stateless'],
    })
    assert.strictEqual(registered.length, 3)

    const snap = listCapabilities()
    const server = snap.mcpServers.find((s) => s.name === 'cap')
    assert.ok(server, 'cap server 应出现在快照')
    assert.strictEqual(server.alive, true)
    assert.strictEqual(server.tools.length, 3)

    const byName = new Map(server.tools.map((t) => [t.name, t]))
    const getNote = byName.get('mcp_cap_get_note')
    const saveNote = byName.get('mcp_cap_save_note')
    const mystery = byName.get('mcp_cap_mystery')
    assert.strictEqual(getNote.dangerLevel, 'read')
    assert.strictEqual(saveNote.dangerLevel, 'write')
    assert.strictEqual(mystery.dangerLevel, 'write', '分不了级默认最危险，与注册口径一致')
    assert.match(getNote.description, /来源：MCP server「cap」/, 'description 从共享数组回查补齐')
    assert.ok(snap.builtin.every((t) => !t.name.startsWith('mcp_')), '纳管后内置区仍干净')
  } finally {
    shutdownAll()
    for (const n of ['mcp_cap_get_note', 'mcp_cap_save_note', 'mcp_cap_mystery']) {
      const i = tools.findIndex((t) => t.name === n)
      if (i >= 0) tools.splice(i, 1)
    }
  }
})

test('capabilities：shutdown 后 server 从快照消失（注册表是唯一事实源，不显示幽灵条目）', async () => {
  try {
    await registerMcpServer({ name: 'down', command: process.execPath, args: [FAKE, '--stateless'] })
  } finally {
    shutdownAll()
  }
  const snap = listCapabilities()
  assert.strictEqual(
    snap.mcpServers.find((s) => s.name === 'down'),
    undefined,
    'clients 已清空，快照如实反映'
  )
  for (const n of ['mcp_down_get_note', 'mcp_down_save_note', 'mcp_down_mystery']) {
    const i = tools.findIndex((t) => t.name === n)
    if (i >= 0) tools.splice(i, 1)
  }
})
