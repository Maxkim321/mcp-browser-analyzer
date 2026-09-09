<template>
  <div class="chat-container">
    <!-- 头部 -->
    <header class="chat-header">
      <div class="brand">
        <div class="logo">
          <img src="./assets/logo.png" alt="logo" />
        </div>
        <div class="brand-text">
          <h1 class="title">浏览器 AI 助手</h1>
          <div class="connection-status" :class="connectionStatus">
            <span class="status-dot"></span>
            <span class="status-text">{{ statusText }}</span>
          </div>
        </div>
      </div>
      <div class="header-actions">
        <button class="icon-btn" title="会话历史" @click="toggleHistoryList">
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
        </button>
        <button class="icon-btn" title="新会话" @click="startNewSession">
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
    </header>

    <!-- 会话历史下拉（F4 + F6：搜索/重命名） -->
    <div v-if="showHistoryList" class="history-panel">
      <div v-if="!sessionList.length" class="history-empty">暂无历史会话</div>
      <template v-else>
        <input
          v-model="historyKeyword"
          class="history-search"
          placeholder="搜索会话..."
          @keydown.stop
        />
        <div
          v-for="s in filteredSessions"
          :key="s.id"
          class="history-item"
          :class="{ active: s.id === sessionId }"
        >
          <template v-if="renamingId === s.id">
            <input
              v-model="renameDraft"
              class="history-rename-input"
              @click.stop
              @keydown.enter="confirmRename(s)"
              @keydown.esc="cancelRename"
              @blur="confirmRename(s)"
            />
          </template>
          <template v-else>
            <span class="history-title" @click="switchSession(s.id)">{{ s.title }}</span>
            <span class="history-time">{{ formatShortTime(s.updatedAt) }}</span>
            <button class="history-rename" title="重命名该会话" @click.stop="startRename(s)">
              ✏️
            </button>
            <button class="history-delete" title="删除该会话" @click.stop="deleteSession(s.id)">
              ×
            </button>
          </template>
        </div>
        <div class="history-clear" @click="clearAllSessions">清空全部历史</div>
      </template>
    </div>

    <!-- 消息列表 -->
    <main
      ref="messagesRef"
      class="chat-messages"
      @scroll="onMessagesScroll"
      @click="onMessagesClick"
    >
      <!-- 欢迎消息 -->
      <div v-if="messages.length === 0" class="welcome-message">
        <div class="welcome-icon">✨</div>
        <p class="welcome-text">欢迎使用浏览器 AI 助手</p>
        <p class="welcome-desc">我可以总结当前页面、回答基于页面内容的问题，并帮你分析页面性能。</p>
        <div class="welcome-tips">
          <div class="tip-item">💡 选中网页文字快速翻译 / 解释 / 改写</div>
          <div class="tip-item">🔍 输入问题做多页深度研究</div>
          <div class="tip-item">📊 一键提取页面表格 / 列表数据</div>
        </div>
      </div>

      <!-- 消息列表 -->
      <div
        v-for="(msg, index) in messages"
        :key="index"
        class="message-item"
        :class="{ 'user-message': msg.sender === 'user', 'ai-message': msg.sender === 'ai' }"
      >
        <div class="message-avatar">
          <span v-if="msg.sender === 'user'">我</span>
          <span v-else>AI</span>
        </div>
        <div class="message-body">
          <div class="message-meta">
            <span class="message-sender">{{ msg.sender === 'user' ? '我' : 'AI 助手' }}</span>
            <span class="message-time">{{ formatTime(msg.timestamp) }}</span>
            <button
              v-if="msg.type === 'text' && msg.sender === 'ai'"
              class="message-copy-button"
              @click="copyText(msg.content)"
              title="复制"
            >
              <svg
                viewBox="0 0 24 24"
                width="12"
                height="12"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              <span>复制</span>
            </button>
          </div>
          <!-- Agent 执行轨迹：随该条回答一起持久化，刷新后仍可回看做过哪些步骤 -->
          <AgentTrace v-if="msg.trace && msg.trace.length" :nodes="msg.trace" />
          <!-- Agent 执行轨迹（当前流式回答，实时追踪） -->
          <AgentTrace
            v-if="msg.streaming && traceNodes.length"
            :nodes="traceNodes"
            :active="traceActive"
          />
          <div
            class="message-bubble markdown-content"
            v-if="msg.type === 'text' && msg.sender === 'ai'"
            v-html="renderMarkdown(msg.content)"
          ></div>
          <div class="message-bubble" v-else-if="msg.type === 'text'">{{ msg.content }}</div>
          <div class="message-bubble selection-bubble" v-if="msg.type === 'selection'">
            <div class="selection-header">
              <span class="selection-action">📝 {{ msg.action }} · 选中内容</span>
            </div>
            <div class="selection-text">{{ msg.content }}</div>
          </div>
          <!-- M1-F8 深度研究：进度消息（灰色小字，最新一条替换显示） -->
          <div class="message-bubble progress-bubble" v-if="msg.type === 'progress'">
            <span class="spinner"></span>
            <span>{{ msg.content }}</span>
          </div>
          <!-- M1-F8 深度研究：HITL 询问卡片（继续/停止/自定义方向） -->
          <div class="message-bubble ask-bubble" v-if="msg.type === 'workflow_ask'">
            <p class="workflow-ask-question">{{ msg.question }}</p>
            <div v-if="msg.pending" class="workflow-ask-actions">
              <button
                v-for="opt in msg.options"
                :key="opt"
                class="workflow-ask-btn"
                :class="{ primary: opt === '继续研究' }"
                @click="answerWorkflowAsk(msg, opt)"
              >
                {{ opt }}
              </button>
              <input
                v-model="msg.customText"
                class="workflow-ask-input"
                placeholder="输入新的研究方向，回车确认..."
                @keydown.enter="answerWorkflowAsk(msg, msg.customText)"
              />
            </div>
            <p v-else class="workflow-ask-answered">已答复（{{ msg.answer }}），研究中...</p>
          </div>
          <div class="message-bubble perf-bubble" v-if="msg.type === 'performance'">
            <div class="performance-card">
              <h3 class="performance-title">📊 页面性能分析</h3>
              <div class="performance-details">
                <div class="detail-item">
                  <span class="detail-label">页面地址</span>
                  <span class="detail-value" :title="msg.data.url">{{
                    truncateUrl(msg.data.url)
                  }}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">加载时间</span>
                  <span class="detail-value highlight">{{ msg.data.loadTime }}ms</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">FCP</span>
                  <span class="detail-value highlight">{{ msg.data.fcp }}ms</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">LCP</span>
                  <span class="detail-value highlight">{{ msg.data.lcp }}ms</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 思考中 / 实时执行轨迹（仅在流式回答尚未开始前展示） -->
      <div v-if="(thinking || traceActive) && !streamingActive" class="message-item ai-message">
        <div class="message-avatar"><span>AI</span></div>
        <div class="message-body">
          <div class="message-meta">
            <span class="message-sender">AI 助手</span>
          </div>
          <!-- 初始思考动画（轨迹节点尚未到达时） -->
          <div v-if="!traceNodes.length" class="message-bubble thinking-bubble">
            <div class="thinking-indicator">
              <span class="thinking-dot"></span>
              <span class="thinking-dot"></span>
              <span class="thinking-dot"></span>
            </div>
            <p class="thinking-text">AI 助手正在思考...</p>
          </div>
          <!-- 实时轨迹 -->
          <AgentTrace v-if="traceNodes.length" :nodes="traceNodes" :active="traceActive" />
          <button v-if="traceNodes.length" class="stop-btn" @click="cancelAgentTask">
            ⏹ 停止生成
          </button>
        </div>
      </div>
    </main>

    <!-- 输入区域 -->
    <footer class="chat-input-area">
      <!-- 未贴底时显示：一键回到最新消息 -->
      <button v-if="!autoFollow" class="scroll-bottom-btn" title="回到最新" @click="scrollToBottom">
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <polyline points="19 12 12 19 5 12" />
        </svg>
      </button>

      <!-- 快捷动作工具栏 -->
      <div class="quick-actions">
        <button
          class="quick-action"
          @click="handleSummarize"
          :disabled="thinking"
          title="总结当前页面核心内容"
        >
          <span class="qa-icon">📄</span>
          <span class="qa-label">总结本页</span>
        </button>
        <button
          class="quick-action research"
          @click="handleResearch"
          :disabled="thinking || !inputText.trim()"
          title="基于输入的问题做多页深度研究，输出带来源的研究报告"
        >
          <span class="qa-icon">🔍</span>
          <span class="qa-label">深度研究</span>
        </button>
        <button
          class="quick-action extract"
          @click="handleExtract"
          :disabled="thinking"
          title="提取当前页面的表格/列表为 Markdown 和 CSV"
        >
          <span class="qa-icon">📊</span>
          <span class="qa-label">提取表格</span>
        </button>
      </div>

      <!-- 输入框：多行自适应，Enter 发送 / Shift+Enter 换行 -->
      <div class="input-row">
        <textarea
          ref="inputRef"
          v-model="inputText"
          rows="1"
          class="input-field"
          :placeholder="
            pendingSelection
              ? '基于选中内容提问，如：let 和 var 的区别'
              : '输入您的问题或指令...（Shift + Enter 换行）'
          "
          @input="autoResizeInput"
          @keydown.enter.exact.prevent="handleSendMessage"
        ></textarea>
        <button
          class="send-button"
          @click="handleSendMessage"
          :disabled="!inputText.trim() || thinking"
          title="发送"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { openOptions } from '@/utils/base'
