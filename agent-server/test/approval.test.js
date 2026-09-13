const path = require('node:path')
const os = require('node:os')
// 测试隔离：必须在 require trace-log 之前设置（模块加载时固化路径）
process.env.TRACE_FILE = path.join(os.tmpdir(), `trace-log-test-${process.pid}.jsonl`)
const { test, describe, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { createPermissionCheck } = require('../src/core/approval.js')
const { isWriteTool, tools } = require('../src/tools/index.js')
const { runToolPipeline } = require('../src/core/tool-pipeline.js')
const { Agent } = require('../src/core/agent.js')
const handler = require('../src/tools/handler.js')
const traceLog = require('../src/core/trace-log.js')

/**
 * P4 分级权限 HITL：写操作审批
 * 覆盖：工具元数据口径 / 权限检查全分支（读放行、审批放行、拒绝、预算、dry-run、异常）
 * / 管线决策对象契约（含向后兼容布尔值）/ 审计事件落痕 / 写动作 handler 的 WS 往返
 */

beforeEach(() => traceLog.resetMemory())

// ===== 工具元数据口径 =====

describe('写工具元数据', () => {
  test('写工具标注 dangerLevel=write，isWriteTool 判定一致', () => {
    for (const name of ['click_element', 'fill_input', 'select_option']) {
      assert.equal(isWriteTool(name), true, `${name} 应为写工具`)
      assert.equal(tools.find((t) => t.name === name).dangerLevel, 'write')
    }
  })

  test('读工具与未知工具判 false（读操作零打断的快速路径）', () => {
    for (const name of [
      'get_page_content',
      'web_search',
      'get_interactive_elements',
      'no_such_tool',
    ]) {
      assert.equal(isWriteTool(name), false, `${name} 不应判为写工具`)
    }
  })

  test('get_interactive_elements 是读工具：写操作前的定位不增加审批负担', () => {
    const tool = tools.find((t) => t.name === 'get_interactive_elements')
    assert.equal(tool.dangerLevel, 'read')
  })
})

// ===== createPermissionCheck =====

describe('createPermissionCheck', () => {
  const WRITE_TOOL = 'fill_input'

  test('读操作直接放行，不请求审批', async () => {
    let asked = 0
    const check = createPermissionCheck({
      requestApproval: async () => {
        asked++
        return { approved: true }
      },
    })
    const decision = await check('get_page_content', {}, {})
    assert.equal(decision, true)
    assert.equal(asked, 0)
  })

  test('写操作获批：allowed=true，预算计数推进', async () => {
    const check = createPermissionCheck({
      requestApproval: async () => ({ approved: true }),
      writeBudget: 2,
    })
    const context = {}
    const first = await check(WRITE_TOOL, { selector: '#a' }, context)
    assert.deepEqual(first, { allowed: true })
    assert.equal(context.writeActionsUsed, 1)
    const second = await check(WRITE_TOOL, { selector: '#b' }, context)
    assert.equal(second.allowed, true)
    assert.equal(context.writeActionsUsed, 2)
  })

  test('写操作被拒：allowed=false 且拒绝原因回传（喂给 LLM 可自纠）', async () => {
    const check = createPermissionCheck({
      requestApproval: async () => ({ approved: false, note: '用户拒绝了该写操作' }),
    })
    const decision = await check(WRITE_TOOL, { selector: '#x' }, {})
    assert.equal(decision.allowed, false)
    assert.match(decision.reason, /用户拒绝/)
  })

  test('requestApproval 抛异常 → 视为拒绝（审批通道故障不放行写操作）', async () => {
    const check = createPermissionCheck({
      requestApproval: async () => {
        throw new Error('ws gone')
      },
    })
    const decision = await check(WRITE_TOOL, {}, {})
    assert.equal(decision.allowed, false)
    assert.match(decision.reason, /审批通道异常/)
  })

  test('预算耗尽：直接拒绝且不再打扰用户（问了也没额度）', async () => {
    let asked = 0
    const check = createPermissionCheck({
      requestApproval: async () => {
        asked++
        return { approved: true }
      },
      writeBudget: 1,
    })
    const context = { writeActionsUsed: 1 }
    const decision = await check(WRITE_TOOL, {}, context)
    assert.equal(decision.allowed, false)
    assert.match(decision.reason, /预算已耗尽/)
    assert.equal(asked, 0)
    // 计数不因拒绝而变化
    assert.equal(context.writeActionsUsed, 1)
  })

  test('dry-run：返回 {dryRun:true}，不请求审批、不计数', async () => {
    let asked = 0
    const check = createPermissionCheck({
      requestApproval: async () => {
        asked++
        return { approved: true }
      },
      dryRun: true,
    })
    const context = {}
    const decision = await check(WRITE_TOOL, { selector: '#a' }, context)
    assert.deepEqual(decision, { dryRun: true })
    assert.equal(asked, 0)
    assert.equal(context.writeActionsUsed, undefined)
  })

  test('审批决策与请求落 trace-log（白面板/审计可见）', async () => {
    const check = createPermissionCheck({
      requestApproval: async () => ({ approved: true }),
      sessionId: 'sess-1',
    })
    await check(WRITE_TOOL, { selector: '#email', value: 'a@b.c' }, {})
    // readAll 读的是文件（跨用例累积），按本用例独有的 args/tool 组合精确过滤
    const events = traceLog.readAll()
    const requested = events.find(
      (e) => e.type === 'write_approval_requested' && e.argsPreview?.includes('#email')
    )
    const result = events.find(
      (e) => e.type === 'write_approval_result' && e.tool === WRITE_TOOL && e.sessionId === 'sess-1'
    )
    assert.ok(requested, '应有审批请求事件')
    assert.equal(requested.tool, WRITE_TOOL)
    assert.equal(requested.sessionId, 'sess-1')
    assert.ok(requested.argsPreview.includes('#email'))
    assert.ok(result, '应有审批结果事件')
    assert.equal(result.approved, true)
  })
})

// ===== tool-pipeline 决策契约扩展 =====

describe('runToolPipeline 决策对象契约', () => {
  test('{allowed:false, reason} → 拒绝文案带原因（旧布尔行为不变）', async () => {
    let executed = false
    const result = await runToolPipeline({
      toolName: 'fill_input',
      args: {},
      context: {},
      permissionCheck: async () => ({ allowed: false, reason: '用户拒绝' }),
      run: () => {
        executed = true
        return { content: [{ text: 'should not run' }] }
      },
    })
    assert.equal(executed, false)
    assert.match(result.content[0].text, /Permission denied/)
    assert.match(result.content[0].text, /用户拒绝/)

    // 旧契约：布尔 false 依旧拒绝（存量测试语义不变）
    const legacy = await runToolPipeline({
      toolName: 'x',
      args: {},
      context: {},
      permissionCheck: () => false,
      run: () => ({ content: [{ text: 'nope' }] }),
    })
    assert.match(legacy.content[0].text, /Permission denied/)
  })

  test('{allowed:true} 放行执行', async () => {
    const result = await runToolPipeline({
      toolName: 'click_element',
      args: {},
      context: {},
      permissionCheck: async () => ({ allowed: true }),
      run: () => ({ content: [{ text: 'clicked' }] }),
    })
    assert.equal(result.content[0].text, 'clicked')
  })

  test('{dryRun:true} → 返回 DRY-RUN 占位结果，run 不执行', async () => {
    let executed = false
    const result = await runToolPipeline({
      toolName: 'fill_input',
      args: { selector: '#email' },
      context: {},
      permissionCheck: async () => ({ dryRun: true }),
      run: () => {
        executed = true
        return { content: [{ text: 'should not run' }] }
      },
    })
    assert.equal(executed, false)
    assert.match(result.content[0].text, /DRY-RUN/)
    assert.match(result.content[0].text, /#email/)
  })
})

// ===== agent 接线 =====

describe('agent 权限检查接线', () => {
  test('executeSingleTool 尊重 context.permissionCheck（options 注入优先于 config）', async () => {
    const agent = new Agent()
    const toolCall = {
      id: 't1',
      function: { name: 'fill_input', arguments: '{"selector":"#e","value":"v"}' },
    }
    const context = {
      permissionCheck: async () => ({ allowed: false, reason: '用户拒绝' }),
      writeActionsUsed: 0,
    }
    await agent.executeSingleTool(toolCall, context)
    const toolMsg = agent.conversationHistory.find((m) => m.role === 'tool')
    assert.ok(toolMsg, '应有 tool 消息回喂')
    assert.match(toolMsg.content, /Permission denied/)
    assert.match(toolMsg.content, /用户拒绝/)
    // 被拒绝的写动作不计入预算
    assert.equal(context.writeActionsUsed, 0)
  })

  test('写动作执行成功后落 write_action_executed 审计事件', async () => {
    // 注入假 ws 模块：write_action 指令被捕获并立即模拟插件回包
    let captured = null
    handler.init({
      manager: { getIds: () => [1], getCount: () => 1 },
      send: (id, cmd) => {
        captured = cmd
        return true
      },
      broadcast: () => true,
    })
    const agent = new Agent()
    const toolCall = {
      id: 't2',
      function: { name: 'click_element', arguments: '{"selector":"#btn"}' },
    }
    const context = {
      connectionId: 1,
      permissionCheck: async () => ({ allowed: true }),
      writeActionsUsed: 0,
    }
    // RPC 往返时序：先启动执行（不 await），等指令发出后模拟插件回包，再等执行收尾
    const done = agent.executeSingleTool(toolCall, context)
    for (let i = 0; i < 100 && !captured; i++) {
      await new Promise((r) => setTimeout(r, 5))
    }
    assert.ok(captured, '应已向插件发送 write_action 指令')
    assert.equal(captured.type, 'write_action')
    assert.equal(captured.action, 'click')
    // 模拟插件回包（与 SidePanel sendToolResponse 同构）
    handler.handlePluginResponse(1, {
      requestId: captured.requestId,
      type: 'write_action_result',
      payload: { ok: true, info: 'clicked #btn' },
    })
    await done
    const executed = traceLog
      .readAll()
      .filter(
        (e) => e.type === 'write_action_executed' && e.ok === true && e.tool === 'click_element'
      )
    assert.equal(executed.length, 1)
    assert.equal(executed[0].tool, 'click_element')
    // 注：预算计数推进由 createPermissionCheck 套件覆盖（此处是假 permissionCheck，不计数）
  })
})
