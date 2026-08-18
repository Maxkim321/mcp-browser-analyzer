const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  estimateTokens,
  estimateMessagesTokens,
  findCompressCount,
  serializeMessages,
  compressHistory,
} = require('../src/core/context-manager.js')

test('estimateTokens: 中文按 1 字 ≈ 1 token，英文按 4 字符 ≈ 1 token', () => {
  // 纯 ASCII：'abc' → 0.25*3 = 0.75 → ceil = 1
  assert.equal(estimateTokens('abc'), 1)
  // 纯中文：'你好世界' → 4 token
  assert.equal(estimateTokens('你好世界'), 4)
  // 空输入
  assert.equal(estimateTokens(''), 0)
  assert.equal(estimateTokens(null), 0)
})

test('estimateMessagesTokens: 汇总所有消息', () => {
  const messages = [
    { role: 'user', content: '你好' }, // 2
    { role: 'assistant', content: 'hello world' }, // 11 chars * 0.25 = 2.75 → 3
  ]
  assert.equal(estimateMessagesTokens(messages), 5)
})

test('findCompressCount: 未超预算返回 null，超预算返回压缩条数', () => {
  // 3 条共 ~6 token，预算 100 → 无需压缩
  const small = [
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '你好' },
    { role: 'user', content: '你好' },
  ]
  assert.equal(findCompressCount(small, 100), null)

  // 3 条共 12 token，预算 5 → 需要压缩：保底一半 = max(2, 1) = 2
  const big = [
    { role: 'user', content: '第一句话很长' }, // 6
    { role: 'assistant', content: '第二句话很长' }, // 6
    { role: 'user', content: '第三句话很长' }, // 6
  ]
  assert.equal(findCompressCount(big, 5), 2)
})

test('findCompressCount: 空消息返回 null', () => {
  assert.equal(findCompressCount([], 100), null)
  assert.equal(findCompressCount(null, 100), null)
})

test('serializeMessages: 角色标注成文本', () => {
  const out = serializeMessages([
    { role: 'user', content: '问题A' },
    { role: 'assistant', content: '回答B' },
  ])
  assert.ok(out.includes('用户: 问题A'))
  assert.ok(out.includes('助手: 回答B'))
})

test('compressHistory: 压缩前缀为摘要，保留最近消息全文', async () => {
  const messages = [
    { role: 'user', content: '需求一' },
    { role: 'assistant', content: '答复一' },
    { role: 'user', content: '当前问题' },
  ]
  const seen = []
  const result = await compressHistory(messages, 5, async (text) => {
    seen.push(text)
    return '压缩后的摘要'
  })

  assert.equal(result.compressed, 2)
  assert.equal(result.summary, '压缩后的摘要')
  assert.equal(seen.length, 1)
  // 摘要消息在最前（system 角色），最近消息保留全文
  assert.equal(result.messages[0].role, 'system')
  assert.ok(result.messages[0].content.includes('压缩后的摘要'))
  assert.equal(result.messages[1], messages[2])
})

test('compressHistory: 未超预算不调用 summarize', async () => {
  const messages = [{ role: 'user', content: '你好' }]
  let called = false
  const result = await compressHistory(messages, 100, async () => {
    called = true
    return 'x'
  })
  assert.equal(result.compressed, 0)
  assert.equal(result.summary, null)
  assert.equal(called, false)
})
