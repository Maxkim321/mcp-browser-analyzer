const { CONTEXT_SUMMARY_PROMPT } = require('../config/prompts.js')

/**
 * dph-C 上下文压缩管理（对标 DeepSeek Harness 上下文管理模块）
 *
 * 问题：长会话历史占满 context window，成本高、注意力被稀释。
 * 方案：token 预算 + 滚动摘要（冷热分层，对应技术笔记"冷热分层记忆"思想）：
 * - 热消息（最近的对话）保留全文，保证当前任务的推理质量
 * - 冷消息（早期对话）压缩成一条摘要，保住"关键背景"的同时省 token
 *
 * 分层职责：
 * - 纯函数（estimateTokens / findCompressCount / serializeMessages / compressHistory）
 *   可单测、可复现；LLM 摘要调用由 agent.js 注入，模块本身不感知模型
 */

/** 取一条消息的文本内容（content 可能是字符串或结构体） */
function contentOf(message) {
  if (!message) return ''
  return typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '')
}

/**
 * 估算单条文本的 token 数（启发式，够用于预算判断即可，不追求与真实 tokenizer 一致）
 * - 中文/全角字符按 1 字符 ≈ 1 token
 * - ASCII 按 4 字符 ≈ 1 token
 * @param {string} text - 文本
 * @returns {number} 估算 token 数
 */
function estimateTokens(text) {
  if (!text) return 0
  let tokens = 0
  for (const ch of String(text)) {
    tokens += ch.charCodeAt(0) > 127 ? 1 : 0.25
  }
  return Math.ceil(tokens)
}

/**
 * 估算整段消息列表的 token 数
 * @param {Array} messages - OpenAI 格式消息数组
 * @returns {number} 估算 token 数
 */
function estimateMessagesTokens(messages) {
  return (messages || []).reduce((sum, m) => sum + estimateTokens(contentOf(m)), 0)
}

/**
 * 计算需要压缩的历史前缀长度（前闭后开区间 [0, n)）
 * 规则：
 * 1. 总 token 未超预算 → 返回 null（无需压缩）
 * 2. 超预算 → 从尾部往回预留 keepRatio 比例的"热消息"全文，其余全部压缩
 * 3. 保底：至少压缩一半（防止单条超大消息导致永远压缩不动）
 * @param {Array} messages - 消息列表
 * @param {number} budget - token 预算
 * @param {number} keepRatio - 热消息保留比例（默认 0.6）
 * @returns {number|null} 需压缩的消息条数；null 表示无需压缩
 */
function findCompressCount(messages, budget, keepRatio = 0.6) {
  if (!Array.isArray(messages) || messages.length === 0) return null
  if (estimateMessagesTokens(messages) <= budget) return null

  // 从尾部往回预留热消息（最近对话全文）；至少保留最后一条（通常是当前提问）
  const keepBudget = Math.floor(budget * keepRatio)
  let acc = 0
  let keepCount = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = estimateTokens(contentOf(messages[i]))
    if (keepCount > 0 && acc + t > keepBudget) break
    acc += t
    keepCount++
  }
  const compressCount = messages.length - keepCount
  // 保底至少压缩一条（keepCount 已保证 ≤ len-1，此处防单条超大消息退化）
  return Math.max(compressCount, 1)
}

/**
 * 把待压缩的历史转成文本，供 LLM 总结
 * @param {Array} messages - 待压缩消息
 * @returns {string} 角色标注的对话文本
 */
function serializeMessages(messages) {
  return (messages || []).map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${contentOf(m)}`).join('\n\n')
}

/**
 * 滚动摘要压缩：把最老的 compressCount 条消息压缩成一条 system 摘要消息
 * @param {Array} messages - 完整消息列表
 * @param {number} budget - token 预算
 * @param {Function} summarize - 摘要函数：(text) => Promise<string>
 * @returns {Promise<{messages:Array, summary:string|null, compressed:number}>}
 *   compressed = 被压缩掉的条数；summary 为 null 表示无需压缩
 */
async function compressHistory(messages, budget, summarize) {
  const compressCount = findCompressCount(messages, budget)
  if (compressCount === null || compressCount <= 0) {
    return { messages, summary: null, compressed: 0 }
  }

  const compressPart = messages.slice(0, compressCount)
  const keepPart = messages.slice(compressCount)
  const summary = await summarize(serializeMessages(compressPart))

  // 摘要放最前：system 角色不受 user/assistant 交替规则约束
  const summaryMsg = {
    role: 'system',
    content: `【早期对话摘要】（以下是较早轮次的压缩摘要，仅供背景参考；回答请以最近对话为准）\n${summary}`,
  }
  return { messages: [summaryMsg, ...keepPart], summary, compressed: compressPart.length }
}

module.exports = {
  CONTEXT_SUMMARY_PROMPT,
  contentOf,
  estimateTokens,
  estimateMessagesTokens,
  findCompressCount,
  serializeMessages,
  compressHistory,
}
