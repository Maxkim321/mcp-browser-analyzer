/**
 * 临时诊断（P8.1 门控设计用）：dump 失败 case 的完整双通道分数，用完即删
 * 用法：node eval/diag-gate.js
 */
const fs = require('fs')
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const RESULTS_DIR = path.join(__dirname, 'results')
const CORPUS = path.join(RESULTS_DIR, '.diag-corpus.jsonl')
const VECTORS = path.join(RESULTS_DIR, '.diag-vectors.jsonl')
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'memory-hybrid-cases.json'), 'utf8'))
fs.writeFileSync(CORPUS, fx.seed.map((c) => JSON.stringify(c)).join('\n') + '\n', 'utf8')
fs.writeFileSync(VECTORS, '', 'utf8')
process.env.MEMORY_FILE = CORPUS
process.env.MEMORY_VECTORS_FILE = VECTORS

const store = require('../src/memory/store.js')
const retrieve = require('../src/memory/retrieve.js')
const vectorStore = require('../src/memory/vector-store.js')
const hybrid = require('../src/memory/hybrid.js')
const { syncEmbeddings } = require('../src/memory/embed-sync.js')

const TRAPS = fx.seed.filter((c) => c['lexical-trap']).map((c) => c.url.replace('https://eval.local/', ''))
const url = (u) => u.replace('https://eval.local/', '')

async function main() {
  await syncEmbeddings()
  const neural = hybrid.resolveNeural()
  const out = { traps: TRAPS, cases: [] }
  for (const c of fx.cases) {
    const qvec = (await neural.embed([c.prompt]))[0]
    // BM25 全量（pool=20 > 语料 16，所有 score>0 的卡都有名次）
    const bm25 = retrieve.topK(c.prompt, { k: 20 }).map((h) => ({
      url: url(h.card.url), rank: null, score: h.score,
    }))
    bm25.forEach((r, i) => (r.rank = i + 1))
    // 向量全量
    const vec = []
    for (const { cardId, vec: v } of vectorStore.listByModel('doubao-embedding-vision')) {
      const card = store.readAll().find((x) => x.id === cardId || x.url === cardId)
      if (!card) continue
      vec.push({ url: url(card.url), score: +vectorStore.cosine(qvec, v).toFixed(4) })
    }
    vec.sort((a, b) => b.score - a.score)
    vec.forEach((r, i) => (r.rank = i + 1))
    out.cases.push({
      id: c.id, expected: url(c.expectedUrl), prompt: c.prompt,
      bm25, vec,
    })
  }
  fs.writeFileSync(path.join(__dirname, 'results', 'diag-gate.json'), JSON.stringify(out, null, 1))
  // 控制台摘要：三个失败 case + 一个对照
  for (const id of ['S5-intent', 'S6-paraphrase', 'S7-crosslang', 'S2-paraphrase']) {
    const c = out.cases.find((x) => x.id === id)
    console.log(`\n===== ${c.id}（期望 ${c.expected}）=====`)
    console.log('BM25 全量排名（分数）:')
    c.bm25.forEach((r) => console.log(`  #${r.rank} ${r.url}  ${r.score} ${TRAPS.includes(r.url) ? '[陷阱]' : ''}${r.url === c.expected ? ' ←期望' : ''}`))
    console.log('向量全量排名（余弦）:')
    c.vec.forEach((r) => console.log(`  #${r.rank} ${r.url}  ${r.score} ${TRAPS.includes(r.url) ? '[陷阱]' : ''}${r.url === c.expected ? ' ←期望' : ''}`))
  }
}
main().catch((e) => { console.error('diag failed:', e.message); process.exit(1) })
