const config = require('../config/index.js')
const { SYSTEM_PROMPT } = require('../config/prompts.js')
const { getProvider } = require('./llm-providers.js')

/**
 * 大模型客户端：分级路由 + provider 委托
 *
 * 本类只负责两件事，协议细节（请求/流式解析/重试）全部在 llm-providers.js：
 * 1. 多模型抽象：持有 provider 适配器，上层只面向 chat/chatStream 接口编程
 * 2. 分级路由：每个调用点可标注 tier（light/reasoning），resolveTierConfig 按档位
 *    合并出该次请求实际生效的模型配置；未配置的档位自动回落主模型（优雅降级）
 */

class LLMClient {
  constructor(customConfig = {}) {
    const mergedConfig = { ...config.llm, ...customConfig }
    this.provider = getProvider(mergedConfig.provider)
    this.apiKey = mergedConfig.apiKey
    this.baseURL = mergedConfig.baseURL
    this.model = mergedConfig.model
    this.temperature = mergedConfig.temperature
    // 分级配置：{ light: { model, ... }, reasoning: { model, ... } }，字段缺省回落主配置
    this.tiers = mergedConfig.tiers || {}
  }

  /**
   * 运行时覆盖配置
   * 用于插件配置页下发的 llmConfig：Agent 实例在连接建立时就创建了，
   * 不能重新 new，只能就地更新；传空对象则保持当前配置不变
   * @param {object} customConfig - 已校验过的配置片段
   */
  applyConfig(customConfig = {}) {
    if (customConfig.apiKey) this.apiKey = customConfig.apiKey
    if (customConfig.baseURL) this.baseURL = customConfig.baseURL
    if (customConfig.model) this.model = customConfig.model
    // temperature 允许 0，必须用 isFinite 判断
    if (Number.isFinite(customConfig.temperature)) this.temperature = customConfig.temperature
    if (customConfig.tiers) this.tiers = { ...this.tiers, ...customConfig.tiers }
    if (customConfig.provider) this.provider = getProvider(customConfig.provider)
  }

  /**
   * 解析某个档位实际生效的模型配置（分级路由核心）
   * 档位未配置/未声明的字段逐级回落主配置：换便宜模型只需要配一个 model 名，
   * apiKey/baseURL 自动沿用；档位完全没配则该次调用就是主模型，零成本降级
   * @param {string} [tier] - 'light' | 'reasoning' | undefined（主模型）
   * @returns {object} 实际生效的 { apiKey, baseURL, model, temperature, provider }
   */
  resolveTierConfig(tier) {
    const base = {
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      model: this.model,
      temperature: this.temperature,
      provider: undefined,
    }
    const overrides = this.tiers?.[tier]
    if (!overrides) return base
    // 只合并显式配置的字段：config 里 model: undefined 的占位不能把主模型抹掉
    const resolved = { ...base }
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== undefined && value !== null && value !== '') resolved[key] = value
    }
    return resolved
  }

  /**
   * 调用大模型生成回复（非流式）
   * @param {Array} messages - 消息列表
   * @param {Array} tools - 可用的工具列表
   * @param {string} [systemPrompt] - 可选系统提示词（覆盖默认值，用于总结/翻译等专用动作）
   * @param {AbortSignal} [signal] - 取消信号
   * @param {object} [options] - { tier: 'light'|'reasoning' } 分级路由档位
   * @returns {Promise<object>} 大模型响应
   */
  async chat(messages, tools = [], systemPrompt, signal, options = {}) {
    const cfg = this.resolveTierConfig(options.tier)
    console.log(
      `[LLM] Calling model: ${cfg.model}${options.tier ? ` (tier: ${options.tier})` : ''}`
    )

    const body = this.buildBody(messages, tools, systemPrompt, false, cfg)
    return this.provider.chat(cfg, body, signal, { tier: options.tier })
  }

  /**
   * 流式调用大模型
   * 通过 SSE 增量接收内容，每收到一段文本回调 onToken
   * 同时支持 Function Calling：tool_calls 的 delta 按 index 增量拼装
   * 返回结构与 chat() 完全一致（role/content/tool_calls），调用方无需区分
   * @param {Array} messages - 对话消息列表
   * @param {Array} tools - 可用的工具列表
   * @param {string} [systemPrompt] - 可选系统提示词
   * @param {Function} [onToken] - 文本增量回调 (chunk: string) => void
   * @param {AbortSignal} [signal] - 取消信号（dph-A），abort 后立即中断并抛 AbortError
   * @param {object} [options] - { tier } 分级路由档位
   * @returns {Promise<object>} 完整消息（含累积的 content / tool_calls）
   */
  async chatStream(messages, tools = [], systemPrompt, onToken, signal, options = {}) {
    const cfg = this.resolveTierConfig(options.tier)
    console.log(
      `[LLM] Streaming model: ${cfg.model}${options.tier ? ` (tier: ${options.tier})` : ''}`
    )

    const body = this.buildBody(messages, tools, systemPrompt, true, cfg)
    return this.provider.chatStream(cfg, body, onToken, signal, { tier: options.tier })
  }

  /**
   * 构建请求体（chat / chatStream 共用）
   * @param {Array} messages - 对话消息
   * @param {Array} tools - 工具列表
   * @param {string} [systemPrompt] - 可选系统提示词
   * @param {boolean} stream - 是否流式
   * @param {object} [cfg] - 该次请求生效的模型配置（缺省用主配置）
   * @returns {object} 请求体
   */
  buildBody(messages, tools, systemPrompt, stream, cfg = this) {
    const augmentedMessages = [
      { role: 'system', content: systemPrompt || SYSTEM_PROMPT },
      ...messages,
    ]

    const body = {
      model: cfg.model,
      messages: augmentedMessages,
      temperature: cfg.temperature,
      stream,
    }

    if (tools.length > 0) {
      body.tools = tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      }))
      body.tool_choice = 'auto'
    }

    return body
  }
}

module.exports = { LLMClient }
