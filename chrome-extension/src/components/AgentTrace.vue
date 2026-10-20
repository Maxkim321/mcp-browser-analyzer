<!--
  Agent 执行轨迹面板

  两种渲染形态：
  1. 时间线（nodes）：ReAct / 非结构化 workflow_progress 归约出的树，可折叠列表；
  2. DAG 图（graph）：深度研究状态机下发的结构化节点（id/parent/parents），
     渲染成「规划 → 主题分支 → 交叉对比 → 报告 → 校验」的有向图。

  DAG 边通过 SVG 覆盖层绘制：节点用稳定 id 做 key，边由 parents 字段派生，
  draw 时测量节点 DOM 位置生成贝塞尔连线（fan-out / fan-in 一目了然）。
-->
<template>
  <div v-if="nodes.length || graph.length" class="agent-trace" :class="{ 'is-active': active }">
    <button class="trace-header" @click="expanded = !expanded">
      <span class="trace-caret" :class="{ open: expanded }">▸</span>
      <span v-if="active" class="trace-spinner"></span>
      <span class="trace-title">
        {{ active ? currentLabel || '执行中' : summaryLabel }}
      </span>
      <span v-if="active && elapsed" class="trace-elapsed">{{ elapsed }}</span>
    </button>

    <!-- 深度研究 DAG 图 -->
    <div v-if="graph.length" v-show="expanded" class="dag-scroll">
      <div class="dag-content" ref="dagContent">
        <svg class="dag-edges" :width="dagSize.w" :height="dagSize.h">
          <path
            v-for="edge in dagEdges"
            :key="`${edge.from}->${edge.to}`"
            class="dag-edge"
            :data-from="edge.from"
            :data-to="edge.to"
          />
        </svg>
        <div class="dag-layers">
          <div v-for="layer in dagLayers" :key="layer.key" class="dag-layer">
            <div class="dag-layer-title">{{ layer.label }}</div>
            <div
              v-for="node in layer.nodes"
              :key="node.id"
              class="dag-node"
              :data-id="node.id"
              :class="`is-${node.status}`"
            >
              <div class="dag-node-head">
                <span class="trace-icon" :class="`is-${node.status}`">{{ statusIcon(node) }}</span>
                <span class="dag-node-label">{{ node.label }}</span>
              </div>
              <div v-if="node.detail" class="dag-node-detail">{{ node.detail }}</div>
              <!-- 主题节点下的搜索/抓取/提炼动作 -->
              <div v-if="dagActions.get(node.id)" class="dag-actions">
                <div
                  v-for="a in dagActions.get(node.id)"
                  :key="a.id"
                  class="dag-action"
                  :class="`is-${a.status}`"
                >
                  <span class="trace-icon" :class="`is-${a.status}`">{{ statusIcon(a) }}</span>
                  <span class="dag-action-label">{{ a.label }}</span>
                  <span v-if="a.detail" class="dag-action-detail">{{ a.detail }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 原有时间线（ReAct / 非结构化进度） -->
    <ul v-if="!graph.length" v-show="expanded" class="trace-list">
      <li v-for="node in nodes" :key="node.id" class="trace-node">
        <div class="trace-row">
          <span class="trace-icon" :class="`is-${node.status}`">{{ statusIcon(node) }}</span>
          <span class="trace-label">{{ node.label }}</span>
          <span v-if="node.detail" class="trace-detail">{{ node.detail }}</span>
          <span v-if="duration(node)" class="trace-duration">{{ duration(node) }}</span>
        </div>

        <ul v-if="node.children.length" class="trace-children">
          <li v-for="child in node.children" :key="child.id" class="trace-row is-child">
            <span class="trace-icon" :class="`is-${child.status}`">{{ statusIcon(child) }}</span>
            <span class="trace-label">{{ child.label }}</span>
          </li>
        </ul>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { ref, computed, watch, reactive, nextTick, onMounted, onUnmounted } from 'vue'
import { TRACE_STATUS } from '@/composables/useAgentTrace'

const props = defineProps({
  nodes: { type: Array, default: () => [] },
  graph: { type: Array, default: () => [] },
  active: { type: Boolean, default: false },
  // 答案开始流式后置 true：实时轨迹自动收起成一行摘要（过程让位给结论），
  // 用户手动展开后不强制收回（仅在 false→true 跳变时收起一次）
  forceCollapsed: { type: Boolean, default: false },
})

// 展开初始值跟随挂载形态：实时轨迹（active）展开，历史快照（inactive）折叠
const expanded = ref(props.active)

// 执行结束后自动折叠，避免长轨迹淹没最终回答
watch(
  () => props.active,
  (isActive, wasActive) => {
    if (isActive) expanded.value = true
    else if (wasActive) expanded.value = false
  }
)

// 答案开始输出（forceCollapsed false→true）时收起一次实时轨迹
watch(
  () => props.forceCollapsed,
  (v, was) => {
    if (v && !was) expanded.value = false
  }
)

// 计时：仅执行中开启定时器，结束即清理，避免空转
const now = ref(Date.now())
let timer = null

watch(
  () => props.active,
  (isActive) => {
    if (isActive && !timer) {
      timer = setInterval(() => {
        now.value = Date.now()
      }, 1000)
    } else if (!isActive && timer) {
      clearInterval(timer)
      timer = null
    }
  },
  { immediate: true }
)

const startedAt = computed(() => {
  const list = props.graph.length ? props.graph : props.nodes
  return list.length ? list[0].startedAt : 0
})

// 折叠态下的一行提示：优先显示正在执行的节点，否则显示最后一个节点
const currentLabel = computed(() => {
  const list = props.graph.length ? props.graph : props.nodes
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].status === TRACE_STATUS.RUNNING) return list[i].label
  }
  return list.length ? list[list.length - 1].label : ''
})

