const { LLMClient } = require('./llm.js')
const { tools, isWriteTool } = require('../tools/index.js')
const { handleToolCall } = require('../tools/handler.js')
const config = require('../config/index.js')
// dph-C 上下文管理（摘要提示词）/ dph-D 工具流水线 / 派生视图历史存储
const { CONTEXT_SUMMARY_PROMPT, estimateMessagesTokens } = require('./context-manager.js')
const { HistoryStore } = require('./history-store.js')
const { runToolPipeline } = require('./tool-pipeline.js')
const traceLog = require('./trace-log.js')
const { READ_WEB_TOOLS, scanInjection, wrapUntrusted, extractSource } = require('./injection-guard.js')

/**
 * AI Agent 编排器
 * 处理提示词、调用大模型、执行工具、返回结果
 */
class Agent {
  constructor(customConfig = {}) {
    this.config = { ...config.agent, ...customConfig }
    // LLM 实例可注入（深度研究子 agent 复用工作流的 LLMClient，继承插件下发的模型配置）
    this.llm = customConfig.llmInstance || new LLMClient({ ...config.llm, ...customConfig.llm })
    // dph-C 派生视图：raw 只追加不改写，发给 LLM 的 messages 按策略派生（见 history-store.js）
    this.store = new HistoryStore({
      rawLimit: this.config.rawLimit,
      strategy: this.config.compressStrategy,
      tokenBudget: this.config.tokenBudget,
    })
  }

  /** 兼容旧引用：外部读写 conversationHistory 即 store.raw（append-only，禁止原地压缩改写） */
  get conversationHistory() {
    return this.store.raw
  }

  set conversationHistory(v) {
    this.store.replace(v)
  }