import { renderMarkdown } from '@/utils/markdown'
import { getPrefs, addArticle, buildLLMConfigPayload } from '@/utils/prefs'
import AgentTrace from '@/components/AgentTrace.vue'
import { useAgentTrace, TRACE_STATUS } from '@/composables/useAgentTrace'

defineOptions({
  name: 'SidePanel',
})

const goOptions = () => openOptions()

// 状态
const messages = ref([])
const inputText = ref('')
const inputRef = ref(null)
// 划词「问问」：选中的文字作为上下文，用户输入问题后一并发送
const pendingSelection = ref('')
const thinking = ref(false)
const connectionStatus = ref('disconnected')
const statusText = ref('未连接')
let websocket = null
let reconnectTimer = null
const WS_URL = 'ws://localhost:9999'

// F4 会话持久化：chrome.storage.local 按 sessionId 存储（索引 + 消息）
const SESSION_INDEX_KEY = 'ba_sessions'
const MAX_SESSIONS = 10
const sessionId = ref('')
const sessionList = ref([])
const showHistoryList = ref(false)
let saveTimer = null

// dph-A Turn/Step 可观测：把离散的 agent_step / workflow_progress 事件
// 归约成结构化执行轨迹（原实现是单帧覆盖，回答出现后整块丢弃，无法回看）
const {
  nodes: traceNodes,
  active: traceActive,
  begin: beginTrace,
  reset: resetTrace,
  applyStep: applyTraceStep,
  applyWorkflow: applyTraceWorkflow,
  complete: completeTrace,
  snapshot: snapshotTrace,
} = useAgentTrace()

/**
 * Turn 收尾：轨迹收敛到终态后落到对应的 AI 消息上，随会话一起持久化。
 * 必须走 messages.value 里的元素（reactive proxy），持有外部普通对象引用改不动 UI。
 */
const finishTrace = (message, status = TRACE_STATUS.SUCCESS) => {
  completeTrace(status)
  if (message && traceNodes.value.length) {
    message.trace = snapshotTrace()
  }
  resetTrace()
}

/**
 * 执行中的轨迹挂在流式气泡上方渲染（而不是列表末尾）：
 * 流式回答一开始输出，轨迹若还留在末尾就会跑到回答下面，结束时又跳回上面。
 */
const streamingActive = computed(() => messages.value.some((m) => m.streaming))

// ===== 滚动跟随：贴底时自动跟随流式输出，用户上滑后交还控制权（仿豆包） =====
const messagesRef = ref(null)
const autoFollow = ref(true)
const BOTTOM_THRESHOLD = 40
// 自动滚动本身会触发 scroll 事件，用标记避免被误判成"用户上滑"
let autoScrolling = false

const isNearBottom = () => {
  const el = messagesRef.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD
}

const scrollToBottom = (behavior = 'smooth') => {
  const el = messagesRef.value
  if (!el) return
  autoScrolling = true
  el.scrollTo({ top: el.scrollHeight, behavior })
  autoFollow.value = true
  setTimeout(() => {
    autoScrolling = false
  }, 200)
}

const onMessagesScroll = () => {
  if (autoScrolling) return
  autoFollow.value = isNearBottom()
}

// 代码块复制：事件委托，从按钮所在 .code-block 里取 pre 的原文
const onMessagesClick = async (event) => {
  const btn = event.target.closest?.('.code-copy-btn')
  if (!btn) return
  const code = btn.closest('.code-block')?.querySelector('pre')?.textContent || ''
  try {
    await navigator.clipboard.writeText(code)
    btn.textContent = '已复制'
    setTimeout(() => {
      btn.textContent = '复制'
    }, 1500)
  } catch (error) {
    console.warn('Copy code failed:', error)
  }
}

// 输入框自适应高度（最多 6 行左右）
const INPUT_MAX_HEIGHT = 140
const autoResizeInput = () => {
  const el = inputRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, INPUT_MAX_HEIGHT)}px`
}

// 发送后重置高度
const resetInputHeight = () => {
  nextTick(() => {
    const el = inputRef.value
    if (el) el.style.height = 'auto'
  })
}

// 消息内容/思考状态变化时，只在跟随模式下滚到底
watch(
  [messages, thinking, traceNodes],
  () => {
    if (!autoFollow.value) return
    nextTick(() => scrollToBottom('auto'))
  },
  { deep: true }
)

const sendToolResponse = (type, requestId, payload = {}, message = '') => {
  if (!websocket || websocket.readyState !== WebSocket.OPEN) {
    return
  }
  websocket.send(
    JSON.stringify({
      type,
      requestId,
      payload,
      message,
    })
  )
}

// 查找当前未收尾的流式气泡（从尾部回溯，跳过进度等非流式消息）
// 深度研究会在报告流式输出后再推进度消息，只看最后一条会漏判
const findStreamingMessage = () => {
  for (let i = messages.value.length - 1; i >= 0; i--) {
    if (messages.value[i].streaming) return messages.value[i]
  }
  return null
}

// background 侧失败归因：service worker 未加载新代码 / 分支未命中时，
// sendMessage 会静默 resolve 为 undefined（而非 reject），只报"操作失败"会掩盖真因
const describeBackgroundFailure = (response, toolType) => {
  if (response && response.error) return response.error
  return `插件后台未响应 ${toolType}（可能运行的是旧版 service worker）：请到 chrome://extensions 点击扩展的「重新加载」，并查看 service worker 控制台是否报错`
}

// ===== F1 轻量 pageContext：{url, title, selection} 随 user_prompt 附带 =====
// selection 经 background→content-script 获取，带 800ms 超时兜底；任何失败都不阻塞主流程
const getPageContext = async () => {
  const ctx = { url: '', title: '', selection: '' }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab) {
      ctx.url = tab.url || ''
      ctx.title = tab.title || ''
    }
  } catch (e) {
    // 忽略：拿不到上下文时照常提问
  }
  try {
    const res = await Promise.race([
      chrome.runtime.sendMessage({ type: 'get_selection' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('get_selection timeout')), 800)),
    ])
    if (res && res.success && res.selection) {
      ctx.selection = res.selection
    }
  } catch (e) {
    // 忽略：content-script 未注入/超时均不影响提问
  }
  return ctx
}

