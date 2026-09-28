const config = require('../config/index.js')
const store = require('./store.js')
const retrieve = require('./retrieve.js')
const vectorStore = require('./vector-store.js')
const { rrfFuse } = require('./rrf.js')
const { createHttpEmbedder, createHashingEmbedder } = require('./embedder.js')

/**
 * 混合检索编排层（P8）
 *
 * 兑现 retrieve.js 头注释里预留的"阶段 2"：BM25（词面）+ embedding 余弦（语义）
 * 两路召回，RRF 融合。BM25 主路径零改动（topK 保持同步签名，行为不变），
 * 混合逻辑独立成层——回退到纯 BM25 时与 P3 逐字节等价。
 *
 * 模式（config.memory.retrieval / env MEMORY_RETRIEVAL）：
 * - bm25：纯关键词（回归安全基线）
 * - vector：纯语义（评测对照臂）
 * - hybrid：BM25 + 向量 RRF 融合（生产推荐）
 * - auto（默认）：配了 EMBED_* 即 hybrid，否则 bm25——未配置时行为与 P3 完全一致
 *
 * 降级链：神经 embedder 调用失败 → 本次查询回退 BM25（degraded 标记）；
 * 写路径向量化失败 → 该卡片暂只有 BM25 通道，BM25 永远兜底。
 */

let neuralEmbedder // undefined=未解析 null=不可用 object=就绪
let hashingEmbedder = null

function resolveNeural() {
  if (neuralEmbedder !== undefined) return neuralEmbedder
  const cfg = config.memory?.embed
  neuralEmbedder = cfg?.baseURL && cfg?.apiKey && cfg?.model ? createHttpEmbedder(cfg) : null
  return neuralEmbedder
}

function resolveHashing() {
  return (hashingEmbedder ||= createHashingEmbedder())
}

/** 当前模式下的向量 embedder：神经优先；显式 vector/hybrid 且未配神经时降级本地 hashing */
function resolveVectorEmbedder(mode) {
  return resolveNeural() || (mode === 'vector' || mode === 'hybrid' ? resolveHashing() : null)
}

function tagBm25(list, k, extra = {}) {
  return list.slice(0, k).map((h, i) => ({
    ...h,
    channels: { bm25: i + 1, vector: null },
    ...extra,
  }))
}

/**
 * 混合检索：返回 top-k 卡片（附 channels 双路排名，"为什么召回"双通道可解释）
 * @param {string} query
 * @param {object} [opts] - { k, excludeUrl, mode?, embedder?（测试注入用） }
 */
