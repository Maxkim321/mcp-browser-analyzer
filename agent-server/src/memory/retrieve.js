const store = require('./store.js')

/**
 * 浏览记忆检索（P3 RAG 检索层）
 *
 * 阶段 1（当前实现）：BM25-lite 关键词打分，零依赖。
 * 中文无分词器 → 用 CJK 相邻双字组（bigram）+ ASCII 单词做词项，实践上够用；
 * 规模判断：卡片 < 1 万条时全量暴力打分毫秒级，不引入向量库是有意为之的选型。
 * 阶段 2（预留）：embedding 余弦相似度，接口保持 topK(query, k) 不变即可替换。
 */

const BM25 = { k1: 1.5, b: 0.75 }

/** 分词：ASCII 单词 + CJK 双字组（"事件驱动" → 事件/件驱/驱动） */
function tokenize(text) {
  const tokens = []
  const lower = String(text || '').toLowerCase()
  for (const w of lower.match(/[a-z0-9][a-z0-9._-]*/g) || []) tokens.push(w)
  for (const run of lower.match(/[\u4e00-\u9fa5]+/g) || []) {
    if (run.length === 1) {
      tokens.push(run)
      continue
    }
    for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2))
  }
  return tokens
}

/** 文档字段权重：标题最重，摘要次之（都是"这一页讲什么"的浓缩） */
function docTokens(card) {
  return [
    ...tokenize(card.title),
    ...tokenize(card.title),
    ...tokenize(card.summary),
    ...tokenize(card.summary),
  ]
}

/**
 * 检索最相关的 k 张卡片
 * @param {string} query - 用户输入 + 当前页面标题
 * @param {object} [opts] - { k: 返回条数(默认 3), excludeUrl: 排除当前页自身 }
 * @returns {Array<{card, score}>}
 */
function topK(query, { k = 3, excludeUrl } = {}) {
  const cards = store.readAll()
  if (cards.length === 0 || !query) return []

  const docs = cards.map((card) => ({ card, tokens: docTokens(card) }))
  const N = docs.length
  const avgLen = docs.reduce((s, d) => s + d.tokens.length, 0) / N || 1

  const df = new Map()
  for (const d of docs) {
    for (const t of new Set(d.tokens)) df.set(t, (df.get(t) || 0) + 1)
  }

  const queryTokens = [...new Set(tokenize(query))]
  const scored = []
  for (const d of docs) {
    if (excludeUrl && d.card.url === excludeUrl) continue
    const len = d.tokens.length
    const tf = new Map()
    for (const t of d.tokens) tf.set(t, (tf.get(t) || 0) + 1)

    let score = 0
    for (const t of queryTokens) {
      const f = tf.get(t)
      if (!f) continue
      const idf = Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5))
      score += (idf * (f * (BM25.k1 + 1))) / (f + BM25.k1 * (1 - BM25.b + (BM25.b * len) / avgLen))
    }
    if (score > 0) scored.push({ card: d.card, score: Number(score.toFixed(3)) })
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, k)
}

module.exports = { topK, tokenize }