// 最近一次发送的 action，用于 agent_response 完成后做后置处理（如 F5 文章索引）
let lastSentAction = ''

// 统一发送 user_prompt：附带 pageContext + F5 偏好（prefs）+ llmConfig + dph-B sessionId，返回是否成功发送
const sendPrompt = async (prompt, action) => {
  lastSentAction = action || ''
  const [pageContext, prefs, llmConfig] = await Promise.all([
    getPageContext(),
    getPrefs(),
    buildLLMConfigPayload(),
  ])
  if (!websocket || websocket.readyState !== WebSocket.OPEN) {
    return false
  }
  websocket.send(
    JSON.stringify({
      type: 'user_prompt',
      prompt,
      action,
      pageContext,
      prefs,
      llmConfig,
      sessionId: sessionId.value,
    })
  )
  return true
}

// F5-2 文章索引：总结本页成功后记录 {url,title,summary}，供 options 页检索回看
const recordArticleIndex = async (summary) => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab || !tab.url || !/^https?:/i.test(tab.url)) return
    await addArticle({
      url: tab.url,
      title: tab.title || '',
      summary: String(summary || '').slice(0, 300),
    })
  } catch (e) {
    // 索引失败不影响主流程
    void e
  }
}

// ===== F4 会话持久化 =====
const createSessionId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const loadSessionMessages = async (id) => {
  const { [`ba_session_${id}`]: data } = await chrome.storage.local.get(`ba_session_${id}`)
  return data && Array.isArray(data.messages) ? data.messages : []
}

// 保存当前会话（300ms 防抖，流式期间的增量不打断）
const persistSession = () => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(flushSession, 300)
}

const flushSession = async () => {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (!sessionId.value) return
  const snapshot = messages.value.map((m) => ({ ...m }))
  await chrome.storage.local.set({
    [`ba_session_${sessionId.value}`]: { id: sessionId.value, messages: snapshot },
  })
  await updateSessionIndex()
}

// 会话索引：最近 MAX_SESSIONS 个，标题取首条用户消息（F6：重命名后优先用 customTitle，不被自动标题覆盖）
const updateSessionIndex = async () => {
  const { [SESSION_INDEX_KEY]: sessions = [] } = await chrome.storage.local.get(SESSION_INDEX_KEY)
  const prev = sessions.find((s) => s.id === sessionId.value)
  const firstUserMsg = messages.value.find((m) => m.sender === 'user')
  const autoTitle = (firstUserMsg && firstUserMsg.content ? firstUserMsg.content : '新对话').slice(
    0,
    20
  )
  const entry = {
    id: sessionId.value,
    title: prev?.customTitle || autoTitle,
    customTitle: prev?.customTitle || '',
    updatedAt: Date.now(),
    msgCount: messages.value.length,
  }
  const next = [entry, ...sessions.filter((s) => s.id !== sessionId.value)].slice(0, MAX_SESSIONS)
  sessionList.value = next
  await chrome.storage.local.set({ [SESSION_INDEX_KEY]: next })
}

// 把 UI 消息转成 OpenAI 格式历史（重放给服务端重建上下文）
// selection 卡片（划词）转成 user 消息保留动作语义；performance 卡片不重放
const buildOpenAIHistory = (msgs) => {
  const history = []
  for (const m of msgs) {
    if (m.type === 'text' && m.sender === 'user' && m.content) {
      history.push({ role: 'user', content: m.content })
    } else if (m.type === 'selection' && m.content) {
      if (m.action === 'ask') {
        history.push({ role: 'user', content: `选中文字：${m.content}` })
      } else {
        const label = ACTION_LABELS[m.action] || ''
        history.push({
          role: 'user',
          content: label ? `请对以下选中的文字进行${label}：\n\n"""\n${m.content}\n"""` : m.content,
        })
      }
    } else if (m.type === 'text' && m.sender === 'ai' && m.content && !m.streaming) {
      history.push({ role: 'assistant', content: m.content })
    }
  }
  // 合并连续 user 消息（OpenAI 角色交替更规范）
  const merged = []
  for (const item of history) {
    const last = merged[merged.length - 1]
    if (last && last.role === item.role && item.role === 'user') {
      last.content = `${last.content}\n${item.content}`
    } else {
      merged.push({ ...item })
    }
  }
  return merged
}

// 重放持久化历史给服务端：每次 WS 重连服务端都是全新 Agent（内存历史为空），重放总是安全
const replayHistoryToServer = () => {
  if (!websocket || websocket.readyState !== WebSocket.OPEN) return
  const history = buildOpenAIHistory(messages.value)
  if (!history.length) return
  console.log('[Session] Replaying history to server:', history.length)
  websocket.send(JSON.stringify({ type: 'restore_session', history }))
}

// 打开侧边栏时恢复最近会话（记住的 sessionId 优先，否则取最近一个）
const restoreCurrentSession = async () => {
  const { [SESSION_INDEX_KEY]: sessions = [] } = await chrome.storage.local.get(SESSION_INDEX_KEY)
  const { ba_current_session: current } = await chrome.storage.local.get('ba_current_session')
  const targetId =
    current && sessions.some((s) => s.id === current)
      ? current
      : sessions[0]?.id || createSessionId()
  sessionId.value = targetId
  sessionList.value = sessions
  // 过滤上次关闭时可能中断的半条流式消息（streaming: true），避免恢复出残影
  messages.value = (await loadSessionMessages(targetId)).filter((m) => !m.streaming)
}

// 切换到指定历史会话
const switchSession = async (id) => {
  if (id === sessionId.value) {
    showHistoryList.value = false
    return
  }
  await flushSession()
  sessionId.value = id
  messages.value = (await loadSessionMessages(id)).filter((m) => !m.streaming)
  pendingSelection.value = ''
  showHistoryList.value = false
  autoFollow.value = true
  await chrome.storage.local.set({ ba_current_session: id })
  // 服务端内存 Agent 还挂着旧会话：先清空再重放新会话历史
  if (websocket && websocket.readyState === WebSocket.OPEN) {
    websocket.send(JSON.stringify({ type: 'clear_history' }))
  }
  replayHistoryToServer()
}

// 新建会话
const startNewSession = async () => {
  await flushSession()
  sessionId.value = createSessionId()
  messages.value = []
  pendingSelection.value = ''
  showHistoryList.value = false
  await chrome.storage.local.set({ ba_current_session: sessionId.value })
  await flushSession() // 建立新会话占位，保证索引立即可见
  if (websocket && websocket.readyState === WebSocket.OPEN) {
    websocket.send(JSON.stringify({ type: 'clear_history' }))
  }
  nextTick(() => inputRef.value?.focus())
}

// 删除单个会话
// 注意：删除当前会话时不能走 flushSession()（会把已删 id 的索引/消息重新写回 storage），必须手动切换
const deleteSession = async (id) => {
  if (id === sessionId.value && websocket && websocket.readyState === WebSocket.OPEN) {
    websocket.send(JSON.stringify({ type: 'clear_history' }))
  }
  const { [SESSION_INDEX_KEY]: sessions = [] } = await chrome.storage.local.get(SESSION_INDEX_KEY)
  const next = sessions.filter((s) => s.id !== id)
  await chrome.storage.local.set({ [SESSION_INDEX_KEY]: next })
  await chrome.storage.local.remove(`ba_session_${id}`)
  sessionList.value = next

  if (id === sessionId.value) {
    if (next.length > 0) {
      // 切到最近一个会话
      sessionId.value = next[0].id
      messages.value = (await loadSessionMessages(next[0].id)).filter((m) => !m.streaming)
      pendingSelection.value = ''
      await chrome.storage.local.set({ ba_current_session: next[0].id })
      replayHistoryToServer()
    } else {
      // 全部删空：新建空会话
      sessionId.value = createSessionId()
      messages.value = []
      pendingSelection.value = ''
      await chrome.storage.local.set({ ba_current_session: sessionId.value })
    }
    showHistoryList.value = false
  }
}

