/**
 * F5 长期偏好记忆（L3）
 * 结构化 KV 存储（chrome.storage.local），不做向量化：
 *  - ba_prefs：用户偏好（总结格式/翻译语言/回复风格），随 user_prompt 附带给服务端注入
 *  - ba_articles：已总结/收藏的文章索引 {url,title,summary,savedAt}，支持检索回看
 */

export const DEFAULT_PREFS = {
  summaryStyle: 'concise', // concise 简洁 | detailed 详细
  translateLang: 'zh', // 默认翻译目标语言
  replyStyle: 'professional', // professional 专业 | casual 口语 | concise 精简
}

const MAX_ARTICLES = 200

export const getPrefs = async () => {
  try {
    const { ba_prefs } = await chrome.storage.local.get('ba_prefs')
    return { ...DEFAULT_PREFS, ...(ba_prefs || {}) }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export const savePrefs = async (prefs) => {
  const merged = { ...DEFAULT_PREFS, ...prefs }
  await chrome.storage.local.set({ ba_prefs: merged })
  return merged
}

export const getArticles = async () => {
  try {
    const { ba_articles } = await chrome.storage.local.get('ba_articles')
    return Array.isArray(ba_articles) ? ba_articles : []
  } catch {
    return []
  }
}

// 按 url 去重，新条目插头部，超上限截断
export const addArticle = async (article) => {
  if (!article || !article.url) return getArticles()
  const list = await getArticles()
  const next = [
    { ...article, savedAt: article.savedAt || Date.now() },
    ...list.filter((a) => a.url !== article.url),
  ].slice(0, MAX_ARTICLES)
  await chrome.storage.local.set({ ba_articles: next })
  return next
}

export const removeArticle = async (url) => {
  const list = await getArticles()
  const next = list.filter((a) => a.url !== url)
  await chrome.storage.local.set({ ba_articles: next })
  return next
}
