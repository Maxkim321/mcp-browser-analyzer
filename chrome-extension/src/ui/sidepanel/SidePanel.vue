<template>
  <div class="chat-container">
    <!-- 头部 -->
    <div class="chat-header">
      <div class="logo">
        <img src="./assets/logo.png" alt="logo" />
      </div>
      <div class="header-info">
        <h1 class="title">浏览器性能分析器</h1>
        <div class="connection-status">
          <span class="status-label">连接状态:</span>
          <span class="status-badge" :class="connectionStatus">{{ statusText }}</span>
        </div>
      </div>
    </div>

    <!-- 消息列表 -->
    <div class="chat-messages">
      <!-- 欢迎消息 -->
      <div v-if="messages.length === 0" class="welcome-message">
        <p class="welcome-text">👋 欢迎使用浏览器性能分析器</p>
        <p class="welcome-desc">连接成功后，我会自动采集页面性能数据并通过 AI 进行分析。</p>
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
          </div>
          <div class="message-text" v-if="msg.type === 'text'">
            {{ msg.content }}
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
      <input 
        v-model="inputText" 
        type="text" 
        class="input-field" 
        placeholder="输入您的问题或指令..."
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
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { openOptions } from '@/utils/base'

defineOptions({
  name: 'SidePanel',
})

const goOptions = () => openOptions()

// 状态
const messages = ref([])
const inputText = ref('')
const thinking = ref(false)
const connectionStatus = ref('disconnected')
const statusText = ref('未连接')
let websocket = null
let reconnectTimer = null
const WS_URL = 'ws://localhost:9999'

// 格式化时间
const formatTime = (timestamp) => {
  const date = new Date(timestamp)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
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
      messages.value.push({
        type: 'text',
        sender: 'ai',
        content: '连接成功！我已准备好为您提供性能分析服务。',
        timestamp: Date.now()
      })
    }

    websocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        console.log('WebSocket message received:', data)

        switch (data.type) {
          case 'agent_response':
            thinking.value = false
            if (data.success) {
              messages.value.push({
                type: 'text',
                sender: 'ai',
                content: data.content,
                timestamp: Date.now()
              })
            } else {
              messages.value.push({
                type: 'text',
                sender: 'ai',
                content: `错误: ${data.content}`,
                timestamp: Date.now()
              })
            }
            break

          case 'performance_data':
            thinking.value = false
            messages.value.push({
              type: 'performance',
              sender: 'ai',
              data: data.payload,
              timestamp: Date.now()
            })
            break

          case 'thinking':
            thinking.value = true
            break

          case 'welcome':
            messages.value.push({
              type: 'text',
              sender: 'ai',
              content: data.message,
              timestamp: Date.now()
            })
            break
            
          case 'get_performance':
            // 收到获取性能数据的指令，向content-script发送请求
            chrome.runtime.sendMessage({
              type: 'get_performance',
              requestId: data.requestId
            }).then(response => {
              console.log('Performance data received:', response)
              if (response.success && response.payload) {
                // 向agent-server发送性能数据
                if (websocket && websocket.readyState === WebSocket.OPEN) {
                  websocket.send(JSON.stringify({
                    type: 'performance_data',
                    requestId: data.requestId,
                    payload: response.payload
                  }))
                }
              }
            }).catch(error => {
              console.error('Error getting performance data:', error)
            })
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
const handleSendMessage = () => {
  if (!inputText.value.trim() || thinking.value) {
    return
  }

  const text = inputText.value.trim()
  messages.value.push({
    type: 'text',
    sender: 'user',
    content: text,
    timestamp: Date.now()
  })

  inputText.value = ''
  thinking.value = true

  // 发送消息到服务端
  if (websocket && websocket.readyState === WebSocket.OPEN) {
    websocket.send(JSON.stringify({
      type: 'user_prompt',
      prompt: text
    }))
  } else {
    thinking.value = false
    messages.value.push({
      type: 'text',
      sender: 'ai',
      content: '连接已断开，请检查服务器是否正在运行。',
      timestamp: Date.now()
    })
  }
}

// 页面加载完成后连接
onMounted(() => {
  connectWebSocket()
})

// 清理资源
onUnmounted(() => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
  }
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
  gap: 8px;
  padding: 16px;
  background-color: #ffffff;
  border-top: 1px solid #e1e8ed;
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
  0%, 80%, 100% {
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
