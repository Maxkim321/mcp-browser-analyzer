/**
 * 混合检索三路对照评测（P8 收官：把"加向量到底带来什么"变成对照数字）
 *
 * 实验设计（两个语料集 × 三种检索模式，判分全部确定性，零 LLM 成本）：
 * - regression 集：复用记忆 A/B 的原 12 case（关键词重合型，BM25 的主场）
 *   → 验证混合检索"不回退"：hybrid recall@3 必须 = bm25 recall@3 = 100%
 * - semantic 集：新造 12 条对抗 query（同义改写/跨语言/意图型，构造上与期望卡
 *   片零词面重合）+ 4 张词面陷阱卡 → 验证混合检索"补盲区"：BM25 必然失手
 * - 模式：bm25（纯关键词）/ vector（纯语义对照臂）/ hybrid（RRF 融合）
 *
 * 产出（results/hybrid-ab-report.md）：
 * 1. 每集每模式 recall@3 / recall@1 / 平均时延
 * 2. 语义集逐 case 双通道救援明细（哪条 query 被语义通道救回）
 *
 * 用法：pnpm -F agent-server eval:hybrid  （需 .env 配置 EMBED_*）
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const EVAL_DIR = __dirname
const RESULTS_DIR = path.join(EVAL_DIR, 'results')
const PCT = (x) => `${(x * 100).toFixed(0)}%`

function runSet(set, seedForTmp) {
  const corpus = path.join(RESULTS_DIR, `.tmp-corpus-${set}.jsonl`)
  const vectors = path.join(RESULTS_DIR, `.tmp-vectors-${set}.jsonl`)
  fs.writeFileSync(corpus, seedForTmp, 'utf8')
  fs.writeFileSync(vectors, '', 'utf8')
  const out = path.join(RESULTS_DIR, `hybrid-ab-${set}.json`)
  const res = spawnSync(
    process.execPath,
    [path.join(EVAL_DIR, 'hybrid-arm.js'), `--out=${out}`],
    {
      env: { ...process.env, HYBRID_SET: set, MEMORY_FILE: corpus, MEMORY_VECTORS_FILE: vectors },
      encoding: 'utf8',
      stdio: 'inherit',
    }
  )
  if (res.status !== 0) throw new Error(`${set} 集执行失败（exit ${res.status}）`)
  return JSON.parse(fs.readFileSync(out, 'utf8'))
}

function main() {
  fs.mkdirSync(RESULTS_DIR, { recursive: true })

  console.log('\n=== 混合检索三路对照评测 ===\n')
  // regression 语料直接来自记忆 A/B 种子文件
  const regressionSeed = fs.readFileSync(
    path.join(EVAL_DIR, 'fixtures', 'memory-ab-seed.jsonl'),
    'utf8'
  )
  const semanticFx = JSON.parse(
    fs.readFileSync(path.join(EVAL_DIR, 'fixtures', 'memory-hybrid-cases.json'), 'utf8')
  )
  const semanticSeed = semanticFx.seed.map((c) => JSON.stringify(c)).join('\n')

  const regression = runSet('regression', regressionSeed)
  const semantic = runSet('semantic', semanticSeed)

  const summary = { ranAt: new Date().toISOString(), sets: { regression, semantic } }
  fs.writeFileSync(path.join(RESULTS_DIR, 'hybrid-ab.json'), JSON.stringify(summary, null, 2))

  const lines = [
    `# 混合检索三路对照评测`,
    ``,
    `- 时间：${summary.ranAt}`,
    `- 设计：regression 集（原 12 case，关键词重合型）验证不回退；semantic 集（12 条同义改写/`,
    `  跨语言/意图型对抗 query + 4 张词面陷阱卡）验证补盲区；判分确定性（期望卡进 top-3），零 LLM 成本`,
    `- embedding：方舟 doubao-embedding-vision（2048 维），查询向量三模式共享缓存`,
    ``,
    `## 总表（recall@3 / recall@1 / 平均单次查询时延）`,
    ``,
    `| 语料集 | 指标 | bm25 | vector | hybrid |`,
    `|---|---|---|---|---|`,
    ...['regression', 'semantic'].flatMap((set) => {
      const m = summary.sets[set].modes
      const label = set === 'regression' ? 'regression（关键词主场）' : 'semantic（语义对抗）'
      return [
        `| ${label} | recall@3 | **${PCT(m.bm25.recallAt3)}** | ${PCT(m.vector.recallAt3)} | **${PCT(
          m.hybrid.recallAt3
        )}** |`,
        `| ${label} | recall@1 | ${PCT(m.bm25.recallAt1)} | ${PCT(m.vector.recallAt1)} | ${PCT(
          m.hybrid.recallAt1
        )} |`,
        `| ${label} | 时延 | ${m.bm25.avgLatencyMs}ms | ${m.vector.avgLatencyMs}ms | ${m.hybrid.avgLatencyMs}ms |`,
      ]
    }),
    ``,
    `## semantic 集逐 case 明细（双通道救援视图）`,
    ``,
    `| case | 类型 | bm25 | vector | hybrid | 救援判定 |`,
    `|---|---|---|---|---|---|`,
    ...semantic.modes.bm25.rows.map((r) => {
      const v = semantic.modes.vector.rows.find((x) => x.id === r.id)
      const h = semantic.modes.hybrid.rows.find((x) => x.id === r.id)
      const fmt = (x) => (x.hit ? `#${x.rank}` : '✗')
      let verdict = '—'
      if (!r.hit && v.hit && h.hit) verdict = '**语义通道救援**'
      else if (r.hit && h.hit) verdict = '关键词通道保住'
      else if (h.hit) verdict = '融合增益'
      return `| ${r.id} | ${r.kind} | ${fmt(r)} | ${fmt(v)} | ${fmt(h)} | ${verdict} |`
    }),
    ``,
    `## regression 集逐 case 明细（不回退验证）`,
    ``,
    `| case | bm25 | hybrid | 双通道排名 |`,
    `|---|---|---|---|`,
    ...regression.modes.bm25.rows.map((r) => {
      const h = regression.modes.hybrid.rows.find((x) => x.id === r.id)
      const fmt = (x) => (x.hit ? `#${x.rank}` : '✗')
      return `| ${r.id} | ${fmt(r)} | ${fmt(h)} | ${
        h.channels ? `bm25:${h.channels.bm25 ?? '-'} / vec:${h.channels.vector ?? '-'}` : '-'
      } |`
    }),
  ]
  fs.writeFileSync(path.join(RESULTS_DIR, 'hybrid-ab-report.md'), lines.join('\n'))

  // 控制台摘要
  const m1 = regression.modes
  const m2 = semantic.modes
  console.log(`\n=== 结果 ===`)
  console.log(
    `regression: bm25=${PCT(m1.bm25.recallAt3)} → hybrid=${PCT(m1.hybrid.recallAt3)}（不回退）`
  )
  console.log(
    `semantic:   bm25=${PCT(m2.bm25.recallAt3)} → hybrid=${PCT(m2.hybrid.recallAt3)}（补盲区）`
  )
  console.log(`\n→ ${path.join(RESULTS_DIR, 'hybrid-ab-report.md')}`)

  // 清理临时语料（保留 JSON 结果与报告）
  for (const set of ['regression', 'semantic']) {
    fs.rmSync(path.join(RESULTS_DIR, `.tmp-corpus-${set}.jsonl`), { force: true })
    fs.rmSync(path.join(RESULTS_DIR, `.tmp-vectors-${set}.jsonl`), { force: true })
  }
}

main()
