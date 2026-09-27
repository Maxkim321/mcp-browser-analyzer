/**
 * 混合检索评测单臂执行器（由 run-hybrid-ab.js 以子进程方式驱动）
 *
 * 为什么子进程：store.js 在 require 时固化 MEMORY_FILE（与 memory-arm.js 同一约束），
 * 每个语料集一个进程、env 注入不同 MEMORY_FILE / MEMORY_VECTORS_FILE，隔离干净。
 * 三种模式（bm25/vector/hybrid）在同一进程内按 search 的 mode 参数逐个跑——模式是
 * 显式参数无需进程隔离；查询向量带缓存，三模式复用同一次 embedding 外呼。
 *
 * 判分：期望卡片 url 是否进 top-k（确定性，零 LLM 成本）。
 * env：HYBRID_SET=regression|semantic  MEMORY_FILE=...  MEMORY_VECTORS_FILE=...
 * 输出：results/hybrid-ab-<set>.json
 */
const fs = require('fs')
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const store = require('../src/memory/store.js')
const { syncEmbeddings } = require('../src/memory/embed-sync.js')
const hybrid = require('../src/memory/hybrid.js')

const RESULTS_DIR = path.join(__dirname, 'results')

/** 带 memo 的 embedder 包装：同文本只外呼一次（三模式复用，也省 API 钱） */
function withCache(embedder) {
  const memo = new Map()
  return {
    model: embedder.model,
    async embed(texts) {
      const out = []
      for (const t of texts) {
        if (!memo.has(t)) {
          const [v] = await embedder.embed([t])
          memo.set(t, v)
        }
        out.push(memo.get(t))
      }
      return out
    },
  }
}

function loadSet(set) {
  if (set === 'regression') {
    // 回归集：复用 P3 记忆 A/B 的预埋卡片与 case（关键词重合型，BM25 的主场）
    const { cases } = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'fixtures', 'memory-ab-cases.json'), 'utf8')
    )
    return {
      cases: cases.map(({ id, prompt, expectedUrl }) => ({
        id,
        kind: 'keyword',
        prompt,
        expectedUrl,
      })),
    }
  }
  const fx = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'memory-hybrid-cases.json'), 'utf8')
  )
  return { cases: fx.cases, seed: fx.seed }
}

async function main() {
  const set = process.env.HYBRID_SET || 'regression'
  const { cases } = loadSet(set)

  console.log(
    `=== 混合检索评测 [${set}]（${cases.length} case，语料 ${store.readAll().length} 卡）===`
  )
  await syncEmbeddings() // 幂等：已有向量的卡片自动跳过
  const neural = hybrid.resolveNeural()
  if (!neural) throw new Error('神经 embedder 未配置（EMBED_*），评测需要真实语义通道')
  const embedder = withCache(neural)

  const modes = ['bm25', 'vector', 'hybrid']
  const out = { set, ranAt: new Date().toISOString(), corpusSize: store.readAll().length, modes: {} }

  for (const mode of modes) {
    const rows = []
    for (const c of cases) {
      const t0 = Date.now()
      const hits = await hybrid.search(c.prompt, { k: 3, mode, embedder })
      const idx = hits.findIndex((h) => h.card.url === c.expectedUrl)
      rows.push({
        id: c.id,
        kind: c.kind,
        hit: idx >= 0,
        rank: idx >= 0 ? idx + 1 : null,
        score: idx >= 0 ? hits[idx].score : null,
        channels: idx >= 0 ? hits[idx].channels : null,
        degraded: hits.some((h) => h.degraded) || undefined,
        latencyMs: Date.now() - t0,
        topUrls: hits.map((h) => h.card.url.replace('https://eval.local/', '')),
      })
    }
    const hitCount = rows.filter((r) => r.hit).length
    out.modes[mode] = {
      rows,
      recallAt3: Number((hitCount / rows.length).toFixed(3)),
      recallAt1: Number((rows.filter((r) => r.rank === 1).length / rows.length).toFixed(3)),
      avgLatencyMs: Math.round(rows.reduce((s, r) => s + r.latencyMs, 0) / rows.length),
    }
    const m = out.modes[mode]
    console.log(
      `[${mode}] recall@3=${(m.recallAt3 * 100).toFixed(0)}% recall@1=${(m.recallAt1 * 100).toFixed(0)}% avg=${m.avgLatencyMs}ms`
    )
  }

  fs.mkdirSync(RESULTS_DIR, { recursive: true })
  const outPath = path.join(RESULTS_DIR, `hybrid-ab-${set}.json`)
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2))
  console.log(`→ ${outPath}`)
}

main().catch((e) => {
  console.error('hybrid arm failed:', e.message)
  process.exit(1)
})
