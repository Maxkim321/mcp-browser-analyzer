/**
 * 记忆 A/B 评测单臂执行器（由 run-memory-ab.js 以子进程方式驱动）
 *
 * 为什么用子进程：memory/store.js 在 require 时固化 MEMORY_FILE 路径，
 * 同进程内切换记忆库需要清 require.cache 且连累 retrieve/wire 的引用；
 * 两臂各起一个进程、env 注入不同 MEMORY_FILE，隔离干净、口径一致。
 *
 * 用法：MEMORY_ARM=on|off MEMORY_FILE=<jsonl路径> node eval/memory-arm.js --out=<json路径>
 */
const fs = require('fs')
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })
const { Agent } = require('../src/core/agent.js')
const handler = require('../src/tools/handler.js')
const memoryWire = require('../src/memory/wire.js')
const { SYSTEM_PROMPT } = require('../src/config/prompts.js')
const { appendPageContext } = require('../src/core/prompt-context.js')
const { judgeAnswer } = require('./judge.js')

const EVAL_DIR = __dirname
const { page, cases } = JSON.parse(
  fs.readFileSync(path.join(EVAL_DIR, 'fixtures', 'memory-ab-cases.json'), 'utf8')
)

function loadFixture(relPath) {
  const html = fs.readFileSync(path.join(EVAL_DIR, 'fixtures', relPath), 'utf8')
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || relPath
  return { title: title.trim() }
}

/** 评测期禁外呼：当前页语义指向 fixture，其余工具显式拒绝（确定性优先） */
function installToolOverrides() {
  handler.init({ manager: { getIds: () => [], getCount: () => 0 }, send: () => true })
  handler.setToolOverrides({
    get_page_content: async () => {
      const { title } = loadFixture(page)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              url: `file://eval/${page}`,
              title,
              content: '(fixture 页面正文：与记忆问题无关)',
              charCount: 30,
            }),
          },
        ],
      }
    },
    fetch_url: async () => rejected('fetch_url'),
    web_search: async () => rejected('web_search'),
    get_browser_performance: async () => rejected('get_browser_performance'),
    run_lighthouse_audit: async () => rejected('run_lighthouse_audit'),
    navigate_to: async () => rejected('navigate_to'),
    reload_page: async () => rejected('reload_page'),
    wait_for_load: async () => rejected('wait_for_load'),
    todo_write: async () => rejected('todo_write'),
    broadcast_message: async () => rejected('broadcast_message'),
    list_connections: async () => rejected('list_connections'),
  })
}

function rejected(name) {
  return async () => ({
    content: [{ type: 'text', text: `Error: ${name} 在记忆评测环境中已禁用` }],
  })
}

async function main() {
  const arm = process.env.MEMORY_ARM || 'off'
  const outArg = process.argv.find((a) => a.startsWith('--out='))
  const outPath = outArg
    ? outArg.split('=')[1]
    : path.join(EVAL_DIR, 'results', `memory-ab-${arm}.json`)

  const pageUrl = `file://eval/${page}`
  const { title: pageTitle } = loadFixture(page)
  const pageContext = { url: pageUrl, title: pageTitle, selection: '' }

  installToolOverrides()
  console.log(
    `=== 记忆评测 ${arm.toUpperCase()} 臂（MEMORY_FILE=${process.env.MEMORY_FILE || '(默认)'}）===`
  )

  const results = []
  for (const c of cases) {
    // 组装方式对齐 ws-server：pageContext 注入 + 命中记忆块注入（off 臂跳过）
    let systemPrompt = appendPageContext(SYSTEM_PROMPT, pageContext)
    if (arm === 'on') {
      const recalled = memoryWire.recallForPrompt(c.prompt, pageContext)
      if (recalled) systemPrompt += `\n\n${recalled.block}`
    }

    // 检索层确定性验证（免 LLM）：期望卡片是否真的被召回进 top-3
    let recall = { hit: false, score: null, matchedTerms: [] }
    if (arm === 'on') {
      const recalled = memoryWire.recallForPrompt(c.prompt, pageContext)
      const hit = recalled?.refs?.find((r) => r.url === c.expectedUrl)
      if (hit) recall = { hit: true, score: hit.score, matchedTerms: hit.matchedTerms || [] }
    }

    const agent = new Agent()
    const t0 = Date.now()
    process.stdout.write(`▶ [${arm}] ${c.id} ... `)
    try {
      const result = await agent.process(c.prompt, {
        connectionId: 1,
        systemPrompt,
        onStep: () => {},
      })
      const durationMs = Date.now() - t0
      const verdict = await judgeAnswer(c.rubric, result, { useLLMJudge: false })
      const passed = verdict.passed && result?.success === true
      console.log(passed ? `✅ PASS (${durationMs}ms)` : `❌ FAIL (${durationMs}ms)`)
      results.push({
        id: c.id,
        passed,
        recall,
        durationMs,
        checks: verdict.checks,
        contentPreview: String(result?.content || '').slice(0, 200),
      })
    } catch (e) {
      console.log(`💥 ERROR — ${e.message}`)
      results.push({
        id: c.id,
        passed: false,
        recall,
        durationMs: Date.now() - t0,
        checks: [],
        error: e.message,
      })
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(
    outPath,
    JSON.stringify({ arm, ranAt: new Date().toISOString(), results }, null, 2)
  )
  console.log(`→ ${outPath}`)
}

main().catch((e) => {
  console.error('memory arm failed:', e)
  process.exit(1)
})