// 清空全部会话
const clearAllSessions = async () => {
  const { [SESSION_INDEX_KEY]: sessions = [] } = await chrome.storage.local.get(SESSION_INDEX_KEY)
  await chrome.storage.local.remove(sessions.map((s) => `ba_session_${s.id}`))
  await chrome.storage.local.remove(SESSION_INDEX_KEY)
  sessionList.value = []
  sessionId.value = createSessionId()
  messages.value = []
  pendingSelection.value = ''
  showHistoryList.value = false
  await chrome.storage.local.set({ ba_current_session: sessionId.value })
  if (websocket && websocket.readyState === WebSocket.OPEN) {
    websocket.send(JSON.stringify({ type: 'clear_history' }))
  }
}

const toggleHistoryList = () => {
  showHistoryList.value = !showHistoryList.value
}

// ===== F6 会话管理：搜索 + 重命名 =====
const historyKeyword = ref('')
const renamingId = ref('')
const renameDraft = ref('')

const filteredSessions = computed(() => {
  const kw = historyKeyword.value.trim().toLowerCase()
  if (!kw) return sessionList.value
  return sessionList.value.filter((s) => (s.title || '').toLowerCase().includes(kw))
})

const startRename = (s) => {
  renamingId.value = s.id
  renameDraft.value = s.title || ''
  // 下一帧聚焦输入框
  nextTick(() => {
    const input = document.querySelector('.history-rename-input')
    input?.focus()
    input?.select()
  })
}

const cancelRename = () => {
  renamingId.value = ''
  renameDraft.value = ''
}

// 重命名：写入索引 customTitle，下次 flush 时不被自动标题覆盖
const confirmRename = async (s) => {
  if (renamingId.value !== s.id) return
  const newTitle = renameDraft.value.trim().slice(0, 20)
  renamingId.value = ''
  renameDraft.value = ''
  if (!newTitle || newTitle === s.title) return

  const { [SESSION_INDEX_KEY]: sessions = [] } = await chrome.storage.local.get(SESSION_INDEX_KEY)
  const next = sessions.map((item) =>
    item.id === s.id ? { ...item, title: newTitle, customTitle: newTitle } : item
  )
  sessionList.value = next
  await chrome.storage.local.set({ [SESSION_INDEX_KEY]: next })
}

const formatShortTime = (ts) => {
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const truncateUrl = (url) => {
  if (!url) return ''
  try {
    const u = new URL(url)
    const path = u.pathname.length > 18 ? u.pathname.slice(0, 18) + '…' : u.pathname
    return `${u.hostname}${path}`
  } catch {
    return url.length > 30 ? url.slice(0, 30) + '…' : url
  }
}

const getActiveTab = async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tabs.length || !tabs[0].id) {
    throw new Error('No active tab found')
  }
  return tabs[0]
}

const waitForTabLoad = async (tabId, timeoutMs = 30000) => {
  const existingTab = await chrome.tabs.get(tabId)
  if (existingTab?.status === 'complete') {
    return existingTab
  }

  return new Promise((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(handleUpdated)
      clearTimeout(timer)
    }

    const finishResolve = (tab) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(tab)
    }

    const finishReject = (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }

    const handleUpdated = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        finishResolve(tab)
      }
    }

    chrome.tabs.onUpdated.addListener(handleUpdated)

    const timer = setTimeout(() => {
      finishReject(new Error('Tab load timeout'))
    }, timeoutMs)
  })
}

// dph-A 可取消：点击停止 → 通知服务端 abort 当前 agent 任务（fetch abort，立即生效）
const cancelAgentTask = () => {
  if (!websocket || websocket.readyState !== WebSocket.OPEN) return
  websocket.send(JSON.stringify({ type: 'cancel_request' }))
  messages.value.push({
    type: 'text',
    sender: 'user',
    content: '停止生成',
    timestamp: Date.now(),
  })
  persistSession()
}

// 格式化时间
const formatTime = (timestamp) => {
  const date = new Date(timestamp)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

// 复制选中原文（划词原文展示块）
const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text)
  } catch (error) {
    console.warn('Copy failed:', error)
  }
}

// 更新连接状态
const updateConnectionStatus = (status) => {
  connectionStatus.value = status
  switch (status) {
    case 'connected':
      statusText.value = '已连接'
      break
    case 'connecting':
      statusText.value = '连接中...'
      break
    case 'disconnected':
      statusText.value = '未连接'
      break
    case 'error':
      statusText.value = '连接失败'
      break
  }
}

