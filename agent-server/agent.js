const { LLMClient } = require('./llm.js')
const { tools } = require('./tools.js')
const { handleToolCall } = require('./tool-handler.js')
const config = require('./config.js')

/**
 * AI Agent 编排器
 * 处理提示词、调用大模型、执行工具、返回结果
 */
class Agent {
  constructor(customConfig = {}) {
    this.config = { ...config.agent, ...customConfig }
    this.llm = new LLMClient({ ...config.llm, ...customConfig.llm })
    this.conversationHistory = []
  }

  /**
   * 处理用户提示词
   * @param {string} prompt - 用户提示词
   * @param {object} options - 配置选项
   * @returns {Promise<object>} 最终结果
   */
  async process(prompt, options = {}) {
    this.conversationHistory.push({
      role: 'user',
      content: prompt,
    })

    const maxIterations = options.maxIterations || this.config.maxIterations
    let iteration = 0

    while (iteration < maxIterations) {
      iteration++
      console.log(`[Agent] Iteration ${iteration}/${maxIterations}`)

      const response = await this.llm.chat(this.conversationHistory, tools)

      if (response.tool_calls && response.tool_calls.length > 0) {
        this.conversationHistory.push(response)

        const toolCalls = response.tool_calls
        console.log(`[Agent] Tool calls requested: ${toolCalls.length}`)

        if (toolCalls.length > 1 && this.config.parallelToolCalls > 1) {
          await this.executeParallelTools(toolCalls)
        } else {
          await this.executeSequentialTools(toolCalls)
        }
      } else {
        this.conversationHistory.push(response)
        console.log(`[Agent] Final response:`, response.content)
        return {
          success: true,
          content: response.content,
          conversation: this.conversationHistory,
          iterations: iteration,
        }
      }
    }

    return {
      success: false,
      error: 'Max iterations reached',
      content: '抱歉，我无法完成这个任务，请尝试更简单的请求。',
      iterations: maxIterations,
    }
  }

  /**
   * 顺序执行工具调用
   * @param {Array} toolCalls - 工具调用列表
   */
  async executeSequentialTools(toolCalls) {
    for (const toolCall of toolCalls) {
      await this.executeSingleTool(toolCall)
    }
  }

  /**
   * 并行执行工具调用
   * @param {Array} toolCalls - 工具调用列表
   */
  async executeParallelTools(toolCalls) {
    const batchSize = this.config.parallelToolCalls
    for (let i = 0; i < toolCalls.length; i += batchSize) {
      const batch = toolCalls.slice(i, i + batchSize)
      console.log(`[Agent] Executing batch ${Math.floor(i / batchSize) + 1}, size: ${batch.length}`)
      await Promise.all(batch.map((toolCall) => this.executeSingleTool(toolCall)))
    }
  }

  /**
   * 执行单个工具调用
   * @param {object} toolCall - 单个工具调用
   */
  async executeSingleTool(toolCall) {
    const toolName = toolCall.function.name
    const toolArgs = JSON.parse(toolCall.function.arguments || '{}')

    console.log(`[Agent] Calling tool: ${toolName}`, toolArgs)

    try {
      const result = await handleToolCall(toolName, toolArgs)
      const toolResult = {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result.content[0].text,
      }
      this.conversationHistory.push(toolResult)
      console.log(`[Agent] Tool result:`, result)
    } catch (error) {
      console.error(`[Agent] Tool error:`, error)
      this.conversationHistory.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: `Error: ${error.message}`,
      })
    }
  }

  /**
   * 清空对话历史
   */
  clearHistory() {
    this.conversationHistory = []
    console.log('[Agent] Conversation history cleared')
  }
}

module.exports = { Agent }
