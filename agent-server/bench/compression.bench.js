/**
 * 压缩保真度基准
 *
 * 思路：在早期对话里埋事实点 → 填充消息撑过 token 预算触发压缩 →
 * 用压缩后的视图回答考察问题 → 算"信息保留率"。
 *
 * 指标（每个策略一组）：
 * - retention   信息保留率 = 答对的事实点 / 总埋点（核心）
 * - viewTokens  压缩后视图的 token 估算（省了多少）
 * - overhead    摘要调用本身的开销（次数字数估算，不精确计费）
 *
 * 用法：pnpm -F agent-server bench
 * 判分：实体型事实用包含匹配（确定性）；answer 走真实 LLM（light 档，temp 0 由 config 决定）
 */
const fs = require('fs')
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })
const { HistoryStore } = require('../src/core/history-store.js')
const { estimateMessagesTokens } = require('../src/core/context-manager.js')
const { LLMClient } = require('../src/core/llm.js')

const OUT_DIR = path.join(__dirname, 'results')
const STRATEGIES = ['no-compress', 'truncate', 'rolling-summary']
const CASE_COUNT = 10
const TOKEN_BUDGET = 400 // 基准专用小预算：确保触发压缩且实验快

// ===== 数据生成：确定性伪随机，保证每次跑同一份数据 =====
function makeRng(seed) {
  let s = seed
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}

const FACT_TOPICS = [
  {
    key: 'package_manager',
    question: '我之前说项目用哪个包管理器来着？',
    answers: ['pnpm', 'npm', 'yarn'],
  },
  { key: 'version', question: '之前提到的版本号是多少？', answers: ['0.1.0', '1.2.0', '2.3.1'] },
  { key: 'city', question: '我之前说公司在哪个城市？', answers: ['杭州', '深圳', '成都'] },
  { key: 'framework', question: '之前说前端框架用的是哪个？', answers: ['Vue', 'React', 'Svelte'] },
  {
    key: 'database',
    question: '之前说数据库选型是什么？',
    answers: ['PostgreSQL', 'MySQL', 'SQLite'],
  },
]

const FILLER_SENTENCES = [
  '帮我看看这个报错是什么意思，堆栈信息我贴在下面了。',
  '这个函数的边界条件应该怎么处理比较稳妥？',
  '我觉得这里可以抽一个公共方法，你觉得有必要吗？',
  '需求又变了，产品说这周先不上线，你记一下。',
  '代码评审里有条意见说要加类型注解，我同意。',
  '这个依赖的版本有点老，升级会不会有兼容性问题？',
  '把日志级别调成 debug 之后再复现一次看看。',
  '这段逻辑有点绕，帮我加两个注释说明意图。',
]

/** 生成一个基准 case：早期埋 facts，中间大量填充，结尾提问 */
function makeCase(index, rng) {
  const chosen = [...FACT_TOPICS].sort(() => rng() - 0.5).slice(0, 3)
  const early = []
  const facts = []
  chosen.forEach((topic) => {
    const answer = topic.answers[index % topic.answers.length]
    facts.push({ key: topic.key, question: topic.question, answer })
    early.push({
      role: 'user',
      content: `顺便说一下，${topic.key.replace(/_/g, ' ')}相关：我们用的是 ${answer}。`,
    })
    early.push({
      role: 'assistant',
      content: `好的，已记录：${answer}。后续相关问题时我会基于这个背景回答。`,
    })
  })
  // 填充对话：把历史撑到远超预算（每条 ~30 token，约 40 条 ≈ 1200 token >> 400）
  const filler = []
  for (let i = 0; i < 20; i++) {
    filler.push({
      role: 'user',
      content: FILLER_SENTENCES[(index * 7 + i) % FILLER_SENTENCES.length],
    })
    filler.push({
      role: 'assistant',
      content: `收到。关于"${FILLER_SENTENCES[(index * 7 + i) % FILLER_SENTENCES.length].slice(0, 12)}…"，我建议分两步处理：先确认现象，再定位原因。`,
    })
  }
  return { id: `bench-${String(index + 1).padStart(2, '0')}`, early, filler, facts }
}

/** 把 case 变成消息序列：早期对话 + 填充 + 最新提问 */
function buildMessages(c, question) {
  return [...c.early, ...c.filler, { role: 'user', content: question }]
}

