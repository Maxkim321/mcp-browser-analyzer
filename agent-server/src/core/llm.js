const config = require('../config/index.js')
const { SYSTEM_PROMPT } = require('../config/prompts.js')

/**
 * 大模型集成模块
 * 支持调用 OpenAI/Anthropic 等大模型 API
 * 自动在每次请求前添加系统提示词，指导Agent行为
 */

class LLMClient {
  constructor(customConfig = {}) {
    const mergedConfig = { ...config.llm, ...customConfig }
    this.apiKey = mergedConfig.apiKey
    this.baseURL = mergedConfig.baseURL
    this.model = mergedConfig.model
    this.temperature = mergedConfig.temperature
  }

  /**
   * 调用大模型生成回复
   * 自动在消息列表开头添加系统提示词
   * @param {Array} messages - 对话消息列表
   * @param {Array} tools - 可用的工具列表
   * @param {string} [systemPrompt] - 可选的系统提示词，覆盖默认值（用于总结/翻译等专用动作）
   * @returns {Promise<object>} 大模型响应
   */
  async chat(messages, tools = [], systemPrompt) {
    console.log(`[LLM] Calling model: ${this.model}`)

    const body = this.buildBody(messages, tools, systemPrompt, false)

    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`LLM API error: ${response.status} - ${error}`)
      }

      const data = await response.json()
      const result = data.choices[0].message
      console.log(`[LLM] Response received`)
      return result
    } catch (error) {
      console.error('[LLM] Error:', error)
      throw error
    }
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
   * @param {AbortSignal} [signal] - 取消信号（dph-A 可观测/可取消），abort 后立即中断并抛 AbortError
   * @returns {Promise<object>} 完整消息（含累积的 content / tool_calls）
   */
  async chatStream(messages, tools = [], systemPrompt, onToken, signal) {
    console.log(`[LLM] Streaming model: ${this.model}`)

    const body = this.buildBody(messages, tools, systemPrompt, true)

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`LLM API error: ${response.status} - ${error}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    // tool_calls 按 index 累积：流式接口会分多次返回同一 index 的增量
    const toolCalls = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE 按行分割，最后一行可能不完整，保留到下一轮
      const lines = buffer.split('\n')
      buffer = lines.pop()

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (!data || data === '[DONE]') continue

        try {
          const chunk = JSON.parse(data)
          const delta = chunk.choices?.[0]?.delta || {}
          if (delta.content) {
            content += delta.content
            onToken?.(delta.content)
          }
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const index = tc.index ?? 0
              toolCalls[index] = toolCalls[index] || {
                index,
                id: '',
                type: 'function',
                function: { name: '', arguments: '' },
              }
              if (tc.id) toolCalls[index].id = tc.id
              if (tc.type) toolCalls[index].type = tc.type
              if (tc.function?.name) toolCalls[index].function.name += tc.function.name
              if (tc.function?.arguments) toolCalls[index].function.arguments += tc.function.arguments
            }
          }
        } catch (error) {
          console.warn('[LLM] SSE parse chunk failed:', error.message)
        }
      }
    }

    console.log(`[LLM] Stream finished, content chars: ${content.length}, tool_calls: ${toolCalls.length}`)

    const message = { role: 'assistant', content }
    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.function.name, arguments: tc.function.arguments },
      }))
    }
    return message
  }

  /**
   * 构建请求体（chat / chatStream 共用）
   * @param {Array} messages - 对话消息
   * @param {Array} tools - 工具列表
   * @param {string} [systemPrompt] - 可选系统提示词
   * @param {boolean} stream - 是否流式
   * @returns {object} 请求体
   */
  buildBody(messages, tools, systemPrompt, stream) {
    const augmentedMessages = [
      { role: 'system', content: systemPrompt || SYSTEM_PROMPT },
      ...messages,
    ]

    const body = {
      model: this.model,
      messages: augmentedMessages,
      temperature: this.temperature,
      stream,
    }

    if (tools.length > 0) {
      //把tools喂给LLM理解的格式
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
