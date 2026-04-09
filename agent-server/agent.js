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

    //最大迭代次数
    /**
     * LLM迭代循环逻辑说明：
     *
     * 1. 初始化参数：从配置或选项中获取最大迭代次数，防止无限循环
     * 2. 循环调用LLM：每次迭代中调用大模型，传入当前对话历史和可用工具
     * 3. 判断响应类型：
     *    - 如果LLM返回tool_calls（工具调用请求），说明需要执行工具来获取更多信息
     *      * 将LLM的响应加入对话历史
     *      * 根据工具调用数量和配置决定并行或顺序执行工具
     *        · 并行执行：当工具调用数>1且配置允许并行时，按批次并行处理
     *        · 顺序执行：单个工具调用或配置不允许并行时，逐个执行
     *      * 工具执行结果会加入对话历史，继续下一轮迭代
     *    - 如果LLM返回普通文本响应（无工具调用），说明任务完成
     *      * 将响应加入对话历史，返回最终结果
     * 4. 循环终止条件：达到最大迭代次数时强制退出，返回错误信息
     *
     * 该机制实现了ReAct（Reasoning + Acting）模式：LLM通过推理决定调用哪些工具，
     * 工具执行结果反馈给LLM继续推理，直到得出最终答案。
     */
    const maxIterations = options.maxIterations || this.config.maxIterations
    let iteration = 0

    while (iteration < maxIterations) {
      iteration++
      console.log(`[Agent] Iteration ${iteration}/${maxIterations}`)

      const response = await this.llm.chat(this.conversationHistory, tools)

      //需要工具 - 工具调用检测
      if (response.tool_calls && response.tool_calls.length > 0) {
        this.conversationHistory.push(response)

        const toolCalls = response.tool_calls
        console.log(`[Agent] Tool calls requested: ${toolCalls.length}`)

        if (toolCalls.length > 1 && this.config.parallelToolCalls > 1) {
          //并行执行
          await this.executeParallelTools(toolCalls)
        } else {
          //顺序执行
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