async function runStrategy(llm, strategy, cases) {
  let summarizeCalls = 0
  const perCase = []

  for (const c of cases) {
    const store = new HistoryStore({ strategy, tokenBudget: TOKEN_BUDGET })
    // 逐条 append 模拟真实对话过程（触发 trim/缓存语义）
    const messages = buildMessages(c, '')
    for (const m of messages) store.append(m)

    const summarize = async (text) => {
      summarizeCalls++
      const reply = await llm.chat(
        [
          {
            role: 'system',
            content:
              '你是摘要助手。请把对话压缩成一段保留全部具体事实（数字/名称/选择）的摘要，尽可能短。',
          },
          { role: 'user', content: text },
        ],
        [],
        undefined,
        undefined,
        { tier: 'light' }
      )
      return String(reply?.content || '')
    }

    const { messages: view } = await store.deriveView({ summarize })
    const viewTokens = estimateMessagesTokens(view)

    let correct = 0
    const detail = []
    for (const fact of c.facts) {
      const withQuestion = [...view, { role: 'user', content: fact.question }]
      const reply = await llm.chat(withQuestion, [], undefined, undefined, { tier: 'light' })
      const answer = String(reply?.content || '')
      const ok = answer.includes(fact.answer)
      if (ok) correct++
      detail.push({ key: fact.key, expect: fact.answer, ok, answer: answer.slice(0, 60) })
    }
    perCase.push({ id: c.id, facts: c.facts.length, correct, viewTokens, detail })
  }

  const totalFacts = perCase.reduce((s, x) => s + x.facts, 0)
  const totalCorrect = perCase.reduce((s, x) => s + x.correct, 0)
  const avgViewTokens = Math.round(perCase.reduce((s, x) => s + x.viewTokens, 0) / perCase.length)
  return {
    strategy,
    retention: Number((totalCorrect / totalFacts).toFixed(3)),
    avgViewTokens,
    summarizeCalls,
    cases: perCase,
  }
}

async function main() {
  const rng = makeRng(42)
  const cases = Array.from({ length: CASE_COUNT }, (_, i) => makeCase(i, rng))
  const llm = new LLMClient()

  console.log(
    `\n=== 压缩保真度基准：${cases.length} cases × ${STRATEGIES.length} 策略（budget=${TOKEN_BUDGET} tok）===`
  )
  const results = []
  for (const strategy of STRATEGIES) {
    process.stdout.write(`▶ ${strategy} ... `)
    const t0 = Date.now()
    const r = await runStrategy(llm, strategy, cases)
    r.durationMs = Date.now() - t0
    results.push(r)
    console.log(
      `保留率 ${(r.retention * 100).toFixed(1)}% · 视图 ${r.avgViewTokens} tok · ${r.durationMs}ms`
    )
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(
    path.join(OUT_DIR, 'compression-bench.json'),
    JSON.stringify({ ranAt: new Date().toISOString(), budget: TOKEN_BUDGET, results }, null, 2)
  )

  const best = [...results]
    .filter((r) => r.strategy !== 'no-compress')
    .sort((a, b) => b.retention - a.retention)[0]
  const lines = [
    `# 压缩保真度基准报告`,
    ``,
    `- 时间：${new Date().toISOString()} · ${cases.length} cases · budget=${TOKEN_BUDGET} tok`,
    ``,
    `| 策略 | 信息保留率 | 视图 token(均值) | 摘要调用 | 耗时 |`,
    `|---|---|---|---|---|`,
    ...results.map(
      (r) =>
        `| ${r.strategy} | **${(r.retention * 100).toFixed(1)}%** | ${r.avgViewTokens} | ${r.summarizeCalls} | ${r.durationMs}ms |`
    ),
    ``,
    `> 结论：压缩类策略中保留率最高的是 **${best.strategy}**（${(best.retention * 100).toFixed(1)}%），视图 token 相比 no-compress 下降 ${(100 - (best.avgViewTokens / results[0].avgViewTokens) * 100).toFixed(1)}%。`,
  ]
  fs.writeFileSync(path.join(OUT_DIR, 'compression-report.md'), lines.join('\n'))
  console.log(`\n报告 → ${OUT_DIR}\\compression-report.md`)
}

main().catch((e) => {
  console.error('bench failed:', e)
  process.exit(1)
})