// 连接 WebSocket
const connectWebSocket = () => {
  if (websocket && websocket.readyState === WebSocket.OPEN) {
    return
  }

  updateConnectionStatus('connecting')

  try {
    websocket = new WebSocket(WS_URL)

    websocket.onopen = () => {
      updateConnectionStatus('connected')
      // F4：每次重连服务端都是全新 Agent（内存历史为空），重放持久化历史重建上下文
      replayHistoryToServer()
      if (messages.value.length === 0) {
        messages.value.push({
          type: 'text',
          sender: 'ai',
          content: '连接成功！选中网页文字或点击"总结本页"即可开始，也可以直接问我问题。',
          timestamp: Date.now(),
        })
      }
    }

    websocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        console.log('WebSocket message received:', data)

        switch (data.type) {
          case 'token': {
            // 流式增量：打字机效果
            // 注意：必须从 messages.value 取元素（reactive proxy）再修改，
            // 不能持有外部普通对象引用直接改（不触发 Vue 响应式更新）
            thinking.value = false
            const lastMsg = findStreamingMessage()
            if (lastMsg) {
              lastMsg.content += data.content
            } else {
              messages.value.push({
                type: 'text',
                sender: 'ai',
                content: data.content,
                timestamp: Date.now(),
                streaming: true,
              })
            }
            break
          }

          case 'agent_response': {
            thinking.value = false
            // 用户主动停止时，正在 running 的节点要落 cancelled，
            // 否则轨迹会永久停在转圈状态，看起来像卡死
            const traceStatus = data.success
              ? TRACE_STATUS.SUCCESS
              : data.error === 'cancelled'
                ? TRACE_STATUS.CANCELLED
                : TRACE_STATUS.FAILED
            // 回溯查找流式气泡：不能只看最后一条。深度研究会在报告流式结束后
            // 再推一条 workflow_progress（"研究报告生成完毕"），若只看最后一条会误判为
            // "没有流式内容"而重新 push 一份完整报告，导致同一份报告显示两遍
            const lastStreamingMsg = findStreamingMessage()
            let finalContent = ''
            if (lastStreamingMsg) {
              // 流式已开始：用最终完整内容覆盖增量，防止分片丢失导致内容不全
              lastStreamingMsg.content = data.success
                ? data.content
                : `${lastStreamingMsg.content}\n\n错误: ${data.content || data.error || ''}`
              lastStreamingMsg.streaming = false
              finalContent = lastStreamingMsg.content
              finishTrace(lastStreamingMsg, traceStatus)
            } else if (data.success) {
              messages.value.push({
                type: 'text',
                sender: 'ai',
                content: data.content,
                timestamp: Date.now(),
              })
              finalContent = data.content
              finishTrace(messages.value[messages.value.length - 1], traceStatus)
            } else {
              messages.value.push({
                type: 'text',
                sender: 'ai',
                content: `错误: ${data.content}`,
                timestamp: Date.now(),
              })
              finishTrace(messages.value[messages.value.length - 1], traceStatus)
            }
            // F5-2 文章索引：总结本页成功后自动记录当前页
            if (data.success && lastSentAction === 'summarize' && finalContent) {
              recordArticleIndex(finalContent)
            }
            lastSentAction = ''
            persistSession()
            break
          }

          case 'performance_data':
            thinking.value = false
            messages.value.push({
              type: 'performance',
              sender: 'ai',
              data: data.payload,
              timestamp: Date.now(),
            })
            persistSession()
            break

          case 'thinking':
            thinking.value = true
            beginTrace()
            break

          // dph-A Turn/Step 执行模型：Agent 每完成一个 Step（推理/工具执行）推送事件，
          // 前端归约成轨迹节点而非单帧覆盖，用户可看到完整执行过程
          case 'agent_step':
            applyTraceStep(data)
            break

          case 'cancel_ack':
            // 取消已受理，等待 agent_response(已停止) 收尾
            break

          // M1-F8 深度研究：进度推送 → 归约进执行轨迹
          // 原实现把每条进度当消息 push，几十条进度会把对话流冲掉，
          // 且失败步骤需要靠 sticky 标记硬留痕；改由轨迹层做分层与状态标记
          case 'workflow_progress':
            thinking.value = false
            applyTraceWorkflow(data)
            break

          // M1-F8 深度研究：HITL 询问（暂停等待用户答复）
          case 'workflow_ask':
            thinking.value = false
            messages.value.push({
              type: 'workflow_ask',
              sender: 'ai',
              taskId: data.taskId,
              question: data.question,
              options: data.options || ['继续研究', '停止研究'],
              pending: true,
              answer: '',
              customText: '',
              timestamp: Date.now(),
            })
            persistSession()
            break

          // M1-F8 深度研究：读取指定 URL（经 background 后台开 tab，不打扰当前页面）
          case 'fetch_url':
            chrome.runtime
              .sendMessage({
                type: 'fetch_url',
                requestId: data.requestId,
                url: data.url,
                maxChars: data.maxChars,
              })
              .then((response) => {
                if (response?.success && response.payload) {
                  sendToolResponse(
                    'fetch_url_result',
                    data.requestId,
                    response.payload,
                    'Fetch url completed'
                  )
                } else {
                  const err = describeBackgroundFailure(response, 'fetch_url')
                  sendToolResponse('fetch_url_result', data.requestId, { error: err }, err)
                }
              })
              .catch((error) => {
                console.error('Error fetching url:', error)
                sendToolResponse(
                  'fetch_url_result',
                  data.requestId,
                  { error: error.message },
                  error.message
                )
              })
            break

          // M1-F8 深度研究：浏览器内搜索，返回真实结果链接
          case 'web_search':
            chrome.runtime
              .sendMessage({
                type: 'web_search',
                requestId: data.requestId,
                query: data.query,
                maxResults: data.maxResults,
              })
              .then((response) => {
                if (response?.success && response.payload) {
                  sendToolResponse(
                    'web_search_result',
                    data.requestId,
                    response.payload,
                    'Web search completed'
                  )
                } else {
                  const err = describeBackgroundFailure(response, 'web_search')
                  sendToolResponse('web_search_result', data.requestId, { error: err }, err)
                }
              })
              .catch((error) => {
                console.error('Error searching web:', error)
                sendToolResponse(
                  'web_search_result',
                  data.requestId,
                  { error: error.message },
                  error.message
                )
              })
            break

          case 'welcome':
            messages.value.push({
              type: 'text',
              sender: 'ai',
              content: data.message,
              timestamp: Date.now(),
            })
            break

          case 'get_performance':
            // 收到获取性能数据的指令，向content-script发送请求
            chrome.runtime
              .sendMessage({
                type: 'get_performance',
                requestId: data.requestId,
              })
              .then((response) => {
                console.log('Performance data received:', response)
                if (response.success && response.payload) {
                  sendToolResponse(
                    'performance_data',
                    data.requestId,
                    response.payload,
                    'Performance data collected'
                  )
                } else {
                  sendToolResponse(
                    'performance_data',
                    data.requestId,
                    {
                      error: response?.error || 'Failed to collect performance data',
                    },
                    response?.error || 'Failed to collect performance data'
                  )
                }
              })
              .catch((error) => {
                console.error('Error getting performance data:', error)
                sendToolResponse(
                  'performance_data',
                  data.requestId,
                  {
                    error: error.message,
                  },
                  error.message
                )
              })
            break

          case 'get_page_content':
            // 收到获取页面正文的指令，经 background 转发到 content-script
            chrome.runtime
              .sendMessage({
                type: 'get_page_content',
                requestId: data.requestId,
                maxChars: data.maxChars,
              })
              .then((response) => {
                console.log('Page content received:', response)
                if (response.success && response.payload) {
                  sendToolResponse(
                    'page_content',
                    data.requestId,
                    response.payload,
                    'Page content collected'
                  )
                } else {
                  sendToolResponse(
                    'page_content',
                    data.requestId,
                    {
                      error: response?.error || 'Failed to get page content',
                    },
                    response?.error || 'Failed to get page content'
                  )
                }
              })
              .catch((error) => {
                console.error('Error getting page content:', error)
                sendToolResponse(
                  'page_content',
                  data.requestId,
                  {
                    error: error.message,
                  },
                  error.message
                )
              })
            break

          case 'navigate_to':
            ;(async () => {
              try {
                const tab = await getActiveTab()
                const updatedTab = await chrome.tabs.update(tab.id, { url: data.url })
                const loadedTab = await waitForTabLoad(updatedTab.id, 60000)
                sendToolResponse(
                  'navigate_to_result',
                  data.requestId,
                  {
                    tabId: loadedTab.id,
                    url: loadedTab.url,
                    status: loadedTab.status,
                  },
                  `Navigated to ${loadedTab.url}`
                )
              } catch (error) {
                console.error('Navigate failed:', error)
                sendToolResponse(
                  'navigate_to_result',
                  data.requestId,
                  {
                    error: error.message,
                  },
                  error.message
                )
              }
            })()
            break

          case 'reload_page':
            ;(async () => {
              try {
                const tab = await getActiveTab()
                await chrome.tabs.reload(tab.id, { bypassCache: !!data.ignoreCache })
                sendToolResponse(
                  'reload_result',
                  data.requestId,
                  {
                    tabId: tab.id,
                    ignoreCache: !!data.ignoreCache,
                  },
                  'Reload requested'
                )
              } catch (error) {
                console.error('Reload failed:', error)
                sendToolResponse(
                  'reload_result',
                  data.requestId,
                  {
                    error: error.message,
                  },
                  error.message
                )
              }
            })()
            break

          case 'wait_for_load':
            ;(async () => {
              try {
                const tab = await getActiveTab()
                const loadedTab = await waitForTabLoad(tab.id, data.timeout || 30000)
                sendToolResponse(
                  'wait_for_load_result',
                  data.requestId,
                  {
                    tabId: loadedTab.id,
                    url: loadedTab.url,
                    status: loadedTab.status,
                  },
                  'Page load completed'
                )
              } catch (error) {
                console.error('Wait for load failed:', error)
                sendToolResponse(
                  'wait_for_load_result',
                  data.requestId,
                  {
                    error: error.message,
                  },
                  error.message
                )
              }
            })()
            break

          default:
            console.warn('Unknown message type:', data.type)
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error)
      }
    }

    websocket.onerror = (error) => {
      console.error('WebSocket error:', error)
      updateConnectionStatus('error')
    }

    websocket.onclose = () => {
      console.log('WebSocket closed')
      updateConnectionStatus('disconnected')
      scheduleReconnect()
    }
  } catch (error) {
    console.error('WebSocket connection failed:', error)
    updateConnectionStatus('error')
    scheduleReconnect()
  }
}

// 定时重连
const scheduleReconnect = () => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
  }
  reconnectTimer = setTimeout(() => {
    console.log('Attempting to reconnect...')
    connectWebSocket()
  }, 3000)
}

