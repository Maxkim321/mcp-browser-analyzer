const store = require('./store.js')
const hybrid = require('./hybrid.js')

/**
 * 浏览记忆接线层（P3 RAG 应用层 / P8 混合检索改造）
 * - rememberFromResult：总结/研究成功后写卡片（写路径），后台异步补向量
 * - recallForPrompt：提问时检索相关旧卡片并格式化为上下文块（读路径）
 *   P8：改为 async——混合模式需要查询向量化（神经 embedder 必须外呼）；
 *   未配置 EMBED_* 时 auto 解析为纯 BM25，结果与 P3 一致，只是签名多了 await。
 */

/**
 * 写卡片：Agent 成功回答且带页面上下文时调用
 * 过滤规则：正文太短（寒暄/"1"这类输入的回答）不入库，避免污染记忆
 * @param {object} pageContext - { url, title }
 * @param {string} content - AI 本次产出的总结/报告/回答
 * @returns {object|null} 落库的卡片
 */
function rememberFromResult(pageContext, content) {
  if (!pageContext?.url || !content) return null
  if (String(content).length < 200) return null
  const card = store.append({
    url: pageContext.url,
    title: pageContext.title,
    summary: String(content),
  })
  // P8：向量化后台补齐（不阻塞不报错——失败该卡片就只有 BM25 通道）
  if (card) hybrid.embedCardAsync(card)
  return card
}

/**
 * 读检索：返回格式化的上下文块 + 引用列表
 * @param {string} prompt - 用户输入
 * @param {object} [pageContext] - { url, title }（当前页自身不参与召回）
 * @param {number} [k=3]
 * @returns {Promise<{ block: string, refs: Array<{title,url,score,matchedTerms,channels}> } | null>}
 */
async function recallForPrompt(prompt, pageContext, k = 3) {
  const query = [prompt, pageContext?.title].filter(Boolean).join(' ')
  const hits = await hybrid.search(query, { k, excludeUrl: pageContext?.url })
  if (hits.length === 0) return null

  const refs = hits.map((h) => ({
    title: h.card.title,
    url: h.card.url,
    score: h.score,
    matchedTerms: h.matchedTerms || [],
    // P8：双通道排名（"这条命中是关键词带进来的还是语义带进来的"可解释，前端悬浮展示）
    channels: h.channels || null,
  }))
  const items = hits
    .map(
      (h, i) =>
        `${i + 1}. 《${h.card.title}》\n   要点：${h.card.summary.slice(0, 300).replace(/\n+/g, ' ')}`
    )
    .join('\n')
  const block = `【浏览记忆】以下是该用户之前读过并总结过的相关页面（来自本机记忆库），如与当前问题相关可参考，引用时注明页面标题；无关则忽略：\n${items}`
  return { block, refs }
}

module.exports = { rememberFromResult, recallForPrompt }
