const test = require('node:test')
const assert = require('node:assert/strict')
const { findCompressCount, compressHistory } = require('../src/core/context-manager.js')
const { Agent } = require('../src/core/agent.js')
const handler = require('../src/tools/handler.js')

/**
 * 回归测试：压缩/裁剪边界不能切在 tool_calls 消息组中间
 * 背景：真实故障——上下文压缩后剩余历史以孤儿 role='tool' 消息开头，
 * DeepSeek 400："Messages with role 'tool' must be a response to a preceding
 * message with 'tool_calls'"，整条请求报废。
 */

// 构造一段含工具调用组的合法历史：
// [user, assistant(tool_calls), tool, tool, assistant, user]
function makeHistory() {
  return [
    { role: 'user', content: '帮我查一下 X' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{"query":"X"}' } },
      ],
    },
    { role: 'tool', tool_call_id: 'call_1', content: '搜索结果 A' },
    { role: 'tool', tool_call_id: 'call_1', content: '搜索结果 B' },
    { role: 'assistant', content: '根据搜索结果，X 的答案是……' },
    { role: 'user', content: '那 Y 呢？' },
  ]
}

test('压缩边界对齐: 原始边界落在 tool 消息上时向后吞掉整组', () => {
  const messages = makeHistory()
  // 传一个必然超预算的小 budget，keepRatio=0.6 时原始边界恰好在 index 2（第一条 tool）
  // 用大 content 保证超预算；直接断言返回边界指向的消息不是 tool
  const count = findCompressCount(messages, 5)
  assert.ok(count !== null)
  assert.notStrictEqual(messages[count] && messages[count].role, 'tool', '边界不能落在 tool 消息上')
})

test('压缩边界对齐: 剩余历史永远不以孤儿 tool 开头（compressHistory 端到端）', async () => {
  const messages = makeHistory()
  const { messages: compressed } = await compressHistory(messages, 5, async (text) => `摘要[${text.length}]`)
  assert.strictEqual(compressed[0].role, 'system')
  assert.ok(compressed[0].content.includes('早期对话摘要'))
  assert.notStrictEqual(compressed[1] && compressed[1].role, 'tool', '压缩后第一条真实消息不能是 tool')
  // 剩余部分仍是合法序列：每个 tool 前面必是带 tool_calls 的 assistant
  for (let i = 1; i < compressed.length; i++) {
    if (compressed[i].role === 'tool') {
      const prev = compressed[i - 1]
      assert.ok(
        prev.role === 'assistant' && Array.isArray(prev.tool_calls),
        `index ${i} 的 tool 消息前驱必须是 tool_calls assistant`
      )
    }
  }
})

test('trimHistory: 裁剪起点对齐，不会把 tool 消息组裁成孤儿', () => {
  const agent = new Agent()
  agent.conversationHistory = [
    ...makeHistory(),
    { role: 'assistant', content: '回答 Y' },
    { role: 'user', content: '再来一个 Z' },
    { role: 'assistant', content: '回答 Z' },
  ]
  // 配置 3 条上限：原始 slice 会从 index 4 开始（恰好合法）；
  // 用 tool 组跨越边界的位置验证：手工构造让 slice 起点落在 tool 上
  agent.config.historyLimit = 4
  agent.conversationHistory = [
    { role: 'user', content: '前情' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'c', type: 'function', function: { name: 't', arguments: '{}' } }],
    },
    { role: 'tool', tool_call_id: 'c', content: '结果1' },
    { role: 'tool', tool_call_id: 'c', content: '结果2' },
    { role: 'assistant', content: '结论' },
    { role: 'user', content: '最新问题' },
  ]
  agent.trimHistory()
  // slice(-4) 原始起点是 index 2（tool）→ 对齐后吞掉整组 tool，从 assistant(结论) 开始
  assert.strictEqual(agent.conversationHistory[0].role, 'assistant')
  assert.strictEqual(agent.conversationHistory.length, 2)
  for (let i = 1; i < agent.conversationHistory.length; i++) {
    if (agent.conversationHistory[i].role === 'tool') {
      const prev = agent.conversationHistory[i - 1]
      assert.ok(prev.role === 'assistant' && Array.isArray(prev.tool_calls))
    }
  }
})

test('handleToolCall: 同步 handler（todo_write）在可取消路径不再 TypeError', async () => {
  // 真实故障：handleTodoWrite 是同步函数，signal 路径直接 .then 报
  // "handler(...).then is not function"，导致 todo_write 每次都失败
  handler.init({
    manager: { getIds: () => [], getCount: () => 0 },
    send: () => true,
    broadcast: () => {},
  })
  const controller = new AbortController()
  const result = await handler.handleToolCall(
    'todo_write',
    { todos: [{ id: '1', content: '步骤', status: 'pending', priority: 'high' }] },
    { signal: controller.signal }
  )
  assert.ok(result && Array.isArray(result.content))
  controller.abort()
})