// 发送消息
const handleSendMessage = async () => {
  if (!inputText.value.trim() || thinking.value) {
    return
  }

  const text = inputText.value.trim()

  // 划词「问问」：有选中上下文时，把问题和选中文字一起发送
  let prompt = text
  let action = undefined
  if (pendingSelection.value) {
    prompt = `选中文字："""\n${pendingSelection.value}\n"""\n\n我的问题：${text}`
    action = 'ask'
    pendingSelection.value = ''
  }

  messages.value.push({
    type: 'text',
    sender: 'user',
    content: text,
    timestamp: Date.now(),
  })
  persistSession()

  inputText.value = ''
  resetInputHeight()
  thinking.value = true

  // 发送消息到服务端（附带 F1 轻量 pageContext）
  const ok = await sendPrompt(prompt, action)
  if (!ok) {
    thinking.value = false
    messages.value.push({
      type: 'text',
      sender: 'ai',
      content: '连接已断开，请检查服务器是否正在运行。',
      timestamp: Date.now(),
    })
    persistSession()
  }
}

// M1-F8 深度研究：用户答复 HITL 询问（继续/停止/自定义方向）
const answerWorkflowAsk = (msg, answer) => {
  const text = String(answer || '').trim()
  if (!msg.pending || !text) return
  if (!websocket || websocket.readyState !== WebSocket.OPEN) return
  msg.pending = false
  msg.answer = text
  websocket.send(
    JSON.stringify({
      type: 'workflow_answer',
      taskId: msg.taskId,
      answer: text,
      cancel: text === '停止研究',
    })
  )
  persistSession()
}

// M1-F8 深度研究：以输入框内容为研究问题，显式触发深度研究工作流
const handleResearch = async () => {
  if (thinking.value) return
  const text = inputText.value.trim()
  if (!text) return

  messages.value.push({
    type: 'text',
    sender: 'user',
    content: text,
    timestamp: Date.now(),
  })
  persistSession()

  inputText.value = ''
  resetInputHeight()
  thinking.value = true

  const ok = await sendPrompt(text, 'research')
  if (!ok) {
    thinking.value = false
    messages.value.push({
      type: 'text',
      sender: 'ai',
      content: '连接已断开，请检查服务器是否正在运行。',
      timestamp: Date.now(),
    })
    persistSession()
  }
}

// 总结本页：携带 action 触发专用总结提示词
const handleSummarize = async () => {
  if (thinking.value) {
    return
  }

  messages.value.push({
    type: 'text',
    sender: 'user',
    content: '总结当前页面内容',
    timestamp: Date.now(),
  })
  persistSession()
  thinking.value = true

  const ok = await sendPrompt('请总结当前页面内容', 'summarize')
  if (!ok) {
    thinking.value = false
    messages.value.push({
      type: 'text',
      sender: 'ai',
      content: '连接已断开，请检查服务器是否正在运行。',
      timestamp: Date.now(),
    })
    persistSession()
  }
}

// 提取表格/列表：F7 结构化提取，action 触发 EXTRACT_PROMPT
const handleExtract = async () => {
  if (thinking.value) {
    return
  }

  messages.value.push({
    type: 'text',
    sender: 'user',
    content: '提取当前页面的结构化数据',
    timestamp: Date.now(),
  })
  persistSession()
  thinking.value = true

  const ok = await sendPrompt('请提取当前页面的表格/列表数据', 'extract')
  if (!ok) {
    thinking.value = false
    messages.value.push({
      type: 'text',
      sender: 'ai',
      content: '连接已断开，请检查服务器是否正在运行。',
      timestamp: Date.now(),
    })
    persistSession()
  }
}

// 划词动作标签映射
const ACTION_LABELS = {
  translate: '翻译',
  summarize_selection: '总结',
  explain: '解释',
  rewrite: '改写',
  ask: '问问',
}

// 划词即问：接收 content-script 经 background 转发的选中文本，触发对应动作
const processedActionIds = new Set()
const handleTextAction = async (payload) => {
  // 广播与 storage 兜底可能同时触发同一条，靠 id 去重
  if (!payload || !payload.id || processedActionIds.has(payload.id)) return
  processedActionIds.add(payload.id)
  if (processedActionIds.size > 50) {
    processedActionIds.clear()
  }

  const action = ACTION_LABELS[payload.action] ? payload.action : 'explain'
  const label = ACTION_LABELS[action]
  const text = String(payload.text || '').slice(0, 2000)

  messages.value.push({
    type: 'selection',
    sender: 'user',
    action: label,
    content: text,
    timestamp: Date.now(),
  })
  persistSession()

  // 「问问」：不直接发送，选中文字作为上下文，聚焦输入框等用户输入问题
  if (action === 'ask') {
    pendingSelection.value = text
    inputText.value = ''
    nextTick(() => inputRef.value?.focus())
    return
  }

  thinking.value = true
  const ok = await sendPrompt(`请对以下选中的文字进行${label}：\n\n"""\n${text}\n"""`, action)
  if (!ok) {
    thinking.value = false
    messages.value.push({
      type: 'text',
      sender: 'ai',
      content: '连接已断开，请检查服务器是否正在运行。',
      timestamp: Date.now(),
    })
    persistSession()
  }
}

// 页面加载完成后连接
const onRuntimeMessage = (request) => {
  if (request.type === 'text_action_relay') {
    handleTextAction(request)
    // 广播已成功到达，清掉 storage 里同一条，避免下次打开侧边栏重复触发
    chrome.storage.session.remove('pendingTextAction').catch(() => void 0)
  }
}

onMounted(async () => {
  // F4：先恢复最近会话（UI + 后续 WS onopen 时重放给服务端）
  await restoreCurrentSession()
  nextTick(() => scrollToBottom('auto'))
  connectWebSocket()
  chrome.runtime.onMessage.addListener(onRuntimeMessage)
  // 兜底：sidepanel 刚打开时可能错过广播（监听器未就绪），从 storage.session 补取
  chrome.storage.session
    .get('pendingTextAction')
    .then(({ pendingTextAction }) => {
      if (pendingTextAction) {
        handleTextAction(pendingTextAction)
        chrome.storage.session.remove('pendingTextAction')
      }
    })
    .catch(() => void 0)
})

// 清理资源
onUnmounted(() => {
  chrome.runtime.onMessage.removeListener(onRuntimeMessage)
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
  }
  if (saveTimer) {
    clearTimeout(saveTimer)
  }
  // 关闭前把最后一次状态落盘
  flushSession()
  if (websocket) {
    websocket.close()
  }
})
</script>

<style scoped>
/* ===== 基础 ===== */
*,
*::before,
*::after {
  box-sizing: border-box;
}

.chat-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100%;
  min-width: 0;
  background: linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%);
  color: #0f172a;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB',
    'Microsoft YaHei', sans-serif;
  position: relative;
  overflow: hidden;
}

/* ===== 头部 ===== */
.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: saturate(180%) blur(10px);
  -webkit-backdrop-filter: saturate(180%) blur(10px);
  border-bottom: 1px solid rgba(15, 23, 42, 0.06);
  flex-shrink: 0;
  min-height: 56px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.logo {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
  background: #f1f5f9;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
}

.logo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.brand-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.connection-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: #64748b;
  line-height: 1;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #cbd5e1;
  transition: background 0.2s;
}

.connection-status.connected .status-dot {
  background: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.18);
  animation: pulse-dot 2s infinite;
}

.connection-status.connecting .status-dot {
  background: #f59e0b;
  animation: pulse-dot 1.2s infinite;
}

.connection-status.disconnected .status-dot,
.connection-status.error .status-dot {
  background: #ef4444;
}

.connection-status.connected {
  color: #047857;
}
.connection-status.connecting {
  color: #b45309;
}
.connection-status.disconnected,
.connection-status.error {
  color: #b91c1c;
}

@keyframes pulse-dot {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.5);
  }
  50% {
    box-shadow: 0 0 0 4px rgba(16, 185, 129, 0);
  }
}