const summaryLabel = computed(() =>
  props.graph.length ? `思考过程 · ${props.graph.length} 节点` : `思考过程 · ${props.nodes.length} 步`
)

const elapsed = computed(() => {
  if (!props.active || !startedAt.value) return ''
  return `${Math.max(0, Math.round((now.value - startedAt.value) / 1000))}s`
})

const ICONS = {
  [TRACE_STATUS.SUCCESS]: '✓',
  [TRACE_STATUS.FAILED]: '✕',
  [TRACE_STATUS.CANCELLED]: '⊘',
}

const statusIcon = (node) => ICONS[node.status] || '●'

const duration = (node) => {
  if (!node.endedAt || !node.startedAt) return ''
  const ms = node.endedAt - node.startedAt
  if (ms < 1000) return ''
  return `${(ms / 1000).toFixed(1)}s`
}

// ===== 深度研究 DAG 归约 → 分层布局 =====

const LAYER_ORDER = ['plan', 'topic', 'compare', 'report', 'verify']
const LAYER_LABELS = {
  plan: '规划',
  topic: '主题',
  compare: '对比',
  report: '报告',
  verify: '校验',
}

/** 顶层节点（非 action）按 kind 分列；topic 按主题下标排序 */
const dagLayers = computed(() => {
  const byKind = new Map()
  for (const n of props.graph) {
    if (n.kind === 'action') continue
    if (!byKind.has(n.kind)) byKind.set(n.kind, [])
    byKind.get(n.kind).push(n)
  }
  for (const list of byKind.values()) {
    list.sort((a, b) => {
      const ai = a.meta?.topicIndex ?? Number.MAX_SAFE_INTEGER
      const bi = b.meta?.topicIndex ?? Number.MAX_SAFE_INTEGER
      return ai - bi
    })
  }
  return LAYER_ORDER.filter((k) => byKind.has(k)).map((k) => ({
    key: k,
    label: LAYER_LABELS[k] || k,
    nodes: byKind.get(k),
  }))
})

/** DAG 边：只连顶层节点（action 在主题卡片内展示，不参与外层连线） */
const dagEdges = computed(() => {
  const byId = new Map(props.graph.map((n) => [n.id, n]))
  const edges = []
  for (const n of props.graph) {
    if (n.kind === 'action' || !n.parents?.length) continue
    for (const p of n.parents) {
      const from = byId.get(p)
      if (from && from.kind !== 'action') edges.push({ from: p, to: n.id })
    }
  }
  return edges
})

/** 主题节点下挂的 search/fetch/grade 动作（按推送顺序保留） */
const dagActions = computed(() => {
  const map = new Map()
  for (const n of props.graph) {
    if (n.kind === 'action' && n.parent) {
      if (!map.has(n.parent)) map.set(n.parent, [])
      map.get(n.parent).push(n)
    }
  }
  return map
})

const dagContent = ref(null)
const dagSize = reactive({ w: 0, h: 0 })

const drawEdges = () => {
  const content = dagContent.value
  const svg = content?.querySelector('svg.dag-edges')
  if (!content || !svg) return

  const rect = content.getBoundingClientRect()
  const pos = new Map()
  content.querySelectorAll('.dag-node').forEach((el) => {
    const r = el.getBoundingClientRect()
    pos.set(el.dataset.id, {
      x: r.left - rect.left,
      y: r.top - rect.top,
      w: r.width,
      h: r.height,
    })
  })

  svg.querySelectorAll('path.dag-edge').forEach((p) => {
    const from = pos.get(p.dataset.from)
    const to = pos.get(p.dataset.to)
    if (!from || !to) {
      p.setAttribute('d', '')
      return
    }
    const x1 = from.x + from.w
    const y1 = from.y + from.h / 2
    const x2 = to.x
    const y2 = to.y + to.h / 2
    const mx = (x1 + x2) / 2
    p.setAttribute('d', `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`)
  })
}