  /**
   * 派生当前轮次的 LLM 视图（压缩策略在 store 内实现）
   * 摘要调用走 light 档：滚动摘要有损压缩，便宜模型足够
   * @returns {Promise<{messages: Array, compressed: number, cached: boolean}>}
   */
  async deriveView() {
    return this.store.deriveView({
      summarize: async (text) => {
        const reply = await this.llm.chat(
          [
            { role: 'system', content: CONTEXT_SUMMARY_PROMPT },
            { role: 'user', content: text },
          ],
          [],
          undefined,
          undefined,
          { tier: 'light' }
        )
        return reply?.content
      },
    })
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
    // 工具白名单（子 agent 能力收窄）：传入时 LLM 只看到这些工具，且执行层硬闸
    // allowedTools 同步生效（不依赖"提示词里没给"的自觉，硬约束写死在代码）
    const toolDefs = Array.isArray(options.tools) && options.tools.length > 0 ? options.tools : tools
    // P11：显式传数组（含空数组）都视为白名单——空数组 = 空 Set = 全部工具硬闸
    // （知识点补全等纯对话 action 不需要工具）；不传 = null = 不限制（主 agent 行为不变）。
    // 旧逻辑空数组会被误判成"不限制"，语义是个坑
    const allowedTools = Array.isArray(options.tools)
      ? new Set(options.tools.map((t) => t.name))
      : null
    let iteration = 0
    // 工具上下文在整个 process 生命周期内共享，避免每轮迭代被重置
    const toolContext = {
      connectionId: options.connectionId,
      sessionId: options.sessionId || null,
      todoWriteCount: 0,
      // dph-A 可取消：工具等待插件响应期间也能被 abort（与深度研究同一套取消机制）
      signal: options.signal,
      // P4 分级权限：权限检查支持按请求注入（ws-server 为每连接构造审批闭包）；
      // 未注入时回落构造时配置（现有测试/默认放行行为不变）
      permissionCheck: options.permissionCheck || this.config.permissionCheck,
      // 写动作预算计数器：获批一次 +1（approval.js 维护），单轮任务生命周期
      writeActionsUsed: 0,
      // P7 注入防御：本轮已检出的可疑来源（injection-guard 写入），写操作审批据此展示风险警告
      taintedSources: [],
      // 子 agent 执行层白名单硬闸（null = 不限制，主 agent 行为不变）
      allowedTools,
    }
    // dph-A Turn/Step 执行模型：step 计数器贯穿整个 Turn（一次用户请求 = 一个 Turn），
    // 每个 Step（LLM 推理 / 工具执行）都通过 onStep 下发事件，前端可观测；signal 支持取消
    let step = 0
    const emitStep = (payload) => {
      step++
      if (typeof options.onStep === 'function') {
        options.onStep({ step, iteration, ...payload })
      }
    }
    // P10 能力可见性：工具执行此前只发 running（"开始了"），永远看不到结局——
    // executeSingleTool 在管线返回/异常时经本回调补发 done 终态（放这里才能
    // 闭包到 emitStep；子 agent 未注入 onStep 时回调自动空转）
    toolContext.onToolDone = (info) => emitStep({ phase: 'tool', status: 'done', ...info })
    const isAborted = () => options.signal?.aborted === true
    const abortError = () => Object.assign(new Error('Agent cancelled'), { code: 'ABORTED' })

    while (iteration < maxIterations) {
      if (isAborted()) throw abortError()
      iteration++
      console.log(`[Agent] Iteration ${iteration}/${maxIterations}`)

      // dph-A 可观测：推理 Step 开始
      emitStep({ phase: 'reasoning', status: 'running' })

      // dph-C 上下文压缩：派生视图按策略生成（raw 只追加不改写，见 history-store.js）。
      // 摘要由 LLM 生成（非流式、light 档），失败降级为不压缩，不影响主流程。
      // 压缩真实发生时：Step 事件带 token 前后值（前端提示条），并落 trace-log（可观测）
      const { messages: view, compressed } = await this.deriveView()
      if (compressed > 0) {
        const tokensBefore = estimateMessagesTokens(this.store.raw)
        const tokensAfter = estimateMessagesTokens(view)
        emitStep({ phase: 'compress', status: 'success', compressed, tokensBefore, tokensAfter })
        traceLog.record({
          type: 'context_compressed',
          sessionId: options.sessionId || null,
          strategy: this.config.compressStrategy,
          compressed,
          tokensBefore,
          tokensAfter,
        })
        console.log(
          `[Agent] Context derived (${this.config.compressStrategy}): ${compressed} old messages → summary (${tokensBefore} → ${tokensAfter} tokens)`
        )
      }

      // 流式调用：工具轮 content 为空（不触发 onToken），最终文本轮实时推送增量
      // agent 归属标签：子 agent 的 usage 台账借此与主会话区分（per-worker 分账）
      const response = await this.llm.chatStream(
        view,
        toolDefs,
        options.systemPrompt,
        options.onToken,
        options.signal,
        { agent: options.agent }
      )

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
          // 档位 badge：最终文本轮实际生效的档位/模型（light 摘要调用发生在派生阶段，不影响归属）
          meta: { tier: this.llm.lastCall?.tier || 'main', model: this.llm.lastCall?.model || null },
        }
      }
    }

    // 兜底收敛：达到最大轮次后，禁用工具再请求一次，让模型直接输出最终结论
    // 避免”数据已采集成功但最后卡在工具循环”导致整体失败
    try {
      const { messages: fallbackView } = await this.deriveView()
      const forcedFinalResponse = await this.llm.chatStream(
        [
          ...fallbackView,
          {
            role: 'user',
            content:
              '请基于已有工具结果直接输出最终结论，不要再调用任何工具。若数据不足请明确说明不足点。',
          },
        ],
        [],
        options.systemPrompt,
        options.onToken,
        options.signal
      )

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

    // 子 agent 执行层硬闸：白名单外的工具一律跳过（结果回喂 LLM 可自纠），
    // 即使模型幻觉出白名单外的工具名也不会真实执行——不依赖提示词自觉
    if (context.allowedTools && !context.allowedTools.has(toolName)) {
      this.conversationHistory.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: `Skipped: tool ${toolName} is not allowed for this task.`,
      })
      this.trimHistory()
      console.log(`[Agent] Blocked tool (not in allowedTools): ${toolName}`)
      return
    }

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

    // dph-D 工具执行流水线：权限校验（读放行/写审批）→ 超时控制 → 执行，统一收口
    const t0 = Date.now()
    try {
      const result = await runToolPipeline({
        toolName,
        args: toolArgs,
        context,
        timeoutMs: this.config.toolTimeout,
        permissionCheck: context.permissionCheck ?? this.config.permissionCheck,
        run: (args, ctx) => handleToolCall(toolName, args, ctx),
      })
      // P4 审计：写动作真实执行留痕（审批决策由 approval.js 落痕，这里只记真实执行）；
      // 被拒/dry-run 不是执行——拒绝的审计在 write_approval_result，dry-run 无副作用
      if (isWriteTool(toolName) && !result.permissionDenied && !result.dryRun) {
        traceLog.record({
          type: 'write_action_executed',
          sessionId: context.sessionId || null,
          tool: toolName,
          ok: true,
          dryRun: false,
          durationMs: Date.now() - t0,
        })
      }
      // P10 能力可见性：完成态事件——被拒/dry-run/真实执行都是"结局"，
      // 前端轨迹据此从"调用中"收敛到终态（写操作另有审批卡兜底）
      context.onToolDone?.({
        tool: toolName,
        ok: true,
        outcome: result.permissionDenied ? 'denied' : result.dryRun ? 'dry-run' : 'executed',
        dangerLevel: tools.find((t) => t.name === toolName)?.dangerLevel || 'read',
        durationMs: Date.now() - t0,
      })

      // P7 注入防御：不可信网页内容 → 分隔包装（layer 1）+ 注入模式扫描染色（layer 2）。
      // 检测不阻断（启发式有误报）：写操作反正逐次人审，检测的价值是把"上下文可疑"
      // 亮到审批卡片与审计上。worker（只读）同样被扫——研究投毒的防线之一。
      if (!result.permissionDenied && !result.dryRun && READ_WEB_TOOLS.includes(toolName)) {
        const rawText = result?.content?.[0]?.text
        if (typeof rawText === 'string' && rawText) {
          const scan = scanInjection(rawText)
          if (scan.suspicious) {
            context.taintedSources.push({
              tool: toolName,
              patterns: scan.matches.map((m) => m.id),
              snippet: scan.matches[0]?.snippet || '',
            })
            traceLog.record({
              type: 'taint_detected',
              sessionId: context.sessionId || null,
              tool: toolName,
              patterns: scan.matches.map((m) => m.id),
              snippet: scan.matches[0]?.snippet || '',
            })
          }
          result.content[0].text = wrapUntrusted(rawText, {
            source: extractSource(rawText, toolName),
            scan,
          })
        }
      }

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
      if (isWriteTool(toolName)) {
        traceLog.record({
          type: 'write_action_executed',
          sessionId: context.sessionId || null,
          tool: toolName,
          ok: false,
          dryRun: false,
          error: error.message,
        })
      }
      // P10 能力可见性：异常（超时/工具抛错）也要给轨迹一个终态，不能永远"调用中"
      context.onToolDone?.({
        tool: toolName,
        ok: false,
        outcome: 'error',
        dangerLevel: tools.find((t) => t.name === toolName)?.dangerLevel || 'read',
        durationMs: Date.now() - t0,
      })
      this.conversationHistory.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: `Error: ${error.message}`,
      })
      this.trimHistory()
    }
  }

  /**
   * raw 内存上限裁剪（委托 store）：起点对齐 tool 组，避免孤儿 tool 消息；
   * 与派生视图的 token 预算压缩是两层独立约束——raw 管内存，视图管上下文窗口
   */
  trimHistory() {
    if (Number.isFinite(this.config.rawLimit)) this.store.rawLimit = this.config.rawLimit
    this.store.trimRaw()
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
      .filter(
        (m) =>
          m &&
          (m.role === 'user' || m.role === 'assistant') &&
          typeof m.content === 'string' &&
          m.content.trim()
      )
      .map((m) => ({ role: m.role, content: m.content.trim() }))
    if (clean.length === 0) return 0
    this.conversationHistory = clean
    this.trimHistory()
    console.log(
      `[Agent] Restored ${clean.length} history messages (kept ${this.conversationHistory.length})`
    )
    return clean.length
  }
}

module.exports = { Agent }
