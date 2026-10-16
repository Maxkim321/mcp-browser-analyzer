<!--
  P10 能力可见性面板

  回答一个问题：这个 AI 助手背后到底有什么能力？
  内置工具、接入了哪些 MCP server、每个工具是读是写——全部来自服务端
  listCapabilities() 的运行时真实注册表快照（WS 拉取 + 注册完成广播），
  不硬编码任何工具文案：接了什么显示什么，没接就如实显示空。
-->
<template>
  <div class="capabilities-panel">
    <div v-if="!capabilities" class="cap-empty">未获取到能力清单（服务未连接或尚未同步）</div>
    <template v-else>
      <!-- 内置工具：扩展自带能力，随服务端注册表同步展示 -->
      <div class="cap-section-title">内置工具 · {{ capabilities.builtin.length }}</div>
      <div v-for="t in capabilities.builtin" :key="t.name" class="cap-tool">
        <span class="cap-tool-name">{{ t.name }}</span>
        <span class="cap-badge" :class="t.dangerLevel" :title="dangerTitle(t.dangerLevel)">{{
          dangerLabel(t.dangerLevel)
        }}</span>
        <span class="cap-tool-desc" :title="t.description">{{ t.description }}</span>
      </div>

      <!-- MCP server：按 server 分组，存活态 + 纳管工具清单 -->
      <div class="cap-section-title">MCP Server · {{ capabilities.mcpServers.length }}</div>
      <div v-if="!capabilities.mcpServers.length" class="cap-empty">
        尚未接入 MCP server——接入后面这里会列出它纳管的工具
      </div>
      <div v-for="s in capabilities.mcpServers" :key="s.name" class="cap-server">
        <div class="cap-server-head">
          <span class="cap-server-dot" :class="{ off: !s.alive }"></span>
          <span class="cap-server-name">{{ s.name }}</span>
          <span class="cap-server-count">{{ s.tools.length }} 个工具</span>
        </div>
        <div v-for="t in s.tools" :key="t.name" class="cap-tool is-mcp">
          <span class="cap-tool-name" :title="t.name">{{ shortName(t.name) }}</span>
          <span class="cap-badge" :class="t.dangerLevel" :title="dangerTitle(t.dangerLevel)">{{
            dangerLabel(t.dangerLevel)
          }}</span>
          <span class="cap-tool-desc" :title="t.description">{{ t.description }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
defineOptions({
  name: 'CapabilitiesPanel',
})

const props = defineProps({
  /** listCapabilities() 快照：{ builtin:[{name,description,dangerLevel}], mcpServers:[{name,alive,tools:[...]}] } */
  capabilities: { type: Object, default: null },
})

/** 定级徽章文案：与审批管线同一套口径（write 必走人审） */
const dangerLabel = (level) => (level === 'write' ? '写 · 需审批' : '读')
const dangerTitle = (level) =>
  level === 'write' ? '写操作：调用前会弹审批卡由你确认' : '只读操作：直接执行，不改任何状态'

/** MCP 工具名剥前缀：mcp_filesystem_write_file → write_file（完整名悬浮可见） */
const shortName = (name) => {
  const m = /^mcp_[a-z0-9_]+?_(.+)$/.exec(name || '')
  return m ? m[1] : name
}
</script>

<style scoped>
/* 下拉定位与 history/knowledge-panel 同一套模式（chat-container 为定位基准） */
.capabilities-panel {
  position: absolute;
  top: 60px;
  right: 8px;
  left: 8px;
  z-index: 100;
  max-height: 65vh;
  overflow-y: auto;
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow:
    0 4px 6px rgba(var(--ink-rgb), 0.05),
    0 12px 24px rgba(var(--ink-rgb), 0.1);
  padding: 10px;
  animation: capFade 0.15s ease;
}

@keyframes capFade {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.cap-section-title {
  font-size: 11px;
  color: var(--text-muted);
  padding: 4px 2px 6px;
  letter-spacing: 0.03em;
}

.cap-tool {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 6px;
  border-radius: 8px;
}

.cap-tool:hover {
  background: var(--surface);
}

.cap-tool.is-mcp {
  margin-left: 14px;
}

.cap-tool-name {
  font-size: 12px;
  color: var(--text-1);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 0;
  max-width: 45%;
}

/* 定级徽章：克隆 tier-badge 的 pill 形三件套（read=info / write=danger） */
.cap-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 10px;
  line-height: 1.6;
  white-space: nowrap;
  flex-shrink: 0;
}

.cap-badge.read {
  background: var(--info-soft);
  border: 1px solid var(--info-border);
  color: var(--info-strong);
}

.cap-badge.write {
  background: var(--danger-soft);
  border: 1px solid var(--danger-border);
  color: var(--danger-strong);
}

.cap-tool-desc {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cap-server {
  margin-bottom: 6px;
}

.cap-server-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
}

.cap-server-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success);
  flex-shrink: 0;
}

.cap-server-dot.off {
  background: var(--text-muted);
}

.cap-server-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-1);
}

.cap-server-count {
  font-size: 11px;
  color: var(--text-muted);
  margin-left: auto;
}

.cap-empty {
  padding: 14px 10px;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.6;
}
</style>