.header-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.icon-btn {
  width: 32px;
  height: 32px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: #475569;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background-color 0.15s,
    border-color 0.15s,
    color 0.15s;
}

.icon-btn:hover {
  background: #f1f5f9;
  color: #0f172a;
  border-color: #e2e8f0;
}

.icon-btn:active {
  background: #e2e8f0;
}

/* ===== 会话历史面板 ===== */
.history-panel {
  position: absolute;
  top: 60px;
  right: 8px;
  left: 8px;
  z-index: 100;
  max-height: 60vh;
  overflow-y: auto;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  box-shadow:
    0 4px 6px rgba(15, 23, 42, 0.05),
    0 12px 24px rgba(15, 23, 42, 0.1);
  padding: 8px;
  animation: panelFade 0.15s ease;
}

@keyframes panelFade {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.history-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.15s;
}

.history-item:hover {
  background: #f1f5f9;
}

.history-item.active {
  background: #eff6ff;
}

.history-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: #0f172a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-time {
  font-size: 11px;
  color: #94a3b8;
  flex-shrink: 0;
}

.history-empty {
  padding: 24px 16px;
  text-align: center;
  font-size: 13px;
  color: #94a3b8;
}

.history-search {
  width: 100%;
  margin-bottom: 6px;
  padding: 7px 10px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
}

.history-search:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.history-rename,
.history-delete {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: all 0.15s;
}

.history-item:hover .history-rename,
.history-item:hover .history-delete {
  opacity: 1;
}

.history-rename:hover {
  background: #e0e7ff;
  color: #4f46e5;
}

.history-delete:hover {
  background: #fee2e2;
  color: #dc2626;
}

.history-rename-input {
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid #3b82f6;
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  background: #fff;
}

.history-clear {
  margin-top: 4px;
  padding: 8px;
  text-align: center;
  font-size: 12px;
  color: #dc2626;
  border-radius: 8px;
  cursor: pointer;
  border-top: 1px solid #f1f5f9;
  transition: background-color 0.15s;
}

.history-clear:hover {
  background: #fef2f2;
}

/* ===== 消息区域 ===== */
.chat-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overscroll-behavior: contain;
}

/* ===== 欢迎消息 ===== */
.welcome-message {
  margin: 8px 4px;
  padding: 24px 18px;
  text-align: center;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.welcome-icon {
  font-size: 32px;
  margin-bottom: 8px;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.06));
}

.welcome-text {
  font-size: 15px;
  font-weight: 600;
  color: #0f172a;
  margin: 0 0 4px;
}

.welcome-desc {
  font-size: 12.5px;
  color: #64748b;
  margin: 0 0 14px;
  line-height: 1.5;
}

.welcome-tips {
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
}

.tip-item {
  font-size: 12px;
  color: #475569;
  padding: 7px 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  line-height: 1.5;
}

/* ===== 消息项 ===== */
.message-item {
  display: flex;
  gap: 8px;
  width: 100%;
  min-width: 0;
  animation: messageSlideIn 0.25s ease;
}

@keyframes messageSlideIn {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.message-item.user-message {
  align-self: flex-end;
  flex-direction: row-reverse;
}

.message-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
  box-shadow: 0 1px 3px rgba(79, 70, 229, 0.25);
}

.message-item.user-message .message-avatar {
  background: linear-gradient(135deg, #64748b 0%, #475569 100%);
  box-shadow: 0 1px 3px rgba(71, 85, 105, 0.25);
}

.message-body {
  flex: 1;
  min-width: 0;
  max-width: calc(100% - 40px);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.message-item.user-message .message-body {
  align-items: flex-end;
}

.message-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 2px;
}

.message-sender {
  font-size: 12px;
  font-weight: 600;
  color: #475569;
  letter-spacing: 0.01em;
}

.message-time {
  font-size: 11px;
  color: #94a3b8;
}

.message-copy-button {
  margin-left: auto;
  border: none;
  background: transparent;
  color: #94a3b8;
  font-size: 11px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border-radius: 4px;
  transition:
    color 0.15s,
    background-color 0.15s;
}

.message-copy-button:hover {
  color: #4f46e5;
  background: #eef2ff;
}

/* ===== 消息气泡 ===== */
.message-bubble {
  background: #ffffff;
  padding: 10px 12px;
  border-radius: 12px;
  font-size: 13.5px;
  line-height: 1.6;
  color: #0f172a;
  border: 1px solid #e2e8f0;
  word-wrap: break-word;
  overflow-wrap: break-word;
  max-width: 100%;
  min-width: 0;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.message-item.user-message .message-bubble {
  background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
  color: #ffffff;
  border-color: transparent;
  box-shadow: 0 2px 6px rgba(79, 70, 229, 0.2);
}

/* ===== Markdown 渲染内容（v-html 插入，需 :deep 生效） ===== */
.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4) {
  margin: 12px 0 6px;
  font-weight: 600;
  line-height: 1.4;
  color: #0f172a;
}

.markdown-content :deep(h1) {
  font-size: 17px;
}
.markdown-content :deep(h2) {
  font-size: 15.5px;
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 4px;
}
.markdown-content :deep(h3) {
  font-size: 14px;
}
.markdown-content :deep(h4) {
  font-size: 13.5px;
}

.markdown-content :deep(p) {
  margin: 6px 0;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin: 6px 0;
  padding-left: 22px;
}

.markdown-content :deep(li) {
  margin: 3px 0;
}

.markdown-content :deep(strong) {
  font-weight: 600;
  color: #0f172a;
}

.markdown-content :deep(code) {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 12px;
  padding: 1px 5px;
  background: rgba(15, 23, 42, 0.06);
  border-radius: 4px;
  word-break: break-all;
}

.markdown-content :deep(pre) {
  margin: 0;
  padding: 10px 12px;
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 0 0 8px 8px;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.5;
}

/* 代码块：顶部语言标签 + 复制按钮 */
.markdown-content :deep(.code-block) {
  margin: 8px 0;
  border-radius: 8px;
  overflow: hidden;
}

.markdown-content :deep(.code-block-bar) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  background: #1e293b;
  color: #94a3b8;
  font-size: 11px;
}

.markdown-content :deep(.code-lang) {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  text-transform: lowercase;
}

.markdown-content :deep(.code-copy-btn) {
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 5px;
  background: transparent;
  color: #cbd5e1;
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
  transition:
    background-color 0.15s,
    color 0.15s;
}

.markdown-content :deep(.code-copy-btn:hover) {
  background: rgba(148, 163, 184, 0.18);
  color: #ffffff;
}

.markdown-content :deep(pre code) {
  background: transparent;
  color: inherit;
  padding: 0;
  font-size: inherit;
}

.markdown-content :deep(blockquote) {
  margin: 8px 0;
  padding: 6px 10px;
  background: #f8fafc;
  border-left: 3px solid #6366f1;
  border-radius: 0 6px 6px 0;
  color: #475569;
  font-size: 13px;
}

.markdown-content :deep(a) {
  color: #4f46e5;
  text-decoration: none;
  word-break: break-all;
}

.markdown-content :deep(a:hover) {
  text-decoration: underline;
}

.markdown-content :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 8px 0;
  font-size: 12.5px;
  display: block;
  overflow-x: auto;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  border: 1px solid #e2e8f0;
  padding: 6px 8px;
  text-align: left;
}

.markdown-content :deep(th) {
  background: #f8fafc;
  font-weight: 600;
}

/* ===== 划词原文展示 ===== */
.selection-bubble {
  padding: 0;
  overflow: hidden;
}

.selection-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: #f1f5f9;
  border-bottom: 1px solid #e2e8f0;
}

.selection-action {
  font-size: 11.5px;
  color: #4f46e5;
  font-weight: 500;
}

