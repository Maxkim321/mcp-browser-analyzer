const { findCompressCount, serializeMessages } = require('./context-manager.js')

/**
 * 历史存储（dph-C 升级：派生视图）
 *
 * 旧模型的两个问题：
 * 1. 压缩"原地改写"conversationHistory——切坏了不可恢复（见 tool-boundary 故障复盘），
 *    且"模型当时看到了什么"无法复盘；
 * 2. 压缩策略焊死在 agent.js 里，无法替换/对比。
 *
 * 新模型对齐 dsh"日志是唯一真相源"的思想：
 * - raw 只追加、永不改写（append-only），是唯一真相源；
 * - 发给 LLM 的 messages 是每次按策略【派生】出来的视图（deriveView 纯计算 + 摘要缓存）；
 * - 压缩策略可插拔：no-compress / rolling-summary / truncate，配合保真度基准做数字选型。
 *
 * 不变量（两处出口共同维护）：
 * - raw 头部裁剪不得以孤儿 tool 消息开头（与 context-manager 压缩边界同一纪律）
 * - 派生视图的第一条真实消息不得是 tool（否则 DeepSeek 400）
 */

const STRATEGIES = ['no-compress', 'rolling-summary', 'truncate']

class HistoryStore {
  /**
   * @param {object} opts
   * @param {number} [opts.rawLimit=200] - raw 内存上限（条数），超过做头部对齐裁剪
   * @param {string} [opts.strategy='rolling-summary'] - 压缩策略
   * @param {number} [opts.tokenBudget=0] - 视图 token 预算（0 = 不压缩）
   */
  constructor({ rawLimit = 200, strategy = 'rolling-summary', tokenBudget = 0 } = {}) {
    this.raw = []
    this.rawLimit = rawLimit
    this.strategy = STRATEGIES.includes(strategy) ? strategy : 'rolling-summary'
    this.tokenBudget = Number(tokenBudget) || 0
    this._cache = null // { prefixLen, summaryMsg }：raw 只追加 → 已压缩前缀稳定可复用
  }

  /** 唯一写入口：追加消息（自动做 raw 上限裁剪） */
  append(...msgs) {
    for (const m of msgs) {
      if (m) this.raw.push(m)
    }
    this.trimRaw()
  }

  /** 测试/恢复场景的整体替换：重建 raw 并使缓存失效 */
  replace(messages) {
    this.raw = Array.isArray(messages) ? messages.slice() : []
    this._cache = null
  }

  /**
   * raw 头部裁剪：起点不能落在 tool 消息上（孤儿 tool 会让下一次 LLM 调用 400）
   * 裁剪会改变 raw 前缀 → 压缩缓存失效
   */
  trimRaw() {
    if (this.rawLimit > 0 && this.raw.length > this.rawLimit) {
      let start = this.raw.length - this.rawLimit
      while (start < this.raw.length && this.raw[start] && this.raw[start].role === 'tool') {
        start++
      }
      if (start > 0) {
        this.raw = this.raw.slice(start)
        this._cache = null
      }
    }
  }

