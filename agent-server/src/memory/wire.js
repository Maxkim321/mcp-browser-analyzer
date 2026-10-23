const store = require('./store.js')
const hybrid = require('./hybrid.js')

/**
 * 浏览记忆接线层（P3 RAG 应用层 / P8 混合检索改造 / P17 程序记忆）
 * - rememberFromResult：总结/研究成功后写卡片（写路径），后台异步补向量
 * - recallForPrompt：提问时检索相关旧卡片并格式化为上下文块（读路径）
 * - distillPlaybook：P17 程序记忆——成功任务的工具轨迹蒸馏成"操作手册"卡，
 *   同类任务再次出现时召回注入，agent 按手册走、不再从零探索
 *   （先例：Voyager 技能库 / Manus 失败教训回写 / Anthropic Agent Skills）
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

  // P17：事实卡（读过什么）与手册卡（怎么操作）分块——手册是程序记忆，
  // 注入措辞带失效条款（站点改版时以页面真值为准，防止过时手册带偏）
  const isPlaybook = (card) => String(card.title || '').startsWith('操作手册：')
  const refs = hits.map((h) => ({
    title: h.card.title,
    url: h.card.url,
    score: h.score,
    matchedTerms: h.matchedTerms || [],
    type: isPlaybook(h.card) ? 'playbook' : 'fact',
    channels: h.channels || null,
  }))
  const fmt = (h, i, len) =>
    `${i + 1}. 《${h.card.title}》\n   要点：${h.card.summary.slice(0, len).replace(/\n+/g, ' ')}`
  const facts = hits.filter((h) => !isPlaybook(h.card))
  const playbooks = hits.filter((h) => isPlaybook(h.card))
  let block = ''
  if (facts.length) {
    block += `【浏览记忆】以下是该用户之前读过并总结过的相关页面（来自本机记忆库），如与当前问题相关可参考，引用时注明页面标题；无关则忽略：\n${facts
      .map((h, i) => fmt(h, i, 300))
      .join('\n')}`
  }
  if (playbooks.length) {
    if (block) block += '\n\n'
    block += `【操作手册】以下是历史成功任务沉淀的操作步骤（同类任务可优先遵循以省探索；**与页面实际不符时以页面真值为准**，自纠成功后手册会更新）：\n${playbooks
      .map((h, i) => fmt(h, i, 700))
      .join('\n')}`
  }
  if (!block) return null
  return { block, refs }
}

module.exports = { rememberFromResult, recallForPrompt, distillPlaybook }

/**
 * P17 程序记忆（操作手册）：成功任务的工具轨迹 → 蒸馏成手册卡
 *
 * 卡片形态与事实卡同构（title 以"操作手册："为前缀、url=站点根）：
 * store 的"同 URL+同标题追加新版本、检索取最新"语义即版本化——
 * 同站点再次成功运行会更新同一本手册（自沉淀→自更新闭环）。
 *
 * 门控（全部满足才蒸馏，防记忆污染）：
 * - 有 LLM 客户端 + 原始问题 + 成功回答
 * - 工具步骤 ≥ 3（单步问答没有可沉淀的流程）
 * - 能确定站点域（页面上下文或 LLM 从轨迹中识别），title/url 才有稳定键
 *
 * @param {object} input - { prompt, answer, steps, pageContext }
 * @param {object} llm - LLMClient 实例（用 light 档蒸馏，成本可忽略）
 * @returns {Promise<object|null>} 落库的手册卡；门控未过/失败返回 null
 */
const DISTILL_MIN_TOOL_STEPS = 3
const PLAYBOOK_TITLE_PREFIX = '操作手册：'

async function distillPlaybook({ prompt, answer, steps, pageContext } = {}, llm) {
  if (!llm || !prompt || !answer) return null
  const toolSteps = (steps || []).filter((s) => s && s.phase === 'tool' && s.tool)
  if (toolSteps.length < DISTILL_MIN_TOOL_STEPS) return null
  const stepsText = toolSteps
    .map((s, i) => `${i + 1}. ${s.tool}${s.tool && s.iteration ? `（第 ${s.iteration} 轮）` : ''}`)
    .join('\n')
  const distillPrompt = `你是操作流程蒸馏器。下面是一次浏览器 agent 成功完成任务的轨迹，请把它蒸馏成一份可复用的操作手册，供下次同类任务直接遵循。

用户任务：${String(prompt).slice(0, 200)}
执行步骤（按顺序）：
${stepsText}
最终回答（前 600 字）：
${String(answer).slice(0, 600)}

严格按以下格式输出（总长不超过 500 字，不要输出其他内容）：
站点：<本任务操作的网站主域名，如 trains.ctrip.com；从步骤里的工具名和任务语境判断>
触发：<什么情况下应使用本手册，20 字内>
步骤：
1) <第一步>
2) <第二步>
（按实际步骤数）
坑：
- <本次踩过或绕过的坑，如某参数不可靠、某类点击会被拦截；没有则写"无">
失效：与页面实际不符时以页面真值为准`

  try {
    const msg = await llm.chat([{ role: 'user', content: distillPrompt }], [], '你是操作流程蒸馏器。', null, {
      tier: 'light',
      agent: 'memory',
    })
    const text = String(msg?.content || '').trim()
    if (text.length < 80) return null
    const siteMatch = /站点：\s*([a-z0-9.-]+\.[a-z]{2,})/i.exec(text)
    const origin = siteMatch
      ? `https://${siteMatch[1]}/`
      : pageContext?.url
        ? new URL(pageContext.url).origin + '/'
        : null
    if (!origin) return null
    const host = new URL(origin).host
    const card = store.append({
      url: origin,
      title: `${PLAYBOOK_TITLE_PREFIX}${host}`,
      summary: text,
    })
    if (card) hybrid.embedCardAsync(card)
    return card
  } catch (error) {
    console.warn('[Memory] distillPlaybook failed:', error.message)
    return null
  }
}
