const test = require('node:test')
const assert = require('node:assert')

// 纯函数模块（无副作用，不会启动 WS 服务器）
const { appendPrefs, appendPageContext } = require('../src/core/prompt-context.js')

test('appendPrefs: 默认值不注入（节省 token）', () => {
  const base = '你是助手'
  const out = appendPrefs(base, { summaryStyle: 'concise', translateLang: 'zh', replyStyle: 'professional' })
  assert.strictEqual(out, base)
})

test('appendPrefs: 非默认值注入偏好段落', () => {
  const base = '你是助手'
  const out = appendPrefs(base, { summaryStyle: 'detailed', translateLang: 'en', replyStyle: 'casual' })
  assert.ok(out.includes('## 用户偏好'))
  assert.ok(out.includes('总结格式偏好：详细'))
  assert.ok(out.includes('默认翻译目标语言：en'))
  assert.ok(out.includes('回复风格偏好：口语化'))
})

test('appendPrefs: 空对象/空值返回原样', () => {
  const base = '你是助手'
  assert.strictEqual(appendPrefs(base, null), base)
  assert.strictEqual(appendPrefs(base, {}), base)
  assert.strictEqual(appendPrefs(base, undefined), base)
})

test('appendPageContext: 注入页面标题与选中文本', () => {
  const base = '你是助手'
  const out = appendPageContext(base, { title: 'MCP 入门', url: 'https://example.com', selection: '什么是 MCP' })
  assert.ok(out.includes('## 当前页面上下文'))
  assert.ok(out.includes('页面标题：MCP 入门'))
  assert.ok(out.includes('页面地址：https://example.com'))
  assert.ok(out.includes('用户选中文本：什么是 MCP'))
})

test('appendPageContext: 空上下文返回原样', () => {
  const base = '你是助手'
  assert.strictEqual(appendPageContext(base, { title: '', url: '', selection: '' }), base)
  assert.strictEqual(appendPageContext(base, undefined), base)
})
