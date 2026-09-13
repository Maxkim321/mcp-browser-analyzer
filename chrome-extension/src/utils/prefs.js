/**
 * F5 长期偏好记忆（L3）
 * 结构化 KV 存储（chrome.storage.local），不做向量化：
 *  - ba_prefs：用户偏好（总结格式/翻译语言/回复风格），随 user_prompt 附带给服务端注入
 *  - ba_articles：已总结/收藏的文章索引 {url,title,summary,savedAt}，支持检索回看
 *  - ba_llm_config：LLM 配置（baseURL/apiKey/model/temperature），随 user_prompt 下发覆盖服务端默认值
 */

export const DEFAULT_PREFS = {
  summaryStyle: 'concise', // concise 简洁 | detailed 详细
  translateLang: 'zh', // 默认翻译目标语言
  replyStyle: 'professional', // professional 专业 | casual 口语 | concise 精简
}

const MAX_ARTICLES = 200

/**
 * LLM 配置默认值：全部留空表示「跟随服务端 .env」
 * 只有用户显式填写的字段才会下发覆盖，避免空值把服务端配置冲掉
 */
export const DEFAULT_LLM_CONFIG = {
  baseURL: '',
  apiKey: '',
  model: '',
  temperature: '', // 留空 = 用服务端默认（0.7）
}

/** 常用服务商预设，方便一键填充 baseURL + model */
export const LLM_PRESETS = [
  { label: '跟随服务端配置', baseURL: '', model: '' },
  { label: 'DeepSeek', baseURL: 'https://api.deepseek.com', model: 'deepseek-chat' },
  {
    label: '火山方舟（豆包）',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-2-0-pro-260215',
  },
  { label: 'OpenAI', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  {
    label: '阿里通义千问',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
  },
  { label: '月之暗面 Kimi', baseURL: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
]

export const getLLMConfig = async () => {
  try {
    const { ba_llm_config } = await chrome.storage.local.get('ba_llm_config')
    return { ...DEFAULT_LLM_CONFIG, ...(ba_llm_config || {}) }
  } catch {
    return { ...DEFAULT_LLM_CONFIG }
  }
}

export const saveLLMConfig = async (llmConfig) => {
  const merged = { ...DEFAULT_LLM_CONFIG, ...llmConfig }
  // 统一裁剪首尾空格：baseURL 末尾斜杠会让服务端拼出 //chat/completions
  merged.baseURL = String(merged.baseURL || '')
    .trim()
    .replace(/\/+$/, '')
  merged.apiKey = String(merged.apiKey || '').trim()
  merged.model = String(merged.model || '').trim()
  await chrome.storage.local.set({ ba_llm_config: merged })
  return merged
}

/**
 * 构造随 user_prompt 下发的 llmConfig
 * 只保留用户真正填了的字段，空字段不下发（让服务端保持自己的默认值）
 * @returns {object|undefined} 无任何有效字段时返回 undefined，消息体里就不会出现该字段
 */
export const buildLLMConfigPayload = async () => {
  const cfg = await getLLMConfig()
  const payload = {}
  if (cfg.baseURL) payload.baseURL = cfg.baseURL
  if (cfg.apiKey) payload.apiKey = cfg.apiKey
  if (cfg.model) payload.model = cfg.model
  const temp = Number(cfg.temperature)
  // temperature 允许 0，所以用 Number.isFinite 而非真值判断
  if (cfg.temperature !== '' && Number.isFinite(temp) && temp >= 0 && temp <= 2) {
    payload.temperature = temp
  }
  return Object.keys(payload).length > 0 ? payload : undefined
}

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

/**
 * 知识点卡片库（秋招随手记 / flashcard）
 * 独立于会话历史，本质是收藏问题 + 异步补全答案 + 可回顾。
 * ba_knowledge_points：数组，每条 { id, question, answer, status:'pending'|'done', createdAt, source }
 *  - pending：只收藏了问题，尚未补全答案
 *  - done：答案已生成（点开补全 or 从 AI 回答一键收藏即直接完成）
 *  - source：出处，如「划词」「手输」「AI 回答」+ 当前页面 URL，便于回顾时知道知识点来源
 */
const MAX_KNOWLEDGE_POINTS = 500

export const getKnowledgePoints = async () => {
  try {
    const { ba_knowledge_points } = await chrome.storage.local.get('ba_knowledge_points')
    return Array.isArray(ba_knowledge_points) ? ba_knowledge_points : []
  } catch {
    return []
  }
}

export const saveKnowledgePoints = async (list) => {
  await chrome.storage.local.set({ ba_knowledge_points: list })
  return list
}

// 新增卡片：新条目插头部，超上限截断
export const addKnowledgePoint = async (kp) => {
  const list = await getKnowledgePoints()
  const next = [kp, ...list].slice(0, MAX_KNOWLEDGE_POINTS)
  return saveKnowledgePoints(next)
}

// 更新某条（补全答案 / 状态翻转等）
export const updateKnowledgePoint = async (id, patch) => {
  const list = await getKnowledgePoints()
  const next = list.map((kp) => (kp.id === id ? { ...kp, ...patch } : kp))
  return saveKnowledgePoints(next)
}

export const removeKnowledgePoint = async (id) => {
  const list = await getKnowledgePoints()
  const next = list.filter((kp) => kp.id !== id)
  return saveKnowledgePoints(next)
}
