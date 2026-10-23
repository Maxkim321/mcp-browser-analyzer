const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// MEMORY_FILE 必须在 require 前设置（测试隔离，不碰真实记忆库）；
// MEMORY_RETRIEVAL=bm25 强制纯关键词通道——否则会吃到真实 .env 的 EMBED_* 配置
// （向量化真调方舟 API + P8.1 语义背书门控让 BM25 命中被过滤，测试不可复现）
process.env.MEMORY_FILE = path.join(
  os.tmpdir(),
  `pb-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`
)
process.env.MEMORY_RETRIEVAL = 'bm25'
const { distillPlaybook, recallForPrompt } = require('../src/memory/wire.js')

/**
 * P17 程序记忆单测：成功任务的工具轨迹 → 蒸馏成"操作手册"卡。
 * 锁不变量：门控（步数/LLM/站点域）/确定性标题键（同站点=更新同一本手册）/
 * 召回分块（手册与事实卡分开注入，手册带失效条款）。
 */

const stubLlm = (content) => ({ chat: async () => ({ content }) })
const MANUAL = [
  '站点：trains.ctrip.com',
  '触发：用户要求在携程查询/预订火车票',
  '步骤：',
  '1) navigate_to 直达搜索结果页（城市参数可靠）',
  '2) 日期条点击目标日期（URL 日期参数不可靠）',
  '3) get_page_content 读车次列表',
  '坑：',
  '- 合成点击会被拦截，用可信点击通道',
  '失效：与页面实际不符时以页面真值为准',
].join('\n')

const steps = [
  { phase: 'tool', tool: 'navigate_to', iteration: 1 },
  { phase: 'tool', tool: 'click_element', iteration: 2 },
  { phase: 'tool', tool: 'get_page_content', iteration: 3 },
]

test('蒸馏落卡：确定性标题键（操作手册：域名），url=站点根', async () => {
  const card = await distillPlaybook(
    { prompt: '去携程查一下下周五回自贡的票', answer: '已查到车次……'.repeat(20), steps, pageContext: { url: 'https://www.zhipin.com/x' } },
    stubLlm(MANUAL)
  )
  assert.ok(card, '应落卡')
  assert.equal(card.title, '操作手册：trains.ctrip.com')
  assert.equal(card.url, 'https://trains.ctrip.com/')
  assert.ok(card.summary.includes('失效：'), '手册带失效条款')
})

test('门控：工具步骤不足 3 步 / 无 LLM / 无站点域，均不蒸馏', async () => {
  const short = steps.slice(0, 2)
  assert.equal(await distillPlaybook({ prompt: 'x', answer: 'y', steps: short, pageContext: { url: 'https://a.com' } }, stubLlm(MANUAL)), null)
  assert.equal(await distillPlaybook({ prompt: 'x', answer: 'y', steps, pageContext: { url: 'https://a.com' } }, null), null)
  // LLM 输出里没有可解析站点域且 pageContext 为空 → 无稳定键，拒绝
  const noSite = await distillPlaybook(
    { prompt: 'x', answer: 'y', steps, pageContext: null },
    stubLlm('一本没有站点域的手册'.repeat(10))
  )
  assert.equal(noSite, null)
})

test('召回分块：手册卡单独成块带失效条款，refs 标记 type=playbook', async () => {
  const res = await recallForPrompt('携程 火车票 查询', null)
  assert.ok(res, '应命中手册卡')
  assert.ok(res.block.includes('【操作手册】'), '手册独立分块')
  assert.ok(res.block.includes('以页面真值为准'), '带失效条款')
  const pbRef = res.refs.find((r) => r.type === 'playbook')
  assert.ok(pbRef, 'refs 标记 type=playbook')
})

test('版本更新：同站点再次蒸馏 → 检索只取最新版本', async () => {
  const manualV2 = MANUAL.replace('合成点击会被拦截，用可信点击通道', 'V2：日期条已支持直达参数，无需点击')
  const card = await distillPlaybook(
    { prompt: '再查一次票', answer: '已查到……'.repeat(20), steps, pageContext: null },
    stubLlm(manualV2)
  )
  assert.ok(card)
  const versions = fs.readFileSync(process.env.MEMORY_FILE, 'utf8').trim().split('\n').length
  assert.ok(versions >= 2, '追加式存储保留旧版本')
  const res = await recallForPrompt('携程 火车票 查询', null)
  assert.ok(res.block.includes('V2：'), '检索取最新版本')
  assert.ok(!res.block.includes('合成点击会被拦截'), '旧版本不再出现')
})
