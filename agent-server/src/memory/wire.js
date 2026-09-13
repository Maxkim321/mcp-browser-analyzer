const store = require('./store.js')
const { topK } = require('./retrieve.js')

/**
 * 浏览记忆接线层（P3 RAG 应用层）
 * - rememberFromResult：总结/研究成功后写卡片（写路径）
 * - recallForPrompt：提问时检索相关旧卡片并格式化为上下文块（读路径）
 */

/**
 * 写卡片：Agent 成功回答且带页面上下文时调用
 * 过滤规则：正文太短（寒暄/"1"这类输入的回答）不入库，避免污染记忆
 * @param {object} pageContext - { url, title }
 * @param {string} content - AI 本次产出的总结/报告/回答
 */
function rememberFromResult(pageContext, content) {
  if (!pageContext?.url || !content) return null
  if (String(content).length < 200) return null
  return store.append({
    url: pageContext.url,
    title: pageContext.title,
    summary: String(content),
  })
}

/**
 * 读检索：返回格式化的上下文块 + 引用列表
 * @param {string} prompt - 用户输入
 * @param {object} [pageContext] - { url, title }（当前页自身不参与召回）
 * @param {number} [k=3]
 * @returns {{ block: string, refs: Array<{title,url,score,matchedTerms}> } | null}
 */
function recallForPrompt(prompt, pageContext, k = 3) {
  const query = [prompt, pageContext?.title].filter(Boolean).join(' ')
  const hits = topK(query, { k, excludeUrl: pageContext?.url })
  if (hits.length === 0) return null

  const refs = hits.map((h) => ({
    title: h.card.title,
    url: h.card.url,
    score: h.score,
    matchedTerms: h.matchedTerms || [],
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
