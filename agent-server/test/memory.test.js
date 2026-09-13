const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const fs = require('fs')
const os = require('os')

// 隔离：测试用临时记忆库文件（必须在 require store 之前设置）
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-'))
process.env.MEMORY_FILE = path.join(TMP_DIR, 'memory.jsonl')

const store = require('../src/memory/store.js')
const { topK, tokenize } = require('../src/memory/retrieve.js')
const wire = require('../src/memory/wire.js')

test.after(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true })
})

test('tokenize: ASCII 单词 + CJK 双字组', () => {
  const tokens = tokenize('用 DeepSeek 做 深度研究')
  assert.ok(tokens.includes('deepseek'))
  assert.ok(tokens.includes('深度'))
  assert.ok(tokens.includes('研究'))
})

test('store: append 过滤短内容，readAll 可读回', async () => {
  assert.strictEqual(store.append({ url: '', title: 'x', summary: 'y' }), null, '无 url 不入库')
  assert.strictEqual(store.append({ url: 'u1', title: 't', summary: '太短' }), null, '摘要 <40 字不入库')
  const card = store.append({
    url: 'https://a.example.com/1',
    title: 'Agent 架构解析',
    summary: '一切皆插件。Cordis 插件化框架，事件驱动设计，能力 seam 三件套，subagent 支持 Claude Code。',
  })
  assert.ok(card.id)
  assert.strictEqual(store.readAll().length, 1)
})

test('topK: 相关卡片命中且排序正确，当前页自身被排除', async () => {
  store.append({
    url: 'https://a.com/dsh',
    title: 'DeepSeek Harness 架构解析',
    summary: '一切皆插件，Cordis 事件驱动设计，能力 seam 可替换 Provider，subagent 家族支持多智能体编排。',
  })
  store.append({
    url: 'https://a.com/recipes',
    title: '红烧肉的做法',
    summary: '五花肉焯水后炒糖色，加入料酒生抽，小火炖四十分钟，最后大火收汁。',
  })
  const hits = topK('agent 架构 插件化 怎么设计', { k: 5 })
  assert.ok(hits.length >= 1)
  const dshHit = hits.find((h) => h.card.url === 'https://a.com/dsh')
  assert.ok(dshHit, '架构问题应命中架构卡片')
  const recipeHit = hits.find((h) => h.card.url === 'https://a.com/recipes')
  assert.ok(
    !recipeHit || dshHit.score > recipeHit.score,
    '若菜谱卡片也被召回，其得分必须低于架构卡片'
  )
  const hits2 = topK('agent 架构', { k: 5, excludeUrl: 'https://a.com/dsh' })
  assert.ok(!hits2.some((h) => h.card.url === 'https://a.com/dsh'))
})

test('wire: recallForPrompt 返回格式化块与引用；rememberFromResult 过滤短回答', async () => {
  store.append({
    url: 'https://a.com/dsh',
    title: 'DeepSeek Harness 架构解析',
    summary: '一切皆插件，Cordis 事件驱动设计，能力 seam 可替换 Provider，subagent 家族支持多智能体编排。',
  })
  const recalled = wire.recallForPrompt('dsh 的插件化设计有什么优点？', { url: 'https://current.page' })
  assert.ok(recalled.block.includes('浏览记忆'))
  assert.ok(recalled.refs.length >= 1)
  assert.ok(
    recalled.refs.some((r) => r.title.includes('DeepSeek Harness') || r.title.includes('Agent 架构')),
    'refs 应包含架构相关卡片'
  )

  assert.strictEqual(wire.rememberFromResult({ url: 'https://x' }, '太短'), null)
  assert.strictEqual(wire.rememberFromResult(null, '内容'), null)
})
