<!--
  Agent 执行轨迹面板

  把 useAgentTrace 归约出的节点树渲染为可折叠的时间线。

  两个渲染要点：
  1. 节点用稳定 id 作 key（非数组下标）。轨迹是流式增量产生的，用下标会让 Vue
     在插入节点时错位复用 DOM，导致状态图标和动画跳变。
  2. 执行中默认展开、结束后自动折叠。深度研究一次可产生数十个节点，
     结束后仍全量展开会把最终回答挤出视口。
-->
<template>
  <div v-if="nodes.length" class="agent-trace" :class="{ 'is-active': active }">
    <button class="trace-header" @click="expanded = !expanded">
      <span class="trace-caret" :class="{ open: expanded }">▸</span>
      <span v-if="active" class="trace-spinner"></span>
      <span class="trace-title">
        {{ active ? currentLabel || '执行中' : `执行轨迹 · ${nodes.length} 步` }}
      </span>
      <span v-if="active && elapsed" class="trace-elapsed">{{ elapsed }}</span>
    </button>

    <ul v-show="expanded" class="trace-list">
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
import { ref, computed, watch, onUnmounted } from 'vue'
import { TRACE_STATUS } from '@/composables/useAgentTrace'

const props = defineProps({
  nodes: { type: Array, default: () => [] },
  active: { type: Boolean, default: false },
})

const expanded = ref(true)

// 执行结束后自动折叠，避免长轨迹淹没最终回答
watch(
  () => props.active,
  (isActive, wasActive) => {
    if (isActive) expanded.value = true
    else if (wasActive) expanded.value = false
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

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

const startedAt = computed(() => (props.nodes.length ? props.nodes[0].startedAt : 0))

// 折叠态下的一行提示：优先显示正在执行的节点，否则显示最后一个节点
const currentLabel = computed(() => {
  const list = props.nodes
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].status === TRACE_STATUS.RUNNING) return list[i].label
  }
  return list.length ? list[list.length - 1].label : ''
})

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
</style>
