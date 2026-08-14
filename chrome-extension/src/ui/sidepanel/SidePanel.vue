<template>
  <div class="chat-container">
    <!-- 头部 -->
    <div class="chat-header">
      <div class="logo">
        <img src="./assets/logo.png" alt="logo" />
      </div>
      <div class="header-info">
        <h1 class="title">浏览器 AI 助手</h1>
        <div class="connection-status">
          <span class="status-label">连接状态:</span>
          <span class="status-badge" :class="connectionStatus">{{ statusText }}</span>
        </div>
      </div>
      <!-- F4 会话持久化：历史切换 + 新会话 -->
      <div class="header-actions">
        <button class="header-btn" title="会话历史" @click="toggleHistoryList">🕘</button>
        <button class="header-btn" title="新会话" @click="startNewSession">＋</button>
      </div>
    </div>

    <!-- 会话历史下拉 -->
    <div v-if="showHistoryList" class="history-panel">
      <div v-if="!sessionList.length" class="history-empty">暂无历史会话</div>
      <div
        v-for="s in sessionList"
        :key="s.id"
        class="history-item"
        :class="{ active: s.id === sessionId }"
        @click="switchSession(s.id)"
      >
        <span class="history-title">{{ s.title }}</span>
        <span class="history-time">{{ formatShortTime(s.updatedAt) }}</span>
        <button class="history-delete" title="删除该会话" @click.stop="deleteSession(s.id)">
          ×
        </button>
      </div>
      <div v-if="sessionList.length" class="history-clear" @click="clearAllSessions">
        清空全部历史
      </div>
    </div>

    <!-- 消息列表 -->
    <div class="chat-messages">
      <!-- 欢迎消息 -->
      <div v-if="messages.length === 0" class="welcome-message">
        <p class="welcome-text">👋 欢迎使用浏览器 AI 助手</p>
        <p class="welcome-desc">我可以总结当前页面、回答基于页面内容的问题，以及分析页面性能。</p>
      </div>

      <!-- 消息列表 -->
      <div
        v-for="(msg, index) in messages"
        :key="index"
        class="message-item"
        :class="{ 'user-message': msg.sender === 'user', 'ai-message': msg.sender === 'ai' }"
      >
        <div class="message-avatar">
          {{ msg.sender === 'user' ? '👤' : '🤖' }}
        </div>
        <div class="message-content">
          <div class="message-sender">
            {{ msg.sender === 'user' ? '我' : 'AI 助手' }}
            <span class="message-time">{{ formatTime(msg.timestamp) }}</span>
            <button
              v-if="msg.type === 'text' && msg.sender === 'ai'"
              class="message-copy-button"
              @click="copyText(msg.content)"
            >
              复制
            </button>
          </div>
          <div
            class="message-text markdown-content"
            v-if="msg.type === 'text' && msg.sender === 'ai'"
            v-html="renderMarkdown(msg.content)"
          ></div>
          <div class="message-text" v-else-if="msg.type === 'text'">{{ msg.content }}</div>
          <div class="message-selection" v-if="msg.type === 'selection'">
            <div class="selection-header">
              <span class="selection-action">📝 {{ msg.action }} · 选中内容</span>
            </div>
            <div class="selection-text">{{ msg.content }}</div>
          </div>
          <div class="message-performance" v-if="msg.type === 'performance'">
            <div class="performance-card">
              <h3 class="performance-title">页面性能分析</h3>
              <div class="performance-details">
                <div class="detail-item">
                  <span class="detail-label">页面地址:</span>
                  <span class="detail-value">{{ msg.data.url }}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">加载时间:</span>
                  <span class="detail-value">{{ msg.data.loadTime }}ms</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">首次内容绘制(FCP):</span>
                  <span class="detail-value">{{ msg.data.fcp }}ms</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">最大内容绘制(LCP):</span>
                  <span class="detail-value">{{ msg.data.lcp }}ms</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 思考中动画 -->
      <div v-if="thinking" class="message-item ai-message">
        <div class="message-avatar">🤖</div>
        <div class="message-content">
          <div class="thinking-indicator">
            <span class="thinking-dot"></span>
            <span class="thinking-dot"></span>
            <span class="thinking-dot"></span>
          </div>
          <p class="thinking-text">AI 助手正在思考...</p>
        </div>
      </div>
    </div>

    <!-- 输入区域 -->
    <div class="chat-input">
      <button
        class="action-button"
        @click="handleSummarize"
        :disabled="thinking"
        title="总结当前页面核心内容"
      >
        📄 总结本页
      </button>
      <input
        ref="inputRef"
        v-model="inputText"
        type="text"
        class="input-field"
        :placeholder="
          pendingSelection ? '基于选中内容提问，如：let 和 var 的区别' : '输入您的问题或指令...'
        "
        @keydown.enter="handleSendMessage"
      />
      <button
        class="send-button"
        @click="handleSendMessage"
        :disabled="!inputText.trim() || thinking"
      >
        {{ thinking ? '发送中...' : '发送' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { openOptions } from '@/utils/base'
import { renderMarkdown } from '@/utils/markdown'

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

// 统一发送 user_prompt：附带 pageContext，返回是否成功发送
const sendPrompt = async (prompt, action) => {
  const pageContext = await getPageContext()
  if (!websocket || websocket.readyState !== WebSocket.OPEN) {
    return false
  }
  websocket.send(JSON.stringify({ type: 'user_prompt', prompt, action, pageContext }))
  return true
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

// 会话索引：最近 MAX_SESSIONS 个，标题取首条用户消息
const updateSessionIndex = async () => {
  const { [SESSION_INDEX_KEY]: sessions = [] } = await chrome.storage.local.get(SESSION_INDEX_KEY)
  const firstUserMsg = messages.value.find((m) => m.sender === 'user')
  const title = (firstUserMsg && firstUserMsg.content ? firstUserMsg.content : '新对话').slice(
    0,
    20
  )
  const entry = {
    id: sessionId.value,
    title,
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

const formatShortTime = (ts) => {
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
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

// 格式化时间
const formatTime = (timestamp) => {
  const date = new Date(timestamp)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
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
            const lastMsg = messages.value[messages.value.length - 1]
            if (lastMsg && lastMsg.streaming) {
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
            const lastStreamingMsg = messages.value[messages.value.length - 1]
            if (lastStreamingMsg && lastStreamingMsg.streaming) {
              // 流式已开始：用最终完整内容覆盖增量，防止分片丢失导致内容不全
              lastStreamingMsg.content = data.success
                ? data.content
                : `${lastStreamingMsg.content}\n\n错误: ${data.content || data.error || ''}`
              lastStreamingMsg.streaming = false
            } else if (data.success) {
              messages.value.push({
                type: 'text',
                sender: 'ai',
                content: data.content,
                timestamp: Date.now(),
              })
            } else {
              messages.value.push({
                type: 'text',
                sender: 'ai',
                content: `错误: ${data.content}`,
                timestamp: Date.now(),
              })
            }
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
.chat-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: #f7f9fc;
  position: relative;
}

/* 头部 */
.chat-header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  background-color: #ffffff;
  border-bottom: 1px solid #e1e8ed;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

/* F4 会话持久化：头部操作按钮 */
.header-actions {
  display: flex;
  gap: 6px;
  margin-left: 8px;
}

.header-btn {
  width: 32px;
  height: 32px;
  border: 1px solid #e1e8ed;
  border-radius: 8px;
  background: #f7f9fc;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  transition: background-color 0.2s;
}

.header-btn:hover {
  background: #edf2f7;
}

/* 会话历史下拉面板 */
.history-panel {
  position: absolute;
  top: 64px;
  right: 12px;
  z-index: 100;
  width: 260px;
  max-height: 320px;
  overflow-y: auto;
  background: #ffffff;
  border: 1px solid #e1e8ed;
  border-radius: 10px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
  padding: 6px;
}

.history-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
}

.history-item:hover {
  background: #f1f5f9;
}

.history-item.active {
  background: #ebf4ff;
}

.history-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: #1a1a1a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-time {
  font-size: 11px;
  color: #9ca3af;
  flex-shrink: 0;
}

.history-empty {
  padding: 16px;
  text-align: center;
  font-size: 13px;
  color: #9ca3af;
}

/* 历史项删除按钮 */
.history-delete {
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #9ca3af;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0;
  transition:
    opacity 0.15s,
    background-color 0.15s,
    color 0.15s;
}

.history-item:hover .history-delete {
  opacity: 1;
}

.history-delete:hover {
  background: #fee2e2;
  color: #dc2626;
}

/* 清空全部历史 */
.history-clear {
  margin-top: 4px;
  padding: 8px;
  text-align: center;
  font-size: 12px;
  color: #dc2626;
  border-radius: 8px;
  cursor: pointer;
  border-top: 1px solid #f1f5f9;
}

.history-clear:hover {
  background: #fef2f2;
}

.logo {
  width: 40px;
  height: 40px;
  margin-right: 16px;
}

.logo img {
  width: 100%;
  height: 100%;
}

.header-info {
  flex: 1;
}

.title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #1a1a1a;
  margin-bottom: 4px;
}

.connection-status {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-label {
  font-size: 12px;
  color: #6b7280;
}

.status-badge {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}

.status-badge.connected {
  background-color: #d1fae5;
  color: #065f46;
}

.status-badge.connecting {
  background-color: #fef3c7;
  color: #92400e;
}

.status-badge.disconnected {
  background-color: #fee2e2;
  color: #991b1b;
}

.status-badge.error {
  background-color: #fee2e2;
  color: #991b1b;
}

/* 消息区域 */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 欢迎消息 */
.welcome-message {
  text-align: center;
  padding: 40px 20px;
  background-color: #ffffff;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.welcome-text {
  font-size: 18px;
  font-weight: 600;
  color: #1a1a1a;
  margin-bottom: 8px;
}

.welcome-desc {
  font-size: 14px;
  color: #6b7280;
  margin: 0;
}

/* 消息项 */
.message-item {
  display: flex;
  gap: 12px;
  max-width: 80%;
  animation: messageSlideIn 0.3s ease;
}

@keyframes messageSlideIn {
  from {
    opacity: 0;
    transform: translateY(10px);
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
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background-color: #e1e8ed;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
}

.message-item.user-message .message-avatar {
  background-color: #4299e1;
  color: white;
}

.message-content {
  flex: 1;
  min-width: 0;
}

.message-sender {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.message-sender span:first-child {
  font-size: 14px;
  font-weight: 600;
  color: #1a1a1a;
}

.message-time {
  font-size: 12px;
  color: #9ca3af;
}

.message-text {
  background-color: #ffffff;
  padding: 12px 16px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.5;
  color: #1a1a1a;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.message-item.user-message .message-text {
  background-color: #4299e1;
  color: white;
}

.message-copy-button {
  margin-left: auto;
  border: none;
  background: transparent;
  color: #4299e1;
  font-size: 12px;
  cursor: pointer;
  padding: 0 4px;
}

.message-copy-button:hover {
  color: #2b6cb0;
}

/* Markdown 渲染内容样式（v-html 插入，需 :deep 生效） */
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4) {
  margin: 10px 0 6px;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
  color: #1a1a1a;
}

.markdown-content :deep(h2) {
  font-size: 16px;
  border-bottom: 1px solid #e1e8ed;
  padding-bottom: 4px;
}

.markdown-content :deep(p) {
  margin: 6px 0;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin: 6px 0;
  padding-left: 20px;
}

.markdown-content :deep(li) {
  margin: 4px 0;
}

.markdown-content :deep(strong) {
  font-weight: 600;
}

/* 划词原文展示块 */
.message-selection {
  margin-top: 4px;
  border: 1px solid #e1e8ed;
  border-radius: 8px;
  overflow: hidden;
  background: #f7fafc;
}

.selection-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  background: #edf2f7;
  border-bottom: 1px solid #e2e8f0;
}

.selection-action {
  font-size: 12px;
  color: #4a5568;
}

.selection-text {
  padding: 8px 10px;
  font-size: 13px;
  color: #2d3748;
  line-height: 1.6;
  word-break: break-all;
  white-space: pre-wrap;
  max-height: 160px;
  overflow-y: auto;
}

/* 性能数据展示 */
.message-performance {
  background-color: #ffffff;
  padding: 16px;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.performance-card {
  border: 1px solid #e1e8ed;
  border-radius: 8px;
  padding: 12px;
}

.performance-title {
  margin: 0 0 12px 0;
  font-size: 16px;
  font-weight: 600;
  color: #1a1a1a;
}

.performance-details {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-item {
  display: flex;
  justify-content: space-between;
  padding: 8px;
  background-color: #f7fafc;
  border-radius: 6px;
}

.detail-label {
  font-size: 13px;
  color: #6b7280;
}

.detail-value {
  font-size: 13px;
  font-weight: 600;
  color: #1a1a1a;
}

/* 输入区域 */
.chat-input {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  background-color: #ffffff;
  border-top: 1px solid #e1e8ed;
}

/* 快捷动作按钮（总结本页等） */
.action-button {
  padding: 10px 12px;
  background-color: #ebf4ff;
  color: #1e5fb4;
  border: 1px solid #b3d0f2;
  border-radius: 24px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color 0.2s,
    border-color 0.2s;
  white-space: nowrap;
}

.action-button:hover:not(:disabled) {
  background-color: #dbeafe;
  border-color: #7fb0e8;
}

.action-button:disabled {
  background-color: #f1f5f9;
  color: #9ca3af;
  border-color: #e2e8f0;
  cursor: not-allowed;
}

.input-field {
  flex: 1;
  padding: 12px 16px;
  border: 1px solid #d1d5db;
  border-radius: 24px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}

.input-field:focus {
  border-color: #4299e1;
  box-shadow: 0 0 0 3px rgba(66, 153, 225, 0.1);
}

.send-button {
  padding: 12px 24px;
  background-color: #4299e1;
  color: white;
  border: none;
  border-radius: 24px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s;
  white-space: nowrap;
}

.send-button:hover:not(:disabled) {
  background-color: #3182ce;
}

.send-button:disabled {
  background-color: #a0aec0;
  cursor: not-allowed;
}

/* 思考中动画 */
.thinking-indicator {
  display: flex;
  gap: 4px;
  padding: 8px;
}

.thinking-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #6b7280;
  animation: thinkingAnimation 1.4s infinite ease-in-out;
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
    transform: scale(1);
  }
  40% {
    opacity: 1;
    transform: scale(1.2);
  }
}

.thinking-text {
  font-size: 14px;
  color: #6b7280;
  margin: 0;
  padding: 8px;
}

/* 滚动条样式 */
.chat-messages::-webkit-scrollbar {
  width: 6px;
}

.chat-messages::-webkit-scrollbar-track {
  background: #f1f5f9;
  border-radius: 3px;
}

.chat-messages::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 3px;
}

.chat-messages::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}
</style>
