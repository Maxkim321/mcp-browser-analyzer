const traceLog = require('./trace-log.js')
const { isWriteTool } = require('../tools/index.js')

/**
 * dph-D 分级权限 HITL：写操作审批挂载点的正式实现
 *
 * 问题：工具全只读时 permissionCheck 只是"默认放行"的预留挂载点；
 * 引入写操作（click_element/fill_input/select_option）后，"LLM 能改用户页面"
 * 必须有人的把关，否则 prompt injection 一句"帮我清空购物车"就是事故。
 *
 * 设计（对齐分级 HITL 的成本模型——打断成本高，只在收益为正的分叉点付费）：
 * - 读操作：零打断（不请求审批、不计数、不落审计）
 * - 写操作：每次执行前必须经用户审批（侧边栏审批卡片），决定落 trace-log 可审计
 * - 动作预算：单轮任务最多 N 个获批写动作，硬约束写死在代码（对齐 maxTopics 的原则）
 * - dry-run：只规划不执行——演示/评测模式，动作计划照常生成，管线跳过真实执行
 * - 超时/取消默认拒绝：审批是"授权"语义，等不到授权 = 没有授权（与深度研究"默认继续"相反）
 *
 * 纯依赖注入，无运行时状态：requestApproval 由 ws-server 提供（走 WS 往返），
 * 单测注入假实现即可覆盖全部分支。
 */

const DEFAULT_WRITE_BUDGET = 8
const ARGS_PREVIEW_LIMIT = 120

/**
 * 构造权限检查函数（挂在 tool-pipeline 的 permissionCheck 挂载点上）
 * @param {object} deps
 * @param {Function} deps.requestApproval - 请求用户审批：async ({toolName, args}) => {approved, note?, timeout?}
 * @param {number} [deps.writeBudget] - 单轮任务写动作预算，默认 DEFAULT_WRITE_BUDGET
 * @param {boolean} [deps.dryRun] - dry-run 模式：写动作只规划不执行
 * @param {string} [deps.sessionId] - 会话 ID（审计事件归因用）
 * @returns {Function} permissionCheck(toolName, args, context) => Promise<decision>
 *   decision: true（读操作放行）| {allowed:true} | {allowed:false, reason} | {dryRun:true}
 */
function createPermissionCheck({
  requestApproval,
  writeBudget = DEFAULT_WRITE_BUDGET,
  dryRun = false,
  sessionId = null,
} = {}) {
  return async function permissionCheck(toolName, args, context = {}) {
    // 读操作：零打断快速路径（boolean true，与旧契约一致）
    if (!isWriteTool(toolName)) return true

    const argsPreview = safePreview(args)

    // 动作预算：获批写动作计数挂在 toolContext（单轮任务生命周期）上，
    // 超预算直接拒绝——预算是硬约束，不信任模型自觉，也不请求审批（问了也没额度）
    const used = context.writeActionsUsed || 0
    if (used >= writeBudget) {
      const reason = `写动作预算已耗尽（本轮任务最多 ${writeBudget} 个获批写动作）`
      traceLog.record({
        type: 'write_approval_result',
        sessionId,
        tool: toolName,
        approved: false,
        note: reason,
        budgetExhausted: true,
      })
      return { allowed: false, reason }
    }

    // dry-run：动作计划照常产出（审批卡片/审计/轨迹都有），但管线不真实执行
    if (dryRun) {
      traceLog.record({
        type: 'write_approval_result',
        sessionId,
        tool: toolName,
        approved: true,
        note: 'dry-run 模式不执行',
        dryRun: true,
      })
      return { dryRun: true }
    }

    traceLog.record({ type: 'write_approval_requested', sessionId, tool: toolName, argsPreview })

    // 审批往返：等不到明确授权就是拒绝（超时/abort 由 requestApproval 的实现兜底成拒绝）
    let answer
    try {
      answer = await requestApproval({ toolName, args })
    } catch (error) {
      answer = { approved: false, note: `审批通道异常：${error.message}` }
    }
    const approved = answer?.approved === true

    traceLog.record({
      type: 'write_approval_result',
      sessionId,
      tool: toolName,
      approved,
      note: answer?.note || null,
      timeout: answer?.timeout === true,
    })

    if (!approved) {
      return { allowed: false, reason: answer?.note || '用户拒绝了该写操作' }
    }

    // 获批：计数推进（预算口径只数"获准执行"的写动作）
    context.writeActionsUsed = used + 1
    return { allowed: true }
  }
}

function safePreview(args) {
  try {
    const text = JSON.stringify(args || {})
    return text.length > ARGS_PREVIEW_LIMIT ? `${text.slice(0, ARGS_PREVIEW_LIMIT)}…` : text
  } catch {
    return '(unserializable args)'
  }
}

module.exports = { createPermissionCheck, DEFAULT_WRITE_BUDGET }