  /**
   * 派生视图：按策略把 raw 变成"这一轮发给 LLM 的 messages"
   * @param {object} [opts]
   * @param {Function} [opts.summarize] - 摘要函数 (text) => Promise<string>（rolling-summary 必需）
   * @param {string} [opts.strategy] - 临时覆盖构造时的策略（基准对比用）
   * @param {number} [opts.tokenBudget] - 临时覆盖预算
   * @returns {Promise<{messages: Array, compressed: number, strategy: string, cached: boolean, anchor: string|null}>}
   */
  async deriveView({ summarize, strategy, tokenBudget } = {}) {
    const s = STRATEGIES.includes(strategy) ? strategy : this.strategy
    const budget = Number.isFinite(tokenBudget) ? tokenBudget : this.tokenBudget

    if (s === 'no-compress' || !budget) {
      return { messages: [...this.raw], compressed: 0, strategy: s, cached: false, anchor: null }
    }

    const count = findCompressCount(this.raw, budget)
    if (count === null) {
      return { messages: [...this.raw], compressed: 0, strategy: s, cached: false, anchor: null }
    }

    // P13 任务锚定：当前任务 = 最后一条 user 消息。若它落在被压缩/丢弃的前缀里，
    // 把原文从摘要中"捞出"原样回插（摘要有损，任务被摘要化后 agent 会在长流程中段
    // 偏离目标——自动投递 15-20 轮工具调用必触发）；任务消息很小，全文保留几乎零成本。
    // 任务已留在尾部时改用末尾锚点重申（对抗注意力稀释）。两者互斥，避免任务文本
    // 在视图里出现两遍
    const taskIdx = this.lastUserIndex()

    if (s === 'truncate') {
      // 对照策略：无摘要直接丢最老的（保真度基准的基线）；任务保持与 rolling-summary
      // 同等强度（回插/锚点），策略对比时"摘要 vs 直接丢"的变量才被隔离
      const pinned = taskIdx >= 0 && taskIdx < count ? { ...this.raw[taskIdx] } : null
      const anchor = pinned ? null : this.taskAnchor()
      const messages = [...(pinned ? [pinned] : []), ...this.raw.slice(count)]
      if (anchor) messages.push({ role: 'user', content: anchor })
      return { messages, compressed: count, strategy: s, cached: false, anchor }
    }

    // rolling-summary（默认）
    if (this._cache && count <= this._cache.prefixLen) {
      // 缓存命中：raw 只追加，已压缩前缀覆盖当前边界 → 直接复用摘要；
      // 回插/锚点按缓存前缀边界重新计算（任务落在缓存前缀内同样要捞回）
      const p = this._cache.prefixLen
      const pinned = taskIdx >= 0 && taskIdx < p ? { ...this.raw[taskIdx] } : null
      const anchor = pinned ? null : this.taskAnchor()
      const messages = [this._cache.summaryMsg, ...(pinned ? [pinned] : []), ...this.raw.slice(p)]
      if (anchor) messages.push({ role: 'user', content: anchor })
      return { messages, compressed: 0, strategy: s, cached: true, anchor }
    }

    if (!summarize) {
      // 没有摘要函数时降级为不压缩，不影响主流程
      return { messages: [...this.raw], compressed: 0, strategy: s, cached: false, anchor: null }
    }

    const summary = await summarize(serializeMessages(this.raw.slice(0, count)))
    const summaryMsg = {
      role: 'system',
      content: `【早期对话摘要】（以下是较早轮次的压缩摘要，仅供背景参考；回答请以最近对话为准）\n${summary}`,
    }
    this._cache = { prefixLen: count, summaryMsg }
    const pinned = taskIdx >= 0 && taskIdx < count ? { ...this.raw[taskIdx] } : null
    const anchor = pinned ? null : this.taskAnchor()
    const messages = [summaryMsg, ...(pinned ? [pinned] : []), ...this.raw.slice(count)]
    if (anchor) messages.push({ role: 'user', content: anchor })
    return { messages, compressed: count, strategy: s, cached: false, anchor }
  }

  /** 最后一条 user 消息的下标（找不到返回 -1） */
  lastUserIndex() {
    for (let i = this.raw.length - 1; i >= 0; i--) {
      if (this.raw[i] && this.raw[i].role === 'user') return i
    }
    return -1
  }

  /**
   * P13 任务锚点文本：取最后一条 user 消息（当前任务）截断重述。
   * 仅在压缩前缀存在时由 deriveView 返回，调用方附加到视图末尾
   */
  taskAnchor() {
    for (let i = this.raw.length - 1; i >= 0; i--) {
      const m = this.raw[i]
      if (m && m.role === 'user' && typeof m.content === 'string' && m.content.trim()) {
        return (
          `【任务锚点·自动注入】当前任务目标：${m.content.trim().slice(0, 500)}\n` +
          '请始终对齐该目标执行：已完成的步骤不要重复执行；任务已全部完成时直接输出最终结论，不要继续调用工具。'
        )
      }
    }
    return null
  }
}

module.exports = { HistoryStore, STRATEGIES }
