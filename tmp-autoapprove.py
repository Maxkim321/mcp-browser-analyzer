# -*- coding: utf-8 -*-
import io

# ============ 1) prompts.js：SOP 修复（删人为确认停点，改直接查+注明） ============
p = "agent-server/src/config/prompts.js"
s = io.open(p, encoding="utf-8").read()

def rep(old, new, n=1):
    global s
    assert s.count(old) == n, (old[:70], s.count(old))
    s = s.replace(old, new, n)

rep("""- 相对日期以"今天的日期"为基准换算（"下周五"=下一周的周五，不是最近的周五）；换算结果先报给用户再查询""",
    """- 相对日期以"今天的日期"为基准换算（"下周五"=下一周的周五，不是最近的周五）；**换算后直接查询，结果里注明换算出的日期**——影响不大的决策不要停下来等人确认""")

rep("""- 查票流程（纯读，零审批）：直达结果页 https://trains.ctrip.com/trainbooking/search?from=<出发城市URL编码>&to=<到达城市URL编码>——该模板的城市参数可靠；**日期参数不可靠**，必须在页面日期条上点击目标日期（标签自带"今天/明天/周几"，超出一屏用翻页箭头），然后用 get_page_content 或 get_interactive_elements 读车次列表""",
    """- 起讫城市能从上下文推断就直接用（如记忆里的历史记录、用户说的"回X"），**推断依据在结果里注明**；完全无法推断才问，且只问缺的那一项
- 查票流程（纯读，零审批）：**第一步就是 navigate_to 直达结果页** https://trains.ctrip.com/trainbooking/search?from=<出发城市URL编码>&to=<到达城市URL编码>（不要在首页表单逐步填写）——该模板的城市参数可靠；**日期参数不可靠**，须在页面日期条上点击目标日期（标签自带"今天/明天/周几"，超出一屏用翻页箭头），然后用 get_page_content 或 get_interactive_elements 读车次列表；点击会触发写审批，**第一次放行时勾选"本会话自动放行该工具"**，同会话后续同类点击不再打断""")

io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("prompts ok")

# ============ 2) ws-server：会话级自动放行（审批记忆，sudo 缓存模式） ============
p2 = "agent-server/src/communication/ws-server.js"
s2 = io.open(p2, encoding="utf-8").read()

def rep2(old, new, n=1):
    global s2
    assert s2.count(old) == n, (old[:70], s2.count(old))
    s2 = s2.replace(old, new, n)

# 2a. 自动放行登记表
rep2("""// P4 写操作审批等待：approvalId → { resolve, timer, cleanup }
const pendingWriteApprovals = new Map()""",
    """// P4 写操作审批等待：approvalId → { resolve, timer, cleanup }
const pendingWriteApprovals = new Map()
// P16.1 审批记忆（sudo 缓存模式）：用户在审批卡勾选"本会话自动放行该工具"后，
// 同连接同会话同工具的后续审批直接放行（key: `${connId}:${sessionId}:${toolName}`）。
// 兜底不变：写预算上限/事件溯源审计/dry-run 原样生效；连接断开即清空
const sessionAutoApprovals = new Set()""")

# 2b. requestWriteApproval：签名加 sessionId + 自动放行快速路径 + 事件加 canRemember
rep2(""" * @param {Array} [taint] - P7 注入染色证据（本轮检出的可疑来源，卡片据此亮警告）
 * @returns {Promise<{approved:boolean,note?:string,timeout?:boolean}>}
 */
function requestWriteApproval(id, toolName, args, signal, taint = []) {
  return new Promise((resolve) => {
    const approvalId = uuidv4()""",
    """ * @param {Array} [taint] - P7 注入染色证据（本轮检出的可疑来源，卡片据此亮警告）
 * @param {string} [sessionId] - 会话 ID（审批记忆按 会话×工具 生效）
 * @returns {Promise<{approved:boolean,note?:string,timeout?:boolean,auto?:boolean}>}
 */
function requestWriteApproval(id, toolName, args, signal, taint = [], sessionId = '') {
  // 审批记忆命中：同会话同工具已被用户勾选自动放行 → 直接放行并落审计
  const autoKey = `${id}:${sessionId || ''}:${toolName}`
  if (sessionAutoApprovals.has(autoKey)) {
    traceLog.record({
      type: 'write_approval_result',
      sessionId: sessionId || null,
      tool: toolName,
      approved: true,
      note: '会话内自动放行（用户此前勾选）',
    })
    return Promise.resolve({ approved: true, auto: true })
  }
  return new Promise((resolve) => {
    const approvalId = uuidv4()""")

