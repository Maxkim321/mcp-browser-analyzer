/**
 * 黄金评测集执行器
 * 用法：
 *   pnpm -F agent-server eval                    # 全量（含 LLM judge）
 *   node eval/run-eval.js --filter chat          # 只跑 id/type 含 chat 的 case
 *   node eval/run-eval.js --no-llm-judge         # 快档：只跑确定性判分
 *   node eval/run-eval.js --min-rate 0.7         # 低于通过率退出码 1（CI 用）
 *
 * 设计：工具层用 fixture 覆盖（handler.setToolOverrides），评测离线可复现；
 * 编排链路（模板/ReAct/工具调用）保持真实路径。
 */
const fs = require('fs')
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })
const { Agent } = require('../src/core/agent.js')
const handler = require('../src/tools/handler.js')
const { judgeAnswer } = require('./judge.js')
const { SYSTEM_PROMPT, ACTION_PROMPTS } = require('../src/config/prompts.js')
const { appendPageContext } = require('../src/core/prompt-context.js')

const EVAL_DIR = __dirname
const RESULTS_DIR = path.join(EVAL_DIR, 'results')

function parseArgs() {
  const args = { filter: '', llmJudge: true, minRate: 0 }
  process.argv.slice(2).forEach((a) => {
    if (a.startsWith('--filter=')) args.filter = a.split('=')[1]
    else if (a === '--filter') args.filter = process.argv[process.argv.indexOf(a) + 1] || ''
    else if (a === '--no-llm-judge') args.llmJudge = false
    else if (a.startsWith('--min-rate=')) args.minRate = Number(a.split('=')[1])
  })
  return args
}

/** 极简 HTML 转文本：去 script/style/标签、解实体、收空白（fixture 专用，确定性优先） */
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(p|div|h[1-6]|li|tr|table|article|section)>/gi, '\n')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function loadFixture(relPath) {
  const html = fs.readFileSync(path.join(EVAL_DIR, 'fixtures', relPath), 'utf8')
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || relPath
  return { html, title: title.trim(), text: htmlToText(html) }
}

/** 评测工具覆盖：页面内容来自本地 fixture，其余工具显式拒绝（避免评测期外呼） */
const baseOverrides = {
  fetch_url: async (args) => {
    const rel = String(args.url || '').replace('file://eval/', '')
    const { title, text } = loadFixture(rel)
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ url: args.url, title, content: text, charCount: text.length }),
        },
      ],
    }
  },
  web_search: async () => ({
    content: [
      { type: 'text', text: JSON.stringify({ results: [], note: 'eval 环境 web_search 已禁用' }) },
    ],
  }),
}

function installToolOverrides() {
  handler.init({ manager: { getIds: () => [], getCount: () => 0 }, send: () => true })
}

function fixturePageOverride(fixtureRel) {
  return async () => {
    const { title, text } = loadFixture(fixtureRel)
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            url: `file://eval/${fixtureRel}`,
            title,
            content: text,
            charCount: text.length,
          }),
        },
      ],
    }
  }
}

async function runCase(caseDef, opts) {
  const agent = new Agent()

  // 页面上下文 + 专用系统提示词（对齐 ws-server 的组装方式）
  let systemPrompt = caseDef.action ? ACTION_PROMPTS[caseDef.action] : SYSTEM_PROMPT
  if (caseDef.fixture) {
    const { title } = loadFixture(caseDef.fixture)
    systemPrompt = appendPageContext(systemPrompt, {
      url: `file://eval/${caseDef.fixture}`,
      title,
      selection: '',
    })
  }
  // get_page_content 是"当前页"语义，按 case 绑定 fixture 动态覆盖
  handler.setToolOverrides({
    ...baseOverrides,
    ...(caseDef.fixture ? { get_page_content: fixturePageOverride(caseDef.fixture) } : {}),
  })

  const t0 = Date.now()
  const result = await agent.process(caseDef.prompt, {
    connectionId: 1,
    systemPrompt,
    onStep: () => {},
  })
  const durationMs = Date.now() - t0

  const verdict = await judgeAnswer(caseDef.rubric || {}, result, {
    useLLMJudge: opts.llmJudge,
    llm: agent.llm,
  })

  return {
    id: caseDef.id,
    type: caseDef.type,
    passed: verdict.passed && result?.success === true,
    durationMs,
    contentChars: String(result?.content || '').length,
    error: result?.success ? undefined : result?.error,
    checks: verdict.checks,
    contentPreview: String(result?.content || '').slice(0, 300),
  }
}

async function main() {
  const opts = parseArgs()
  installToolOverrides()

  const all = JSON.parse(fs.readFileSync(path.join(EVAL_DIR, 'golden/cases.json'), 'utf8')).cases
  const cases = all.filter(
    (c) => !opts.filter || c.id.includes(opts.filter) || c.type.includes(opts.filter)
  )
  if (cases.length === 0) {
    console.log('no cases matched filter:', opts.filter)
    return
  }

  console.log(
    `\n=== 黄金评测：${cases.length} 个 case（LLM judge: ${opts.llmJudge ? 'on' : 'off'}）===\n`
  )
  const results = []
  for (const c of cases) {
    process.stdout.write(`▶ ${c.id} ... `)
    try {
      const r = await runCase(c, opts)
      results.push(r)
      console.log(
        r.passed
          ? `✅ PASS (${r.durationMs}ms)`
          : `❌ FAIL (${r.durationMs}ms) — ${r.checks
              .filter((x) => !x.passed)
              .map((x) => x.name)
              .join(',')}`
      )
    } catch (e) {
      results.push({
        id: c.id,
        type: c.type,
        passed: false,
        error: e.message,
        checks: [],
        durationMs: 0,
      })
      console.log(`💥 ERROR — ${e.message}`)
    }
  }

  const passCount = results.filter((r) => r.passed).length
  const rate = passCount / results.length
  const summary = {
    ranAt: new Date().toISOString(),
    total: results.length,
    passed: passCount,
    passRate: Number(rate.toFixed(3)),
    llmJudge: opts.llmJudge,
    results,
  }

  fs.mkdirSync(RESULTS_DIR, { recursive: true })
  fs.writeFileSync(path.join(RESULTS_DIR, 'latest.json'), JSON.stringify(summary, null, 2))

  // markdown 报告
  const lines = [
    `# 黄金评测报告`,
    ``,
    `- 时间：${summary.ranAt}`,
    `- 通过率：**${passCount}/${results.length}（${(rate * 100).toFixed(1)}%）**`,
    ``,
    `| case | 类型 | 结果 | 耗时 | 失败项 |`,
    `|---|---|---|---|---|`,
    ...results.map(
      (r) =>
        `| ${r.id} | ${r.type} | ${r.passed ? '✅' : '❌'} | ${r.durationMs}ms | ${
          (r.checks || [])
            .filter((x) => !x.passed)
            .map((x) => x.name)
            .join(',') || '-'
        } |`
    ),
  ]
  fs.writeFileSync(path.join(RESULTS_DIR, 'report.md'), lines.join('\n'))

  console.log(
    `\n=== 结果：${passCount}/${results.length}（${(rate * 100).toFixed(1)}%）→ ${RESULTS_DIR}\\report.md ===`
  )
  if (rate < opts.minRate) {
    console.error(`通过率低于阈值 ${opts.minRate}`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('eval failed:', e)
  process.exit(1)
})