.selection-text {
  padding: 8px 10px;
  font-size: 12.5px;
  color: #334155;
  line-height: 1.6;
  word-break: break-word;
  white-space: pre-wrap;
  max-height: 160px;
  overflow-y: auto;
  background: #fafbfc;
}

/* ===== M1-F8 深度研究：进度消息 ===== */
.progress-bubble {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 12px;
  color: #64748b;
  align-self: flex-start;
}

.spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid #cbd5e1;
  border-top-color: #6366f1;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ===== M1-F8 深度研究：HITL 询问卡片 ===== */
.ask-bubble {
  padding: 12px;
  background: #ffffff;
  border: 1px solid #c7d2fe;
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.08);
}

.workflow-ask-question {
  margin: 0 0 10px 0;
  font-size: 13px;
  line-height: 1.5;
  color: #1e1b4b;
  font-weight: 500;
}

.workflow-ask-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.workflow-ask-btn {
  padding: 5px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  background: #f8fafc;
  font-size: 12px;
  color: #475569;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.workflow-ask-btn:hover {
  background: #eef2ff;
  border-color: #c7d2fe;
  color: #4338ca;
}

.workflow-ask-btn.primary {
  background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
  border-color: transparent;
  color: #ffffff;
  box-shadow: 0 1px 3px rgba(79, 70, 229, 0.3);
}

.workflow-ask-btn.primary:hover {
  filter: brightness(1.1);
}

.workflow-ask-input {
  flex: 1;
  min-width: 120px;
  padding: 5px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  font-size: 12px;
  outline: none;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
  background: #ffffff;
}

.workflow-ask-input:focus {
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

.workflow-ask-answered {
  margin: 0;
  font-size: 12px;
  color: #16a34a;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* ===== 性能数据展示 ===== */
.perf-bubble {
  padding: 0;
  overflow: hidden;
  background: #ffffff;
  border: 1px solid #e2e8f0;
}

.performance-card {
  padding: 12px;
}

.performance-title {
  margin: 0 0 10px 0;
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
  display: flex;
  align-items: center;
  gap: 6px;
}

.performance-details {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  min-width: 0;
}

.detail-label {
  font-size: 11px;
  color: #64748b;
}

.detail-value {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
  word-break: break-all;
  overflow-wrap: anywhere;
}

.detail-value.highlight {
  color: #4f46e5;
}

/* ===== 思考中动画 ===== */
.thinking-bubble {
  display: inline-flex;
  flex-direction: column;
  gap: 4px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  padding: 10px 12px;
}

.thinking-indicator {
  display: flex;
  gap: 4px;
  align-items: center;
}

.thinking-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
  animation: thinkingAnimation 1.4s infinite ease-in-out both;
}

.thinking-dot:nth-child(2) {
  animation-delay: -0.32s;
}

.thinking-dot:nth-child(3) {
  animation-delay: -0.16s;
}

@keyframes thinkingAnimation {
  0%,
  80%,
  100% {
    opacity: 0.3;
    transform: scale(0.85);
  }
  40% {
    opacity: 1;
    transform: scale(1.1);
  }
}

.thinking-text {
  font-size: 12.5px;
  color: #64748b;
  margin: 0;
  line-height: 1.4;
}

.stop-btn {
  align-self: flex-start;
  margin-top: 4px;
  padding: 3px 10px;
  border: 1px solid #fecaca;
  border-radius: 6px;
  background: #fef2f2;
  color: #dc2626;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}

.stop-btn:hover {
  background: #fee2e2;
  border-color: #fca5a5;
}

/* ===== 输入区域 ===== */
.chat-input-area {
  position: relative;
  flex-shrink: 0;
  padding: 10px 12px 12px;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: saturate(180%) blur(10px);
  -webkit-backdrop-filter: saturate(180%) blur(10px);
  border-top: 1px solid rgba(15, 23, 42, 0.06);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 回到最新：悬浮在输入区上方 */
.scroll-bottom-btn {
  position: absolute;
  top: -40px;
  left: 50%;
  transform: translateX(-50%);
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  color: #475569;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.12);
  transition:
    background-color 0.15s,
    color 0.15s;
  z-index: 20;
}

.scroll-bottom-btn:hover {
  background: #eef2ff;
  color: #4338ca;
}

.quick-actions {
  display: flex;
  gap: 6px;
  width: 100%;
}

.quick-action {
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 4px;
  background: #f8fafc;
  color: #475569;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: all 0.15s;
}

.quick-action .qa-icon {
  font-size: 12px;
  flex-shrink: 0;
}

.quick-action .qa-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.quick-action:hover:not(:disabled) {
  background: #eef2ff;
  border-color: #c7d2fe;
  color: #4338ca;
  transform: translateY(-1px);
}

.quick-action:active:not(:disabled) {
  transform: translateY(0);
}

.quick-action:disabled {
  background: #f1f5f9;
  color: #94a3b8;
  border-color: #e2e8f0;
  cursor: not-allowed;
}

.quick-action.research:not(:disabled) {
  background: #f0fdf4;
  border-color: #bbf7d0;
  color: #15803d;
}

.quick-action.research:hover:not(:disabled) {
  background: #dcfce7;
  border-color: #86efac;
  color: #166534;
}

.quick-action.extract:not(:disabled) {
  background: #eff6ff;
  border-color: #bfdbfe;
  color: #1d4ed8;
}

.quick-action.extract:hover:not(:disabled) {
  background: #dbeafe;
  border-color: #93c5fd;
  color: #1e40af;
}

.input-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  width: 100%;
}

.input-field {
  flex: 1;
  min-width: 0;
  min-height: 36px;
  max-height: 140px;
  padding: 8px 14px;
  border: 1px solid #e2e8f0;
  border-radius: 18px;
  font-size: 13px;
  line-height: 1.5;
  font-family: inherit;
  background: #ffffff;
  color: #0f172a;
  outline: none;
  resize: none;
  overflow-y: auto;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}

.input-field::placeholder {
  color: #94a3b8;
}

.input-field:focus {
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

.send-button {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
  color: #ffffff;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  box-shadow: 0 2px 6px rgba(79, 70, 229, 0.25);
}

.send-button:hover:not(:disabled) {
  filter: brightness(1.1);
  transform: translateY(-1px);
  box-shadow: 0 4px 10px rgba(79, 70, 229, 0.35);
}

.send-button:active:not(:disabled) {
  transform: translateY(0);
}

.send-button:disabled {
  background: #cbd5e1;
  cursor: not-allowed;
  box-shadow: none;
}

/* ===== 滚动条 ===== */
.chat-messages::-webkit-scrollbar,
.history-panel::-webkit-scrollbar,
.selection-text::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.chat-messages::-webkit-scrollbar-track,
.history-panel::-webkit-scrollbar-track,
.selection-text::-webkit-scrollbar-track {
  background: transparent;
}

.chat-messages::-webkit-scrollbar-thumb,
.history-panel::-webkit-scrollbar-thumb,
.selection-text::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.4);
  border-radius: 3px;
  transition: background 0.15s;
}

.chat-messages::-webkit-scrollbar-thumb:hover,
.history-panel::-webkit-scrollbar-thumb:hover {
  background: rgba(148, 163, 184, 0.7);
}

/* Firefox */
.chat-messages,
.history-panel,
.selection-text {
  scrollbar-width: thin;
  scrollbar-color: rgba(148, 163, 184, 0.4) transparent;
}

/* ===== 极窄宽度适配（< 360px） ===== */
@media (max-width: 360px) {
  .chat-header {
    padding: 10px;
  }
  .title {
    font-size: 13px;
  }
  .logo {
    width: 28px;
    height: 28px;
  }
  .quick-action .qa-label {
    display: none;
  }
  .quick-action {
    padding: 7px 6px;
  }
  .quick-action .qa-icon {
    font-size: 14px;
  }
  .message-bubble {
    font-size: 13px;
  }
  .performance-details {
    grid-template-columns: 1fr;
  }
}
</style>