# 2c. 卡片事件带 canRemember
rep2("""    const sent = manager.send(id, {
      type: 'write_approval',
      requestId: approvalId,
      tool: toolName,
      args,
      taint: Array.isArray(taint) ? taint : [],
    })""",
    """    const sent = manager.send(id, {
      type: 'write_approval',
      requestId: approvalId,
      tool: toolName,
      args,
      taint: Array.isArray(taint) ? taint : [],
      canRemember: true,
    })""")

# 2d. pending 记录 autoKey
rep2("""    pendingWriteApprovals.set(approvalId, { resolve: settle, connectionId: id })""",
    """    pendingWriteApprovals.set(approvalId, { resolve: settle, connectionId: id, autoKey })""")

# 2e. 答复分支透传 remember
rep2("""  if (msg.type === 'write_approval_answer') {
    const pending = pendingWriteApprovals.get(msg.requestId)
    if (pending) {
      pending.resolve({
        approved: msg.approved === true,
        note: msg.approved ? undefined : String(msg.note || '用户拒绝了该写操作'),
      })
    }
    return
  }""",
    """  if (msg.type === 'write_approval_answer') {
    const pending = pendingWriteApprovals.get(msg.requestId)
    if (pending) {
      // P16.1 审批记忆：用户勾选"本会话自动放行该工具"且放行 → 登记缓存
      if (pending.autoKey && msg.remember === true && msg.approved === true) {
        sessionAutoApprovals.add(pending.autoKey)
        console.log(`[Approval] Session auto-approve enabled: ${pending.autoKey}`)
      }
      pending.resolve({
        approved: msg.approved === true,
        note: msg.approved ? undefined : String(msg.note || '用户拒绝了该写操作'),
      })
    }
    return
  }""")

# 2f. 审批闭包传 sessionId
rep2("""        const permissionCheck = createPermissionCheck({
          requestApproval: ({ toolName, args, taint }) =>
            requestWriteApproval(id, toolName, args, controller.signal, taint),""",
    """        const permissionCheck = createPermissionCheck({
          requestApproval: ({ toolName, args, taint }) =>
            requestWriteApproval(id, toolName, args, controller.signal, taint, sessionId),""")

# 2g. 连接关闭清理
rep2("""    // P16：清理该连接全部会话的工作 tab 记录
    toolHandler.clearWorkingTabsForConnection(connectionId)
    denyPendingApprovals(connectionId)
    // 清理该连接的深度研究资源（会话级工作流标记 + HITL 等待）
    cleanupConnectionWorkflows(connectionId)
  })""",
    """    // P16：清理该连接全部会话的工作 tab 记录
    toolHandler.clearWorkingTabsForConnection(connectionId)
    // P16.1：清理该连接的审批记忆
    for (const key of Array.from(sessionAutoApprovals)) {
      if (key.startsWith(`${connectionId}:`)) sessionAutoApprovals.delete(key)
    }
    denyPendingApprovals(connectionId)
    // 清理该连接的深度研究资源（会话级工作流标记 + HITL 等待）
    cleanupConnectionWorkflows(connectionId)
  })""")

io.open(p2, "w", encoding="utf-8", newline="\n").write(s2)
print("ws-server ok")
