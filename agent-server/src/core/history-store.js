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
   * @returns {Promise<{messages: Array, compressed: number, strategy: string, cached: boolean}>}
   */
  async deriveView({ summarize, strategy, tokenBudget } = {}) {
    const s = STRATEGIES.includes(strategy) ? strategy : this.strategy
    const budget = Number.isFinite(tokenBudget) ? tokenBudget : this.tokenBudget

    if (s === 'no-compress' || !budget) {
      return { messages: [...this.raw], compressed: 0, strategy: s, cached: false }
    }

    const count = findCompressCount(this.raw, budget)
    if (count === null) {
      return { messages: [...this.raw], compressed: 0, strategy: s, cached: false }
    }

    if (s === 'truncate') {
      // 对照策略：无摘要直接丢最老的（保真度基准的基线）
      return { messages: this.raw.slice(count), compressed: count, strategy: s, cached: false }
    }

    // rolling-summary（默认）
    if (this._cache && count <= this._cache.prefixLen) {
      // 缓存命中：raw 只追加，已压缩前缀覆盖当前边界 → 直接复用摘要
      return {
        messages: [this._cache.summaryMsg, ...this.raw.slice(this._cache.prefixLen)],
        compressed: 0,
        strategy: s,
        cached: true,
      }
    }

    if (!summarize) {
      // 没有摘要函数时降级为不压缩，不影响主流程
      return { messages: [...this.raw], compressed: 0, strategy: s, cached: false }
    }

    const summary = await summarize(serializeMessages(this.raw.slice(0, count)))
    const summaryMsg = {
      role: 'system',
      content: `【早期对话摘要】（以下是较早轮次的压缩摘要，仅供背景参考；回答请以最近对话为准）\n${summary}`,
    }
    this._cache = { prefixLen: count, summaryMsg }
    return {
      messages: [summaryMsg, ...this.raw.slice(count)],
      compressed: count,
      strategy: s,
      cached: false,
    }
  }
}

module.exports = { HistoryStore, STRATEGIES }