async function search(query, { k = 3, excludeUrl, mode, embedder } = {}) {
  if (!query) return []
  let m = mode || config.memory?.retrieval || 'auto'
  if (m === 'auto') m = resolveNeural() ? 'hybrid' : 'bm25'
  const pool = config.memory?.vectorPool || 20

  const bm25List = retrieve.topK(query, { k: pool, excludeUrl })
  if (m === 'bm25') return tagBm25(bm25List, k)

  // 向量通道：查询向量化 + 进程内全量余弦（卡片 < 1 万条毫秒级，规模判断同 BM25）
  let vecList
  try {
    const emb = embedder || resolveVectorEmbedder(m)
    if (!emb) throw new Error('无可用 embedder')
    const [qvec] = await emb.embed([query])
    const byKey = new Map(store.readAll().map((c) => [vectorStore.cardKey(c), c]))
    const scored = []
    for (const { cardId, vec } of vectorStore.listByModel(emb.model)) {
      const card = byKey.get(cardId)
      if (!card) continue
      if (excludeUrl && card.url === excludeUrl) continue
      const sim = vectorStore.cosine(qvec, vec)
      if (sim > 0) scored.push({ card, score: Number(sim.toFixed(4)), matchedTerms: [] })
    }
    vecList = scored.sort((a, b) => b.score - a.score).slice(0, pool)
  } catch (error) {
    console.warn(`[Memory] 向量通道失败（${error.message}），本次降级 BM25`)
    if (m === 'vector') return [] // 纯向量模式失败就如实失败（评测对照臂），不静默回退
    return tagBm25(bm25List, k, { degraded: true })
  }

  if (m === 'vector') {
    return vecList.slice(0, k).map((h, i) => ({ ...h, channels: { bm25: null, vector: i + 1 } }))
  }

  // P8.1 置信度门控：词法名次进入融合前需要语义背书。
  // 失效模式（对抗评测实证）：词面陷阱卡"BM25 高名次 × 向量中游名次"的叠加分，
  // 会把纯向量命中的正确卡挤出 top-3（semantic 集 hybrid 75% < vector 100%）。
  // 规则：卡片余弦 ≥ β × 本查询最高余弦 才保留 BM25 名次，否则词法名次作废（向量通道照常）。
  // β 取 0.9：污染卡实测比值 ≤0.898，双通道一致卡 =1.0，落在间隙内且不贴边。
  // cosMax=0（语义通道整体无信号）时旁路门控——词法兜底不受影响。
  // 已知取舍：语义通道强烈不认的"纯词法精确匹配"会被降权（用一点召回换精度），
  // 真实场景出现再评估逃生通道。
  const cosMax = vecList.length ? vecList[0].score : 0
  const gateRatio = config.memory?.bm25GateRatio ?? 0.9
  const gateOn = gateRatio > 0 && cosMax > 0
  const vecCos = new Map(vecList.map((h) => [vectorStore.cardKey(h.card), h.score]))
  let gatedCount = 0
  const gatedBm25List = gateOn
    ? bm25List.filter((h) => {
        const ok = (vecCos.get(vectorStore.cardKey(h.card)) || 0) >= gateRatio * cosMax
        if (!ok) gatedCount++
        return ok
      })
    : bm25List
  if (gateOn && gatedCount > 0) {
    console.log(
      `[Memory] 置信度门控：${gatedCount}/${bm25List.length} 张卡的词法名次因语义背书不足被作废`
    )
  }

  // hybrid：两路排名做 RRF 融合（只用名次不用分数，免疫量纲问题）
  const fused = rrfFuse(
    [
      gatedBm25List.map((h) => vectorStore.cardKey(h.card)),
      vecList.map((h) => vectorStore.cardKey(h.card)),
    ],
    { k: config.memory?.rrfK || 60 }
  )
  const bm25Rank = new Map(
    gatedBm25List.map((h, i) => [
      vectorStore.cardKey(h.card),
      { rank: i + 1, matchedTerms: h.matchedTerms || [] },
    ])
  )
  const vecRank = new Map(vecList.map((h, i) => [vectorStore.cardKey(h.card), i + 1]))
  return [...fused.entries()]
    .map(([cardId, score]) => {
      const hit =
        gatedBm25List.find((h) => vectorStore.cardKey(h.card) === cardId) ||
        vecList.find((h) => vectorStore.cardKey(h.card) === cardId)
      const bm = bm25Rank.get(cardId)
      return {
        card: hit.card,
        score: Number(score.toFixed(4)),
        channels: { bm25: bm?.rank || null, vector: vecRank.get(cardId) || null },
        matchedTerms: bm?.matchedTerms || [],
      }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}

/**
 * 写路径异步沉淀：卡片落库后台补一条向量。
 * 只在向量通道真正参与检索时才写（auto+神经 / 显式 hybrid / vector）——
 * 纯 BM25 模式下不产生向量开销，测试环境也不会写脏向量文件。
 * 失败只 warn：该卡片暂只有 BM25 通道，检索可用性不受影响（BM25 永远兜底）。
 */
async function embedCardAsync(card) {
  const m = config.memory?.retrieval || 'auto'
  const effective = m === 'auto' ? (resolveNeural() ? 'hybrid' : 'bm25') : m
  if (effective === 'bm25') return false
  const emb = resolveVectorEmbedder(effective)
  if (!emb || !card) return false
  try {
    const [vec] = await emb.embed([`${card.title}\n${card.summary}`])
    return vectorStore.upsert(vectorStore.cardKey(card), emb.model, vec.length, vec)
  } catch (error) {
    console.warn(`[Memory] 卡片向量化失败（${error.message}）`)
    return false
  }
}

/** 测试用：清空 embedder 解析缓存 */
function resetForTest() {
  neuralEmbedder = undefined
  hashingEmbedder = null
}

module.exports = { search, embedCardAsync, resolveNeural, resolveVectorEmbedder, resetForTest }