const refreshDag = () => {
  nextTick(() => {
    const content = dagContent.value
    if (!content) return
    dagSize.w = content.scrollWidth
    dagSize.h = content.scrollHeight
    requestAnimationFrame(drawEdges)
  })
}

watch(() => props.graph, refreshDag, { deep: true })
watch(expanded, (v) => {
  if (v) refreshDag()
})

onMounted(refreshDag)
onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<style scoped>
.agent-trace {
  margin: 6px 0;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fafafa;
  font-size: 12px;
  overflow: hidden;
}

.agent-trace.is-active {
  border-color: #c7d2fe;
  background: #f8faff;
}

.trace-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  color: #4b5563;
  font-size: 12px;
}

.trace-header:hover {
  background: rgba(0, 0, 0, 0.03);
}

.trace-caret {
  display: inline-block;
  transition: transform 0.15s ease;
  color: #9ca3af;
  font-size: 10px;
}

.trace-caret.open {
  transform: rotate(90deg);
}

.trace-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trace-elapsed {
  color: #9ca3af;
  font-variant-numeric: tabular-nums;
}

.trace-spinner {
  width: 10px;
  height: 10px;
  border: 1.5px solid #c7d2fe;
  border-top-color: #6366f1;
  border-radius: 50%;
  animation: trace-spin 0.7s linear infinite;
  flex-shrink: 0;
}

@keyframes trace-spin {
  to {
    transform: rotate(360deg);
  }
}

.trace-list,
.trace-children {
  margin: 0;
  padding: 0;
  list-style: none;
}

.trace-list {
  padding: 2px 10px 8px 10px;
}

.trace-node + .trace-node {
  margin-top: 3px;
}

.trace-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  line-height: 1.6;
}

.trace-icon {
  width: 12px;
  flex-shrink: 0;
  text-align: center;
  font-size: 10px;
}

.trace-icon.is-running {
  color: #6366f1;
  animation: trace-pulse 1.2s ease-in-out infinite;
}

.trace-icon.is-success {
  color: #10b981;
}

.trace-icon.is-failed {
  color: #ef4444;
}

.trace-icon.is-cancelled {
  color: #9ca3af;
}

@keyframes trace-pulse {
  50% {
    opacity: 0.35;
  }
}

.trace-label {
  color: #374151;
}

.trace-detail {
  flex: 1;
  color: #9ca3af;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trace-duration {
  color: #c0c4cc;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.trace-children {
  margin-left: 18px;
  padding-left: 8px;
  border-left: 1px solid #e5e7eb;
}

.trace-row.is-child .trace-label {
  color: #6b7280;
  word-break: break-all;
}

/* ===== 深度研究 DAG 图 ===== */
.dag-scroll {
  overflow-x: auto;
  padding: 6px 10px 10px 10px;
}

.dag-content {
  position: relative;
  display: inline-block;
  min-width: 100%;
}

.dag-edges {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 0;
}

.dag-edge {
  fill: none;
  stroke: #d1d5db;
  stroke-width: 1.5;
}

.dag-layers {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: stretch;
  gap: 22px;
}

.dag-layer {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
  min-width: 150px;
  max-width: 220px;
}

.dag-layer-title {
  color: #9ca3af;
  font-size: 10px;
  letter-spacing: 0.04em;
  text-align: center;
}

.dag-node {
  padding: 6px 8px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.dag-node.is-running {
  border-color: #c7d2fe;
  background: #f8faff;
}

.dag-node.is-failed {
  border-color: #fecaca;
}

.dag-node-head {
  display: flex;
  align-items: baseline;
  gap: 5px;
}

.dag-node-label {
  color: #374151;
  font-weight: 500;
  word-break: break-all;
}

.dag-node-detail {
  margin-top: 2px;
  color: #9ca3af;
  font-size: 11px;
  word-break: break-all;
}

.dag-actions {
  margin-top: 5px;
  padding-top: 5px;
  border-top: 1px dashed #e5e7eb;
}

.dag-action {
  display: flex;
  align-items: baseline;
  gap: 5px;
  line-height: 1.5;
}

.dag-action + .dag-action {
  margin-top: 2px;
}

.dag-action-label {
  color: #6b7280;
  flex-shrink: 0;
}

.dag-action-detail {
  color: #c0c4cc;
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>