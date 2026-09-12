/**
 * 记忆 A/B 对照评测（P3 收官：把"记忆有没有用"从闭环验证变成对照数字）
 *
 * 实验：问题答案只存在于预埋记忆卡片，当前页与问题无关。
 * - on  臂：MEMORY_FILE 指向预埋卡片 → 检索注入 → 回答
 * - off 臂：MEMORY_FILE 指向空库 → 无记忆可注入（对照）
 * 判分：确定性 must_mention/regex（事实型答案，不需要 LLM judge）
 *
 * 产出三个数字（results/memory-ab-report.md）：
 * 1. recall@3：期望卡片进 top-3 的比例（检索层，确定性）
 * 2. 有记忆通过率 vs 无记忆通过率（回答层对照）
 * 3. Δ = 记忆增益
 *
 * 用法：pnpm -F agent-server eval:memory
 * 防先验泄漏设计：预埋事实是编造但具体的内部记录（k1=1.2 而非教科书默认 1.5），
 * 模型靠参数知识蒙不对——答对只能来自记忆检索。
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const EVAL_DIR = __dirname
const RESULTS_DIR = path.join(EVAL_DIR, 'results')
const SEED_FILE = path.join(EVAL_DIR, 'fixtures', 'memory-ab-seed.jsonl')
const EMPTY_FILE = path.join(RESULTS_DIR, '.tmp-empty-memory.jsonl')

function runArm(arm, memoryFile) {
  const out = path.join(RESULTS_DIR, `memory-ab-${arm}.json`)
  const res = spawnSync(process.execPath, [path.join(EVAL_DIR, 'memory-arm.js'), `--out=${out}`], {
    env: { ...process.env, MEMORY_ARM: arm, MEMORY_FILE: memoryFile },
    encoding: 'utf8',
    stdio: 'inherit',
  })
  if (res.status !== 0) throw new Error(`${arm} 臂执行失败（exit ${res.status}）`)
  return JSON.parse(fs.readFileSync(out, 'utf8'))
}

function main() {
  fs.mkdirSync(RESULTS_DIR, { recursive: true })
  fs.writeFileSync(EMPTY_FILE, '', 'utf8') // off 臂：空记忆库（readAll 对缺失/空文件返回 []）

  console.log('\n=== 记忆 A/B 对照评测 ===\n')
  const on = runArm('on', SEED_FILE)
  const off = runArm('off', EMPTY_FILE)

  const cases = JSON.parse(
    fs.readFileSync(path.join(EVAL_DIR, 'fixtures', 'memory-ab-cases.json'), 'utf8')
  ).cases
  const byId = (run, id) => run.results.find((r) => r.id === id)

  const recallHits = on.results.filter((r) => r.recall?.hit).length
  const onPass = on.results.filter((r) => r.passed).length
  const offPass = off.results.filter((r) => r.passed).length
  const total = on.results.length
  const delta = (onPass - offPass) / total

  const summary = {
    ranAt: new Date().toISOString(),
    total,
    recallAt3: Number((recallHits / total).toFixed(2)),
    withMemory: { pass: onPass, rate: Number((onPass / total).toFixed(2)) },
    withoutMemory: { pass: offPass, rate: Number((offPass / total).toFixed(2)) },
    memoryGain: Number(delta.toFixed(2)),
    cases: cases.map((c) => ({
      id: c.id,
      recallHit: byId(on, c.id)?.recall?.hit === true,
      recallScore: byId(on, c.id)?.recall?.score ?? null,
      matchedTerms: byId(on, c.id)?.recall?.matchedTerms || [],
      withMemory: byId(on, c.id)?.passed === true,
      withoutMemory: byId(off, c.id)?.passed === true,
    })),
  }
  fs.writeFileSync(path.join(RESULTS_DIR, 'memory-ab.json'), JSON.stringify(summary, null, 2))

  const lines = [
    `# 记忆 A/B 对照评测`,
    ``,
    `- 时间：${summary.ranAt}`,
    `- 设计：答案只在预埋记忆卡片里，当前页与问题无关；预埋事实偏离公开默认值（防先验蒙对）`,
    ``,
    `| 指标 | 数字 |`,
    `|---|---|`,
    `| 检索层 recall@3 | **${(summary.recallAt3 * 100).toFixed(0)}%**（${recallHits}/${total}） |`,
    `| 有记忆通过率 | **${(summary.withMemory.rate * 100).toFixed(0)}%**（${onPass}/${total}） |`,
    `| 无记忆通过率（对照） | ${(summary.withoutMemory.rate * 100).toFixed(0)}%（${offPass}/${total}） |`,
    `| 记忆增益 Δ | **${(delta * 100).toFixed(0)} pct** |`,
    ``,
    `| case | 召回命中 | BM25 分 | 命中词 | 有记忆 | 无记忆 |`,
    `|---|---|---|---|---|---|`,
    ...summary.cases.map(
      (c) =>
        `| ${c.id} | ${c.recallHit ? '✅' : '❌'} | ${c.recallScore ?? '-'} | ${c.matchedTerms.join('/') || '-'} | ${c.withMemory ? '✅' : '❌'} | ${c.withoutMemory ? '✅' : '❌'} |`
    ),
  ]
  fs.writeFileSync(path.join(RESULTS_DIR, 'memory-ab-report.md'), lines.join('\n'))
  console.log(`\n=== 结果 ===`)
  console.log(lines.slice(7, 12).join('\n'))
  console.log(`\n→ ${path.join(RESULTS_DIR, 'memory-ab-report.md')}`)
  fs.unlinkSync(EMPTY_FILE)
}

main()
