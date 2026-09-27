const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const { createMcpClient } = require('../src/mcp/client.js')
const { tools, isWriteTool, registerDynamicTool } = require('../src/tools/index.js')
const { registerMcpServer, shutdownAll, guessDangerLevel } = require('../src/tools/mcp-registry.js')
const traceLog = require('../src/core/trace-log.js')

const FAKE = path.join(__dirname, 'fixtures', 'fake-mcp-server.cjs')
const CLIENT_OPTS = { command: process.execPath, args: [FAKE], timeoutMs: 8000 }

test('mcp client：stateless server 免握手直接 tools/list（2026-07-28 形态）', async () => {
  const client = createMcpClient({ ...CLIENT_OPTS, args: [FAKE, '--stateless'] })
  try {
    const remote = await client.listTools()
    assert.strictEqual(remote.length, 4)
    assert.ok(remote.some((t) => t.name === 'get_note'))
  } finally {
    client.close()
  }
})

test('mcp client：存量 server 未初始化被拒 → 自动握手重试（探测→握手→重试）', async () => {
  const client = createMcpClient(CLIENT_OPTS) // 不带 --stateless：tools/list 先报 -32002
  try {
    const remote = await client.listTools()
    assert.strictEqual(remote.length, 4, '握手回退后应成功列出工具')
  } finally {
    client.close()
  }
})

test('mcp client：tools/call 往返，结果 content 与本仓工具同形', async () => {
  const client = createMcpClient({ ...CLIENT_OPTS, args: [FAKE, '--stateless'] })
  try {
    const r = await client.callTool('get_note', { path: 'a.md' })
    assert.strictEqual(r.content[0].text, 'note@a.md:hello')
    await assert.rejects(() => client.callTool('not_exists', {}), /unknown tool/)
  } finally {
    client.close()
  }
})

test('mcp 注册：纳管进共享数组 + dangerLevel 自动定级 + isWriteTool 同一出口生效', async () => {
  try {
    const { registered, rejected } = await registerMcpServer({
      name: 'test',
      command: process.execPath,
      args: [FAKE, '--stateless'],
    })
    assert.ok(registered.includes('mcp_test_get_note'), 'read 工具应纳管')
    assert.ok(registered.includes('mcp_test_save_note'), 'write 工具应纳管')
    assert.ok(registered.includes('mcp_test_mystery'), '无暗示词工具应纳管')
    assert.strictEqual(registered.length, 3, '投毒工具应被拒')
    assert.strictEqual(rejected.length, 1)
    assert.match(rejected[0].reason, /疑似注入/)

    const getNote = tools.find((t) => t.name === 'mcp_test_get_note')
    const saveNote = tools.find((t) => t.name === 'mcp_test_save_note')
    const mystery = tools.find((t) => t.name === 'mcp_test_mystery')
    assert.strictEqual(getNote.dangerLevel, 'read')
    assert.strictEqual(saveNote.dangerLevel, 'write')
    assert.strictEqual(mystery.dangerLevel, 'write', '分不了级默认最危险（宁严勿松）')
    assert.strictEqual(isWriteTool('mcp_test_save_note'), true, '写审批管线自动覆盖 MCP 工具')
    assert.strictEqual(isWriteTool('mcp_test_get_note'), false)

    // 处理器已挂：直接调 handler 入口验证往返（经 registerToolHandler 注册的动态处理器）
    const handler = require('../src/tools/handler.js')
    handler.init({ manager: { getIds: () => [], getCount: () => 0 }, send: () => true })
    const r = await handler.handleToolCall('mcp_test_get_note', { path: 'b.md' }, {})
    assert.strictEqual(r.content[0].text, 'note@b.md:hello')
  } finally {
    shutdownAll()
    // 清理共享数组，避免影响其他测试文件（node --test 每文件独立进程，防御性收尾）
    for (const n of ['mcp_test_get_note', 'mcp_test_save_note', 'mcp_test_mystery']) {
      const i = tools.findIndex((t) => t.name === n)
      if (i >= 0) tools.splice(i, 1)
    }
  }
})

test('mcp 注册：投毒工具被拒的 trace 留痕可查（审计视角）', async () => {
  const before = traceLog.readAll().filter((e) => e.type === 'mcp_tool_rejected').length
  try {
    await registerMcpServer({ name: 'testpoison', command: process.execPath, args: [FAKE, '--stateless'] })
  } finally {
    shutdownAll()
  }
  const events = traceLog.readAll().filter((e) => e.type === 'mcp_tool_rejected')
  assert.ok(events.length > before, '拒绝事件应落 trace')
  assert.match(JSON.stringify(events.at(-1)), /ignore-instructions-en/)
})

test('guessDangerLevel：写暗示词优先于读暗示词（get_or_create → write）', () => {
  assert.strictEqual(guessDangerLevel({ name: 'x', description: 'get or create a record' }), 'write')
  assert.strictEqual(guessDangerLevel({ name: 'x', description: '列出所有目录' }), 'read')
  assert.strictEqual(guessDangerLevel({ name: 'x', description: '删除指定文件' }), 'write')
  assert.strictEqual(guessDangerLevel({ name: 'x', description: '不明所以' }), 'write', '默认最危险')
})

test('registerDynamicTool：重名拒绝', () => {
  const before = tools.length
  assert.strictEqual(registerDynamicTool({ name: 'list_connections', dangerLevel: 'read' }), false, '与本地工具重名')
  assert.strictEqual(tools.length, before)
})
