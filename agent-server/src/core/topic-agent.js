const { Agent } = require('./agent.js')
const { tools } = require('../tools/index.js')
const { RESEARCH_WORKER_PROMPT } = require('../config/prompts.js')
const { parseJSON } = require('./parse-json.js')

/**
 * 深度研究子 agent（TopicAgent，P6 subagentMode）
 *
 * 把 research 节点"搜→抓→grade→重试"的编排权从 orchestrator 下移给一个受限的
 * ReAct worker：检索词、读哪页、是否充分由 worker 自主决策（多跳追踪 + 主题内
 * 跨页综合），父层状态机只保留预算硬约束与 HITL 分叉点——所以父层
 * plan/compare/report/verify/HITL 一行不用改，子 agent 只是 research 节点的内部实现替换。
 *
 * 边界（刻意的收敛，见技术文档 P6）：
 * - 深度只有 1：worker 不得再 spawn 子 agent
 * - 只读域：工具白名单 web_search/fetch_url，提示词不可见 + 执行层 allowedTools 硬闸双保险
 * - 返回协议是 evidence 链的边界契约：每条要点自带 url/title，parse+校验+降级三件套兜底
 *
 * 复用 Agent 类而非另写循环：证明编排层"三层选型"里的 ReAct 是真可复用的模块，
 * 子 agent = 同一个 Agent 类 + 收窄的工具白名单 + 结构化返回协议。
 */

// 只读检索域白名单：写操作/页面操作工具对 worker 不可见也不可执行——
// 子 agent 与审批闭环是两个不应混合的域（并发 worker 下审批语义与责任归属会糊掉）
const WORKER_TOOL_NAMES = ['web_search', 'fetch_url']
const DEFAULT_MAX_STEPS = 6

/**
 * 把 worker 的最终 JSON 归一化为父层 State 消费的形状（parse + 校验 + 降级）：
 * - points：{text,url,title} 三元组，文本去重；裸字符串降级为无来源要点（verify 会如实标注）
 * - sources：实际读取过的页面（points 带来源但 sources 漏记的 URL 兜底并入）
 * - sufficient 必须有要点背书，防"声称充分但零产出"
 * @param {object|null} raw - parseJSON 后的 worker 输出
 * @param {string} fallbackGap - 解析失败/输出不合规时的 gap 说明
 */
function normalizeWorkerResult(raw, fallbackGap) {
  if (!raw || typeof raw !== 'object') {
    return { sufficient: false, points: [], gap: fallbackGap, sources: [], failures: [] }
  }
  const points = []
  const seenTexts = new Set()
  for (const p of Array.isArray(raw.points) ? raw.points : []) {
    if (!p) continue
    const text = (typeof p === 'string' ? p : String(p.text || '')).trim()
    if (!text) continue
    const key = text.slice(0, 60)
    if (seenTexts.has(key)) continue
    seenTexts.add(key)
    const url = typeof p === 'object' ? String(p.url || '').trim() : ''
    const title = typeof p === 'object' ? String(p.title || '').trim() : ''
    points.push({
      text: text.slice(0, 200),
      url: url.slice(0, 500),
      title: title.slice(0, 200),
    })
  }
  const sources = []
  const seenUrls = new Set()
  for (const s of Array.isArray(raw.sources) ? raw.sources : []) {
    const url = String(s?.url || '').trim()
    if (!url || seenUrls.has(url)) continue
    seenUrls.add(url)
    sources.push({
      url: url.slice(0, 500),
      title: String(s?.title || url).slice(0, 200),
      truncated: s?.truncated === true,
    })
  }
  for (const p of points) {
    if (p.url && !seenUrls.has(p.url)) {
      seenUrls.add(p.url)
      sources.push({ url: p.url, title: p.title || p.url, truncated: false })
    }
  }
  const failures = (Array.isArray(raw.failures) ? raw.failures : [])
    .map((f) => ({
      url: String(f?.url || '').slice(0, 300),
      reason: String(f?.reason || '').slice(0, 200),
    }))
    .filter((f) => f.url)
  return {
    // "充分"必须有要点背书：worker 声称 sufficient 但零要点时按不充分处理
    sufficient: raw.sufficient === true && points.length > 0,
    points,
    gap: String(raw.gap || '').slice(0, 300),
    sources,
    failures,
  }
}

/**
 * 运行一个主题调研 worker
 * @param {object} topic - { question, fetchedUrls? }（fetchedUrls 用于重试时避免重复读取）
 * @param {object} opts
 * @param {object} opts.llmInstance - 复用工作流的 LLMClient（继承插件下发的模型配置）
 * @param {string} [opts.connectionId]
 * @param {AbortSignal} [opts.signal] - 父级取消信号（级联到 worker 的每次 LLM/工具调用）
 * @param {number} [opts.maxSteps] - ReAct 轮次硬上限（兜底强制收敛，防无限循环）
 * @param {string} [opts.gapHint] - 重试轮传入上一轮的信息缺口，worker 优先补齐
 * @param {Function} [opts.onStep] - dph-A Step 事件透传（父层据此渲染 worker 的 DAG 节点）
 * @returns {Promise<{sufficient,points,gap,sources,failures,meta}>}
 */
async function runTopicAgent(topic, opts = {}) {
  const {
    llmInstance,
    connectionId,
    signal,
    maxSteps = DEFAULT_MAX_STEPS,
    gapHint = '',
    onStep,
  } = opts

  const workerTools = tools.filter((t) => WORKER_TOOL_NAMES.includes(t.name))
  const agent = new Agent({ llmInstance })

  const excludeHint = (topic.fetchedUrls || []).length
    ? `\n\n已读取过的页面（除非必要不要重复读取）：\n${topic.fetchedUrls
        .slice(0, 10)
        .map((u) => `- ${u}`)
        .join('\n')}`
    : ''
  const retryHint = gapHint
    ? `\n\n上一轮调研的信息缺口：${gapHint}\n请换角度检索与阅读，优先补齐上述缺口。`
    : ''
  const prompt = `研究子问题：${topic.question}${retryHint}${excludeHint}`

  const result = await agent.process(prompt, {
    connectionId,
    signal,
    tools: workerTools,
    systemPrompt: RESEARCH_WORKER_PROMPT,
    maxIterations: maxSteps,
    onStep,
    agent: 'research-worker',
  })

  // parse + 校验 + 降级三件套：worker 最终输出必须归一化，坏输出不炸父层状态机
  const normalized = normalizeWorkerResult(parseJSON(result?.content), '调研结果无法解析')

  return {
    ...normalized,
    meta: {
      iterations: result?.iterations ?? 0,
      steps: result?.steps ?? 0,
      fallback: result?.fallback === true,
      agent: 'research-worker',
    },
  }
}

module.exports = { runTopicAgent, normalizeWorkerResult, WORKER_TOOL_NAMES, DEFAULT_MAX_STEPS }
