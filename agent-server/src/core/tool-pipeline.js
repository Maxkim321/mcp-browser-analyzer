/**
 * dph-D 工具执行流水线（对标 DeepSeek Harness 工具执行模型）
 *
 * 问题：工具调用散落在 agent 循环里，权限、超时、错误处理各自为政，
 * 未来加写操作（Computer Use / 表单填写）时无处挂"审批"。
 * 方案：把"权限校验 → 超时控制 → 执行"统一成一条流水线：
 * - permissionCheck：前置权限 hook（当前全部工具只读，默认放行；写操作可注入审批/确认）
 * - timeoutMs：单工具超时（防止网络卡死拖垮整个 Turn）
 * - 超时以 code='TIMEOUT' 抛出，由 agent 层转成 tool 错误消息回喂 LLM
 *
 * 该模块不依赖任何运行时状态，纯函数可单测。
 */

const DEFAULT_TIMEOUT = 60000

/**
 * 超时包装：promise 超过 ms 未完成则 reject（code='TIMEOUT'）
 * @param {Promise} promise - 原始 promise
 * @param {number} ms - 超时毫秒
 * @param {string} message - 超时错误信息
 * @returns {Promise} 竞速结果
 */
function withTimeout(promise, ms, message) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(message), { code: 'TIMEOUT' })), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * 执行工具流水线
 * @param {object} opts
 * @param {string} opts.toolName - 工具名
 * @param {object} opts.args - 工具参数
 * @param {object} opts.context - 执行上下文（connectionId 等）
 * @param {Function} opts.run - 真正执行工具的函数：(args, context) => Promise<result>
 * @param {Function} [opts.permissionCheck] - 权限 hook：(toolName, args, context) => Promise<decision>
 *   decision 契约（P4 分级权限扩展，布尔值向后兼容）：
 *   - true：放行；false：拒绝（通用文案）
 *   - {allowed:true}：放行；{allowed:false, reason}：拒绝（文案带原因，回喂 LLM 可自纠）
 *   - {dryRun:true}：写动作只规划不执行（返回占位结果，run 不被调用）
 * @param {number} [opts.timeoutMs] - 超时毫秒，默认 DEFAULT_TIMEOUT
 * @returns {Promise<object>} 工具结果（权限拒绝时返回统一格式 {content:[{text}]}，与正常结果一致）
 * @throws {Error} 超时抛 code='TIMEOUT'；工具自身错误原样上抛
 */
async function runToolPipeline({
  toolName,
  args,
  context,
  run,
  permissionCheck,
  timeoutMs = DEFAULT_TIMEOUT,
}) {
  // 1. 权限校验：读操作默认放行；写操作走分级审批（见 approval.js）
  if (typeof permissionCheck === 'function') {
    const decision = await permissionCheck(toolName, args, context)
    const denied =
      decision === false ||
      (decision && typeof decision === 'object' && decision.allowed === false)
    if (denied) {
      const reason =
        decision && typeof decision === 'object' && decision.reason ? ` — ${decision.reason}` : ''
      console.log(`[ToolPipeline] ${toolName} denied by permissionCheck${reason}`)
      // permissionDenied 标记：调用方（agent 审计）据此区分"被拒"与"真实执行"
      return { permissionDenied: true, content: [{ text: `Permission denied for tool: ${toolName}${reason}` }] }
    }
    // dry-run：动作计划已生成（审批链路照常留痕），但绝不真实执行
    if (decision && typeof decision === 'object' && decision.dryRun === true) {
      console.log(`[ToolPipeline] ${toolName} skipped by dry-run`)
      return {
        dryRun: true,
        content: [
          {
            type: 'text',
            text: `[DRY-RUN] 写操作 ${toolName}(${JSON.stringify(args || {})}) 已规划但未真实执行（dry-run 模式）。请继续输出你接下来会执行的动作计划，不要重复调用本工具。`,
          },
        ],
      }
    }
  }

  // 2. 超时控制 + 执行
  const result = await withTimeout(
    run(args, context),
    timeoutMs,
    `Tool ${toolName} timed out after ${timeoutMs}ms`
  )
  return result
}

module.exports = { runToolPipeline, withTimeout, DEFAULT_TIMEOUT }
