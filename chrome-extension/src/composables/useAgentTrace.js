/**
 * Agent 执行轨迹（Agent Trace）
 *
 * 背景：服务端把一次用户请求（Turn）拆成多个 Step 执行，通过 WS 推送离散事件：
 *   - agent_step        ReAct 循环：{ step, iteration, phase: 'reasoning'|'tool'|'compress'|'done', status, tool?, compressed? }
 *   - workflow_progress 深度研究状态机：{ taskId, step: 'plan'|'research'|'compare'|'report', message }
 *
 * 问题：这些事件是「当前发生了什么」的瞬时快照，而 UI 需要的是「整个过程长什么样」的
 * 结构化轨迹（有层级、有状态、可回溯、可持久化）。原实现用单个 ref 存最新事件，
 * 后一个覆盖前一个，回答出现后整块丢弃，用户无法回看 Agent 做过什么。
 *
 * 本模块是事件流 → UI 状态的归约层（reducer）：
 *   1. 归并：同一逻辑单元的多个事件合并为一个节点的状态流转，而非追加多条记录
 *   2. 分层：深度研究的 plan/research/compare/report 作为阶段节点，其下挂子步骤
 *   3. 收敛：Turn 结束时把所有 running 节点收敛到终态，避免 UI 永久转圈
 *   4. 可序列化：产出纯对象，直接随消息存入 chrome.storage.local，刷新后可重建
 */
import { ref, computed } from 'vue'

/** 节点运行状态 */
export const TRACE_STATUS = {
  RUNNING: 'running',
  SUCCESS: 'success',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
}

/** 工具名 → 展示文案，避免 UI 里直接暴露内部标识 */
const TOOL_LABELS = {
  web_search: '联网搜索',
  fetch_url: '读取网页',
  get_page_content: '提取当前页正文',
  navigate_to: '页面跳转',
  reload_page: '刷新页面',
  wait_for_load: '等待加载',
  get_browser_performance: '采集性能数据',
  list_connections: '查询浏览器连接',
  broadcast_message: '广播消息',
  todo_write: '拆解任务清单',
}

/** 深度研究阶段 → 展示文案 */
const WORKFLOW_PHASES = {
  plan: '规划子问题',
  research: '检索与阅读',
  compare: '交叉对比',
  report: '生成报告',
}

/**
 * 进度文案中的失败特征。
 * 服务端的 workflow_progress 是自然语言，没有独立的 status 字段，
 * 只能在前端按语义判定，否则失败步骤会被渲染成"成功"，掩盖真实问题。
 */
const FAILURE_PATTERN = /失败|错误|不足|跳过|超时|未响应|无可用|未获得|未返回/

/** 子步骤缩进：服务端用前导空格表达层级（如 `  搜索：xxx`） */
const isSubStep = (message) => /^\s{2,}/.test(message || '')

const toolLabel = (name) => TOOL_LABELS[name] || name || '工具'

let seed = 0
const nextId = () => `t${Date.now().toString(36)}${(seed++).toString(36)}`

const createNode = (patch = {}) => ({
  id: nextId(),
  kind: 'step',
  label: '',
  detail: '',
  status: TRACE_STATUS.RUNNING,
  startedAt: Date.now(),
  endedAt: null,
  children: [],
  ...patch,
})

const finalize = (node, status) => {
  if (node.status === TRACE_STATUS.RUNNING) {
    node.status = status
    node.endedAt = Date.now()
  }
  node.children.forEach((child) => finalize(child, status))
}

