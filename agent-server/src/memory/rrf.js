/**
 * Reciprocal Rank Fusion（P8 混合检索融合层）
 *
 * 为什么用 RRF 而不是加权分数融合：BM25 分与余弦相似度量纲完全不同
 * （BM25 无上界、余弦 0~1），直接加权没有可解释的权重；RRF **只用排名不用分数**，
 * 天然免疫量纲问题，且是纯函数可单测。
 *
 * k 的语义：决定"排名靠前"能拉开多少差距。k 越大各通道越平均，k 越小头部话语权越大。
 * k=60 是文献常用值。公式：score(d) = Σ 1 / (k + rank_i(d))，rank 从 1 起。
 */

/**
 * @param {string[][]} rankLists - 多路检索的 id 排名列表（每路按相关性降序）
 * @param {object} [opts] - { k?: 融合常数（默认 60） }
 * @returns {Map<string, number>} id → 融合得分（降序排列需调用方自行 sort）
 */
function rrfFuse(rankLists, { k = 60 } = {}) {
  const scores = new Map()
  for (const list of rankLists) {
    if (!Array.isArray(list)) continue
    list.forEach((id, i) => {
      if (id == null) return
      scores.set(id, (scores.get(id) || 0) + 1 / (k + i + 1))
    })
  }
  return scores
}

module.exports = { rrfFuse }
