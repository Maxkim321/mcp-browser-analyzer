const config = require('./config.js')

/**
 * 大模型集成模块
 * 支持调用 OpenAI/Anthropic 等大模型 API
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
   * @param {Array} messages - 对话消息列表
   * @param {Array} tools - 可用的工具列表
   * @returns {Promise<object>} 大模型响应
   */
  async chat(messages, tools = []) {
    console.log(`[LLM] Calling model: ${this.model}`)

    const body = {
      model: this.model,
      messages,
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