export function useAgentTrace() {
  /** 当前 Turn 的轨迹节点树（顶层为阶段/步骤节点） */
  const nodes = ref([])
  /** Turn 是否进行中：决定 UI 显示"执行中"还是最终折叠态 */
  const active = ref(false)
  /** 归并用索引：逻辑键 → 节点，保证同一单元的事件更新而非追加 */
  let index = new Map()

  const reset = () => {
    nodes.value = []
    index = new Map()
    active.value = false
  }

  const begin = () => {
    reset()
    active.value = true
  }

  /** 找最后一个仍在进行的顶层节点，作为子步骤的挂载点 */
  const currentParent = () => {
    for (let i = nodes.value.length - 1; i >= 0; i--) {
      if (nodes.value[i].kind === 'phase') return nodes.value[i]
    }
    return null
  }

  const push = (node, parent = null) => {
    if (parent) parent.children.push(node)
    else nodes.value.push(node)
    return node
  }

  /**
   * 归约 ReAct 事件（agent_step）
   *
   * 归并规则：
   * - reasoning：同一 iteration 只保留一个推理节点，重复事件视为该节点仍在进行
   * - tool：按 iteration + 工具名归并；下一次 reasoning 到来说明本轮工具已执行完毕
   * - compress：上下文压缩是瞬时动作，直接落成功态
   * - done：Turn 结束，收敛所有未完成节点
   */
  const applyStep = (event) => {
    if (!event) return
    if (!active.value) begin()

    const { phase, iteration = 0, tool, compressed } = event

    if (phase === 'reasoning') {
      // 新一轮推理意味着上一轮的工具调用已全部返回
      nodes.value.forEach((node) => {
        if (node.kind === 'tool') finalize(node, TRACE_STATUS.SUCCESS)
      })
      const key = `reasoning:${iteration}`
      if (index.has(key)) return
      index.set(key, push(createNode({ kind: 'reasoning', label: '推理决策', detail: `第 ${iteration} 轮` })))
      return
    }

    if (phase === 'tool') {
      const key = `tool:${iteration}:${tool}`
      if (index.has(key)) return
      // 推理节点在发起工具调用后即完成使命
      const reasoning = index.get(`reasoning:${iteration}`)
      if (reasoning) finalize(reasoning, TRACE_STATUS.SUCCESS)
      index.set(key, push(createNode({ kind: 'tool', label: toolLabel(tool), detail: '调用中' })))
      return
    }

    if (phase === 'compress') {
      push(
        createNode({
          kind: 'compress',
          label: '上下文压缩',
          detail: compressed ? `${compressed} 条早期消息 → 摘要` : '',
          status: TRACE_STATUS.SUCCESS,
          endedAt: Date.now(),
        })
      )
      return
    }

    if (phase === 'done') {
      complete(TRACE_STATUS.SUCCESS)
    }
  }

  /**
   * 归约深度研究事件（workflow_progress）
   *
   * 服务端只给自然语言 message + step 字段，这里做两件事：
   * - step 变化 → 开一个阶段节点，前一阶段收敛为成功
   * - 缩进文案 → 作为当前阶段的子步骤；失败语义单独标红且不被覆盖
   */
  const applyWorkflow = (event) => {
    if (!event || !event.message) return
    if (!active.value) begin()

    const { step, message } = event
    const failed = FAILURE_PATTERN.test(message)
    const text = message.trim()

    // 子步骤：挂到当前阶段下
    if (isSubStep(message)) {
      const parent = currentParent()
      const node = createNode({
        kind: 'substep',
        label: text,
        status: failed ? TRACE_STATUS.FAILED : TRACE_STATUS.SUCCESS,
        endedAt: Date.now(),
      })
      push(node, parent)
      return
    }

    const phaseKey = `phase:${step}`
    let phase = index.get(phaseKey)

    if (!phase) {
      // 切换阶段：先收敛上一个阶段
      const prev = currentParent()
      if (prev) finalize(prev, TRACE_STATUS.SUCCESS)
      phase = push(
        createNode({
          kind: 'phase',
          label: WORKFLOW_PHASES[step] || step || '执行中',
          detail: text,
        })
      )
      index.set(phaseKey, phase)
      return
    }

    // 同阶段内的进度更新：刷新描述，失败信息必须留痕为子步骤
    if (failed) {
      push(
        createNode({
          kind: 'substep',
          label: text,
          status: TRACE_STATUS.FAILED,
          endedAt: Date.now(),
        }),
        phase
      )
    } else {
      phase.detail = text
    }
  }

  /** Turn 结束：把残留的 running 节点收敛到终态，防止 UI 永久 loading */
  const complete = (status = TRACE_STATUS.SUCCESS) => {
    nodes.value.forEach((node) => finalize(node, status))
    active.value = false
  }

  /** 导出为可序列化快照，随消息一起持久化 */
  const snapshot = () => JSON.parse(JSON.stringify(nodes.value))

  /** 顶层节点数，作为折叠态的摘要信息 */
  const total = computed(() => nodes.value.length)

  /** 当前正在执行的节点描述，用于折叠态的一行提示 */
  const currentLabel = computed(() => {
    for (let i = nodes.value.length - 1; i >= 0; i--) {
      const node = nodes.value[i]
      if (node.status === TRACE_STATUS.RUNNING) return node.label
    }
    return nodes.value.length ? nodes.value[nodes.value.length - 1].label : ''
  })

  return {
    nodes,
    active,
    total,
    currentLabel,
    begin,
    reset,
    applyStep,
    applyWorkflow,
    complete,
    snapshot,
  }
}
