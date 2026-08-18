/**
 * 系统提示词上下文注入（纯函数，无副作用）
 * F1 轻量 pageContext + F5 偏好 KV：仅普通对话注入，固定动作（ACTION_PROMPTS 严格模板）不注入
 */

/**
 * 把轻量页面上下文附加到系统提示词（F1）
 * 只追加 {url,title,selection}，token 开销极小；与问题无关时模型会忽略
 * @param {string} systemPrompt - 原始系统提示词
 * @param {object} pageContext - 插件随 user_prompt 附带的页面上下文
 * @returns {string} 追加后的系统提示词
 */
function appendPageContext(systemPrompt, pageContext) {
  if (!pageContext || typeof pageContext !== 'object') return systemPrompt
  const lines = []
  const title = String(pageContext.title || '').trim()
  const url = String(pageContext.url || '').trim()
  const selection = String(pageContext.selection || '').trim()
  if (title) lines.push(`- 页面标题：${title.slice(0, 200)}`)
  if (url) lines.push(`- 页面地址：${url.slice(0, 500)}`)
  if (selection) lines.push(`- 用户选中文本：${selection.slice(0, 500)}`)
  if (lines.length === 0) return systemPrompt
  return `${systemPrompt}\n\n## 当前页面上下文（用户提问时参考，与问题无关则忽略）\n${lines.join('\n')}`
}

/**
 * 把用户偏好附加到系统提示词（F5，L3 偏好 KV）
 * 只注入"非默认值"偏好（默认值注入等于没注入，浪费 token）；与问题无关时模型会忽略
 * @param {string} systemPrompt - 原始系统提示词
 * @param {object} prefs - 插件随 user_prompt 附带的偏好 {summaryStyle, translateLang, replyStyle}
 * @returns {string} 追加后的系统提示词
 */
function appendPrefs(systemPrompt, prefs) {
  if (!prefs || typeof prefs !== 'object') return systemPrompt
  const lines = []
  const summaryStyle = String(prefs.summaryStyle || '').trim()
  const translateLang = String(prefs.translateLang || '').trim()
  const replyStyle = String(prefs.replyStyle || '').trim()
  if (summaryStyle && summaryStyle !== 'concise') {
    lines.push(`- 总结格式偏好：${summaryStyle === 'detailed' ? '详细（含背景与展开说明）' : summaryStyle}`)
  }
  if (translateLang && translateLang !== 'zh') {
    lines.push(`- 默认翻译目标语言：${translateLang}`)
  }
  if (replyStyle && replyStyle !== 'professional') {
    const styleMap = { casual: '口语化', concise: '精简干练' }
    lines.push(`- 回复风格偏好：${styleMap[replyStyle] || replyStyle}`)
  }
  if (lines.length === 0) return systemPrompt
  return `${systemPrompt}\n\n## 用户偏好（回答时参考，与问题无关则忽略）\n${lines.join('\n')}`
}

module.exports = { appendPageContext, appendPrefs }
