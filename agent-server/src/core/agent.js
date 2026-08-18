const { LLMClient } = require('./llm.js')
const { tools } = require('../tools/index.js')
const { handleToolCall } = require('../tools/handler.js')
const config = require('../config/index.js')
// dph-C 上下文压缩 / dph-D 工具流水线
const { CONTEXT_SUMMARY_PROMPT, findCompressCount, compressHistory } = require('./context-manager.js')
const { runToolPipeline } = require('./tool-pipeline.js')

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
    if (typeof prompt !== 'string' || !prompt.trim()) {
      return {
        success: false,
        error: 'Invalid prompt',
        content: '请输入有效的问题内容。',
      }
    }

    this.conversationHistory.push({
      role: 'user',
      content: prompt.trim(),
    })
    this.trimHistory()

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
    // 工具上下文在整个 process 生命周期内共享，避免每轮迭代被重置
    const toolContext = { connectionId: options.connectionId, todoWriteCount: 0 }
    // dph-A Turn/Step 执行模型：step 计数器贯穿整个 Turn（一次用户请求 = 一个 Turn），
    // 每个 Step（LLM 推理 / 工具执行）都通过 onStep 下发事件，前端可观测；signal 支持取消
    let step = 0
    const emitStep = (payload) => {
      step++
      if (typeof options.onStep === 'function') {
        options.onStep({ step, iteration, ...payload })
      }
    }
    const isAborted = () => options.signal?.aborted === true
    const abortError = () => Object.assign(new Error('Agent cancelled'), { code: 'ABORTED' })

    while (iteration < maxIterations) {
      if (isAborted()) throw abortError()
      iteration++
      console.log(`[Agent] Iteration ${iteration}/${maxIterations}`)

      // dph-A 可观测：推理 Step 开始
      emitStep({ phase: 'reasoning', status: 'running' })

      // dph-C 上下文压缩：每次推理前检查 token 预算，超出则把早期消息滚动摘要压缩。
      // 摘要由 LLM 生成（非流式），失败降级为不压缩，不影响主流程
      if (this.config.tokenBudget) {
        const compressCount = findCompressCount(this.conversationHistory, this.config.tokenBudget)
        if (compressCount !== null) {
          try {
            const result = await compressHistory(this.conversationHistory, this.config.tokenBudget, async (text) => {
              const reply = await this.llm.chat([
                { role: 'system', content: CONTEXT_SUMMARY_PROMPT },
                { role: 'user', content: text },
              ])
              return reply?.content
            })
            this.conversationHistory = result.messages
            emitStep({ phase: 'compress', status: 'success', compressed: result.compressed })
            console.log(`[Agent] Context compressed: ${result.compressed} old messages → summary`)
          } catch (compressError) {
            console.error('[Agent] Context compression failed, keep raw history:', compressError)
          }
        }
      }

      // 流式调用：工具轮 content 为空（不触发 onToken），最终文本轮实时推送增量
      const response = await this.llm.chatStream(this.conversationHistory, tools, options.systemPrompt, options.onToken, options.signal)

      //需要工具 - 工具调用检测
      if (response.tool_calls && response.tool_calls.length > 0) {
        this.conversationHistory.push(response)

        const toolCalls = response.tool_calls
        console.log(`[Agent] Tool calls requested: ${toolCalls.length}`)

        // dph-A 可观测：工具执行 Step
        for (const tc of toolCalls) {
          emitStep({ phase: 'tool', status: 'running', tool: tc.function?.name })
        }

        if (toolCalls.length > 1 && this.config.parallelToolCalls > 1) {
          //并行执行
          await this.executeParallelTools(toolCalls, toolContext)
        } else {
          //顺序执行
          await this.executeSequentialTools(toolCalls, toolContext)
        }
        // 工具执行完成后回到循环顶部发起下一轮推理
        continue
      } else {
        this.conversationHistory.push(response)
        this.trimHistory()
        console.log(`[Agent] Final response:`, response.content)
        // dph-A 可观测：完成 Step
        emitStep({ phase: 'done', status: 'success' })
        return {
          success: true,
          content: response.content,
          conversation: this.conversationHistory,
          iterations: iteration,
          steps: step,
        }
      }
    }

    // 兜底收敛：达到最大轮次后，禁用工具再请求一次，让模型直接输出最终结论
    // 避免“数据已采集成功但最后卡在工具循环”导致整体失败
    try {
      const forcedFinalResponse = await this.llm.chatStream([
        ...this.conversationHistory,
        {
          role: 'user',
          content: '请基于已有工具结果直接输出最终结论，不要再调用任何工具。若数据不足请明确说明不足点。',
        },
      ], [], options.systemPrompt, options.onToken, options.signal)

      if (forcedFinalResponse?.content) {
        this.conversationHistory.push(forcedFinalResponse)
        this.trimHistory()
        console.log('[Agent] Fallback final response:', forcedFinalResponse.content)
        return {
          success: true,
          content: forcedFinalResponse.content,
          conversation: this.conversationHistory,
          iterations: maxIterations,
          fallback: true,
        }
      }
    } catch (fallbackError) {
      console.error('[Agent] Fallback finalization failed:', fallbackError)
    }

    return {
      success: false,
      error: 'Max iterations reached',
      content: '抱歉，已达到最大推理轮次，当前任务未完整收敛。可重试或简化请求。',
      iterations: maxIterations,
    }
  }

  /**
   * 顺序执行工具调用
   * @param {Array} toolCalls - 工具调用列表
   */
  async executeSequentialTools(toolCalls, context = {}) {
    for (const toolCall of toolCalls) {
      await this.executeSingleTool(toolCall, context)
    }
  }

  /**
   * 并行执行工具调用
   * @param {Array} toolCalls - 工具调用列表
   */
  async executeParallelTools(toolCalls, context = {}) {
    const batchSize = this.config.parallelToolCalls
    for (let i = 0; i < toolCalls.length; i += batchSize) {
      const batch = toolCalls.slice(i, i + batchSize)
      console.log(`[Agent] Executing batch ${Math.floor(i / batchSize) + 1}, size: ${batch.length}`)
      await Promise.all(batch.map((toolCall) => this.executeSingleTool(toolCall, context)))
    }
  }

  /**
   * 执行单个工具调用
   * @param {object} toolCall - 单个工具调用
   */
  async executeSingleTool(toolCall, context = {}) {
    const toolName = toolCall.function.name
    let toolArgs = {}
    try {
      toolArgs = JSON.parse(toolCall.function.arguments || '{}')
    } catch {
      // 工具参数解析失败时向 LLM 返回明确错误，避免陷入无效重试
      this.conversationHistory.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: `Error: Invalid JSON arguments for tool ${toolName}`,
      })
      this.trimHistory()
      return
    }

    console.log(`[Agent] Calling tool: ${toolName}`, toolArgs)

    // 限制 todo_write 在单次任务中最多执行一次，避免模型陷入反复更新任务列表
    if (toolName === 'todo_write') {
      if ((context.todoWriteCount || 0) >= 1) {
        this.conversationHistory.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: 'Skipped: todo_write can only be called once per request.',
        })
        this.trimHistory()
        console.log('[Agent] Skipped tool: todo_write (already called once)')
        return
      }
      context.todoWriteCount = (context.todoWriteCount || 0) + 1
    }

    // dph-D 工具执行流水线：权限校验（写操作预留）→ 超时控制 → 执行，统一收口
    try {
      const result = await runToolPipeline({
        toolName,
        args: toolArgs,
        context,
        timeoutMs: this.config.toolTimeout,
        permissionCheck: this.config.permissionCheck,
        run: (args, ctx) => handleToolCall(toolName, args, ctx),
      })
      const toolResult = {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result.content[0].text,
      }
      this.conversationHistory.push(toolResult)
      this.trimHistory()
      console.log(`[Agent] Tool result:`, result)
    } catch (error) {
      console.error(`[Agent] Tool error:`, error)
      this.conversationHistory.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: `Error: ${error.message}`,
      })
      this.trimHistory()
    }
  }

  /**
   * 裁剪历史消息，保留最近 N 条，限制内存增长
   */
  trimHistory() {
    const historyLimit = this.config.historyLimit
    if (typeof historyLimit === 'number' && historyLimit > 0 && this.conversationHistory.length > historyLimit) {
      this.conversationHistory = this.conversationHistory.slice(-historyLimit)
    }
  }

  /**
   * 判断当前 Agent 是否没有历史上下文（dph-B 事件溯源断点续跑用）
   * @returns {boolean} true 表示内存历史为空
   */
  isEmptyHistory() {
    return !Array.isArray(this.conversationHistory) || this.conversationHistory.length === 0
  }

  /**
   * 清空对话历史
   */
  clearHistory() {
    this.conversationHistory = []
    console.log('[Agent] Conversation history cleared')
  }

  /**
   * 恢复对话历史（F4 会话持久化）
   * 插件侧重连 WS 时，服务端已创建全新 Agent（内存历史为空），
   * 由插件把 chrome.storage.local 持久化的历史重放过来重建上下文。
   * @param {Array} history - OpenAI 格式消息数组 [{role:'user'|'assistant', content}]
   * @returns {number} 恢复的消息条数
   */
  restoreHistory(history) {
    if (!Array.isArray(history) || history.length === 0) {
      console.log('[Agent] restoreHistory skipped: empty history')
      return 0
    }
    const clean = history
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .map((m) => ({ role: m.role, content: m.content.trim() }))
    if (clean.length === 0) return 0
    this.conversationHistory = clean
    this.trimHistory()
    console.log(`[Agent] Restored ${clean.length} history messages (kept ${this.conversationHistory.length})`)
    return clean.length
  }
}

module.exports = { Agent }
