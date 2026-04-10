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
   * @returns {Promise<object>} 大模型响应
   */
  async chat(messages, tools = []) {
    console.log(`[LLM] Calling model: ${this.model}`)

    const augmentedMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages,
    ]

    const body = {
      model: this.model,
      messages: augmentedMessages,
      temperature: this.temperature,
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
}

module.exports = { LLMClient }
