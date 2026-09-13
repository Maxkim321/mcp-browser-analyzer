<template>
  <div class="chat-container" :data-theme="theme">
    <!-- 游戏风开屏：logo 演出 + 真实启动进度（挂载 → 会话恢复 → 服务连接） -->
    <Transition name="boot-fade">
      <div v-if="booting" class="boot-splash">
        <div class="boot-glow"></div>
        <div class="boot-logo-wrap">
          <img class="boot-logo" src="./assets/logo.png" alt="logo" />
        </div>
        <h1 class="boot-title">浏览器 AI 助手</h1>
        <div class="boot-progress">
          <div class="boot-progress-fill" :style="{ width: `${(bootStep / 3) * 100}%` }"></div>
        </div>
        <div class="boot-step">{{ bootStepLabel }}</div>
        <div class="boot-tip">{{ bootTip }}</div>
      </div>
    </Transition>

    <!-- 头部：名称交给浏览器原生侧边栏标题栏展示，这里只承载状态与操作 -->
    <header class="chat-header">
      <div class="brand">
        <div class="logo">
          <img src="./assets/logo.png" alt="logo" />
        </div>
        <div class="brand-text">
          <div class="connection-status" :class="connectionStatus">
            <span class="status-dot"></span>
            <span class="status-text">{{ statusText }}</span>
          </div>
        </div>
      </div>
      <div class="header-actions">
        <button
          class="icon-btn"
          :title="theme === 'dark' ? '切换到浅色' : '切换到深色'"
          @click="toggleTheme"
        >
          <!-- 太阳 / 月亮随主题切换 -->
          <svg
            v-if="theme === 'dark'"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="4" />
            <path
              d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32 1.41-1.41"
            />
          </svg>
          <svg
            v-else
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        </button>
        <button
          class="icon-btn"
          title="知识点"
          :class="{ 'has-badge': knowledgePendingCount > 0 }"
          @click="toggleKnowledgePanel"
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
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          <span v-if="knowledgePendingCount > 0" class="icon-badge">{{
            knowledgePendingCount
          }}</span>
        </button>
        <button
          class="icon-btn"
          title="会话历史"
          :class="{ active: showHistoryList }"
          @click="toggleHistoryList"
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

    <!-- 知识点面板（秋招随手记 / flashcard：收藏问题 + 异步补全答案 + 回顾） -->
    <div v-if="showKnowledgePanel" class="knowledge-panel">
      <!-- 手动添加 -->
      <div class="knowledge-add">
        <input
          v-model="newKnowledgeQuestion"
          class="knowledge-add-input"
          placeholder="记下你不懂的问题，回车保存..."
          @keydown.stop
          @keydown.enter="addKnowledgeManual"
        />
        <button
          class="knowledge-add-btn"
          :disabled="!newKnowledgeQuestion.trim()"
          @click="addKnowledgeManual"
        >
          存
        </button>
      </div>

      <!-- 列表：时间倒序，单张卡片点开可补全/回顾 -->
      <div v-if="!knowledgeList.length" class="knowledge-empty">
        还没有知识点。划词点「记笔记」、把 AI 回答收藏，或在上方手输问题。
      </div>
      <template v-else>
        <div
          v-for="kp in knowledgeList"
          :key="kp.id"
          class="knowledge-item"
          :class="[
            { 'knowledge-pending': kp.status === 'pending' },
            { expanded: expandedKnowledgeId === kp.id },
          ]"
          @click="openKnowledge(kp)"
        >
          <div class="knowledge-item-top">
            <span class="knowledge-question">{{ kp.question }}</span>
            <button
              class="knowledge-delete"
              title="删除该知识点"
              @click.stop="deleteKnowledge(kp.id)"
            >
              ×
            </button>
          </div>
          <div class="knowledge-meta">
            <span class="knowledge-status" :class="kp.status">
              {{ kp.status === 'pending' ? '待补全' : '已整理' }}
            </span>
            <span class="knowledge-time">{{ formatShortTime(kp.createdAt) }}</span>
            <span v-if="kp.source" class="knowledge-source">{{ kp.source }}</span>
          </div>
          <!-- done：markdown 渲染答案；折叠显示摘要，点开全文 -->
          <div
            v-if="kp.status === 'done'"
            class="knowledge-answer markdown-content"
            :class="{ collapsed: expandedKnowledgeId !== kp.id }"
            @click.stop
          >
            <div class="knowledge-answer-body" v-html="renderMarkdown(kp.answer)"></div>
          </div>
          <div v-else class="knowledge-hint">
            {{ completingId === kp.id ? '正在补全答案...' : '点击自动补全答案' }}
          </div>
          <!-- 复习闭环 TODO：后续在此追加「今日复习 / 遗忘曲线 / 间隔重复」能力 -->
        </div>
        <div class="knowledge-clear" @click="clearAllKnowledge">清空全部知识点</div>
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
            <!-- 档位 badge：本条回答实际生效的模型档位（分级路由从黑盒变可见） -->
            <span
              v-if="msg.sender === 'ai' && msg.type === 'text' && msg.tierMeta"
              class="tier-badge"
              :class="{ light: msg.tierMeta.tier === 'light' }"
              :title="`模型: ${msg.tierMeta.model || '未知'}`"
            >
              {{ msg.tierMeta.tier === 'light' ? '⚡ light 档' : '🧠 主模型' }}
            </span>
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
            <button
              v-if="msg.type === 'text' && msg.sender === 'ai' && !msg.streaming && msg.content"
              class="message-copy-button"
              @click="saveAiAnswerAsKnowledge(msg, $event)"
              title="收藏为知识点"
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
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              <span>收藏</span>
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
          <!-- P3 浏览记忆：本次回答参考了记忆库中的旧页面；悬浮展示"为什么命中"（BM25 分数 + 命中词） -->
          <div v-if="msg.memoryRefs && msg.memoryRefs.length" class="memory-refs">
            <span class="memory-refs-label"
              >📌 参考了你之前读过的 {{ msg.memoryRefs.length }} 篇</span
            >
            <span
              v-for="(refItem, ri) in msg.memoryRefs"
              :key="ri"
              class="memory-chip"
              :title="memoryRefTitle(refItem)"
              >《{{ refItem.title }}》</span
            >
          </div>
          <div
            class="message-bubble markdown-content"
            :class="{ streaming: msg.streaming }"
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
          <!-- dph-C 运行时压缩提示：压缩真实发生时冒一条（含视图 token 前后值），平时不占空间 -->
          <div class="message-bubble compress-bubble" v-if="msg.type === 'compress_notice'">
            <span>{{ msg.content }}</span>
          </div>
          <!-- M1-F8 深度研究：HITL 询问卡片（继续/停止/自定义方向）+ 打断证据 -->
          <div class="message-bubble ask-bubble" v-if="msg.type === 'workflow_ask'">
            <p class="workflow-ask-question">{{ msg.question }}</p>
            <!-- 打断证据：为什么打断（死胡同重试轨迹/预算用量）——证据决定用户信不信任打断 -->
            <div v-if="msg.evidence" class="ask-evidence">
              <div
                v-for="(line, li) in askEvidenceLines(msg.evidence)"
                :key="li"
                class="ask-evidence-item"
              >
                {{ line }}
              </div>
            </div>
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
          <!-- P4 分级权限 HITL：写操作审批卡片——AI 要动你的页面，先给你看清它要干什么 -->
          <div class="message-bubble ask-bubble" v-if="msg.type === 'write_approval'">
            <p class="workflow-ask-question">🔐 AI 请求执行写操作：{{ writeToolLabel(msg.tool) }}</p>
            <div class="ask-evidence">
              <div class="ask-evidence-item">目标：{{ msg.args?.selector }}</div>
              <div v-if="msg.args?.value" class="ask-evidence-item">内容：{{ msg.args.value }}</div>
              <div v-if="msg.args?.description" class="ask-evidence-item">说明：{{ msg.args.description }}</div>
            </div>
            <div v-if="msg.pending" class="workflow-ask-actions">
              <button class="workflow-ask-btn primary" @click="answerWriteApproval(msg, true)">
                允许执行
              </button>
              <button class="workflow-ask-btn" @click="answerWriteApproval(msg, false)">拒绝</button>
            </div>
            <p v-else class="workflow-ask-answered">
              {{ msg.approved ? '✅ 已放行' : '❌ 已拒绝' }}
            </p>
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

      <!-- 会话用量条：token/成本/light 占比实时可见（usage_summary 推送驱动） -->
      <UsageBar v-if="usageSummary" :session="usageSummary.session" :total="usageSummary.total" />

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
import {
  getPrefs,
  addArticle,
  buildLLMConfigPayload,
  getKnowledgePoints,
  addKnowledgePoint,
  updateKnowledgePoint,
  removeKnowledgePoint,
} from '@/utils/prefs'
import AgentTrace from '@/components/AgentTrace.vue'
import UsageBar from '@/components/UsageBar.vue'
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
// 会话用量条：服务端 usage_summary 推送驱动（token/成本/light 占比）
const usageSummary = ref(null)
// 压缩提示每回合最多一条：ReAct 多轮迭代可能每轮都触发压缩（每轮都真实发生、
// 轨迹里都留痕），但对话流里连冒 N 条会淹没正文——提示只报第一次，其余看轨迹
let compressNoticedThisTurn = false
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

// ===== 知识点卡片库（flashcard：收藏问题 + 异步补全答案 + 回顾） =====
const showKnowledgePanel = ref(false)
const knowledgeList = ref([])
const newKnowledgeQuestion = ref('')
const expandedKnowledgeId = ref('') // 展开到哪张（done 卡片看全文 / pending 卡片补全中）
const completingId = ref('') // 正在补全的卡片 id

// ===== 主题（默认跟随系统、深色兜底，手动切换后持久化） =====
const theme = ref('dark')
const THEME_KEY = 'sidepanel-theme'
const toggleTheme = () => {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  try {
    localStorage.setItem(THEME_KEY, theme.value)
  } catch {
    /* storage 不可用时主题仅本次生效 */
  }
}

// ===== 开屏（游戏风启动进度，进度条对接真实初始化事件） =====
// 步骤：1 UI 挂载完成 → 2 会话恢复 → 3 服务连接（成功或失败都放行，不卡开屏）
const booting = ref(true)
const bootStep = ref(0)
const BOOT_STARTED_AT = Date.now()
const BOOT_MIN_MS = 1400 // 开屏最短停留，动画不闪现
const BOOT_TIPS = [
  '💡 选中网页文字，划词即问',
  '🔍 输入问题，多页深度研究出带来源报告',
  '📊 一键提取页面表格 / 列表数据',
  '📌 AI 回答可收藏为知识点，随时回顾',
  '⌨️ Shift + Enter 换行，Enter 发送',
]
const bootTip = ref(BOOT_TIPS[Math.floor(Math.random() * BOOT_TIPS.length)])
const bootStepLabel = computed(
  () => ['正在初始化界面...', '正在恢复会话...', '正在连接服务...'][bootStep.value - 1] || ''
)
const advanceBoot = (n) => {
  if (bootStep.value >= n) return
  bootStep.value = n
  if (n >= 3) {
    // 最短停留时间保证演出完整；250ms 留给淡出过渡
    const wait = Math.max(0, BOOT_MIN_MS - (Date.now() - BOOT_STARTED_AT))
    setTimeout(() => {
      booting.value = false
    }, wait + 250)
  }
}
// 红点：待补全条数
const knowledgePendingCount = computed(
  () => knowledgeList.value.filter((kp) => kp.status === 'pending').length
)

// 取当前页面 URL 作为出处
const currentSourceUrl = async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    return tab?.url && /^https?:/i.test(tab.url) ? tab.url.slice(0, 80) : ''
  } catch {
    return ''
  }
}

const genKnowledgeId = () => `kp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const loadKnowledge = async () => {
  // 时间倒序（新在前）
  knowledgeList.value = (await getKnowledgePoints()).sort((a, b) => b.createdAt - a.createdAt)
}

const toggleKnowledgePanel = () => {
  showHistoryList.value = false
  showKnowledgePanel.value = !showKnowledgePanel.value
  if (showKnowledgePanel.value) {
    loadKnowledge()
  }
}

// 外部新增一条问题卡片（划词「记笔记」/ 手动输入），默认 pending 待补全
const createKnowledgeCard = async (question, source) => {
  const q = String(question || '')
    .trim()
    .slice(0, 500)
  if (!q) return
  const url = await currentSourceUrl()
  const kp = {
    id: genKnowledgeId(),
    question: q,
    answer: '',
    status: 'pending',
    createdAt: Date.now(),
    source: url ? `${source} · ${url}` : source,
  }
  await addKnowledgePoint(kp)
  await loadKnowledge()
  return kp
}

// 手动添加
const addKnowledgeManual = async () => {
  const kp = await createKnowledgeCard(newKnowledgeQuestion.value, '手输')
  if (kp) {
    newKnowledgeQuestion.value = ''
    expandedKnowledgeId.value = kp.id
  }
}

// 点开卡片：done 展开看全文；pending 触发自动补全
const openKnowledge = async (kp) => {
  if (kp.status === 'pending') {
    await completeKnowledge(kp)
  } else {
    expandedKnowledgeId.value = expandedKnowledgeId.value === kp.id ? '' : kp.id
  }
}

// 删除一张卡片
const deleteKnowledge = async (id) => {
  knowledgeList.value = knowledgeList.value.filter((kp) => kp.id !== id)
  await removeKnowledgePoint(id)
}

const clearAllKnowledge = async () => {
  if (!confirm('确认清空全部知识点？')) return
  knowledgeList.value = []
  await chrome.storage.local.set({ ba_knowledge_points: [] })
}

// 收藏 AI 回答为知识点：答案已经生成，直接 status='done'，问题取最近一条用户消息
const saveAiAnswerAsKnowledge = async (msg, ev) => {
  const content = String(msg.content || '').trim()
  if (!content) return
  let question = msg.content.slice(0, 40)
  for (let i = messages.value.length - 1; i >= 0; i--) {
    const m = messages.value[i]
    if (m.sender === 'user' && m.content) {
      question = m.content.slice(0, 500)
      break
    }
  }
  const url = await currentSourceUrl()
  const kp = {
    id: genKnowledgeId(),
    question,
    answer: content.slice(0, 2000),
    status: 'done',
    createdAt: Date.now(),
    source: url ? `AI 回答 · ${url}` : 'AI 回答',
  }
  await addKnowledgePoint(kp)
  await loadKnowledge()
  // 轻提示：收藏成功
  const btn = ev?.target?.closest?.('.message-copy-button')
  if (btn) {
    btn.textContent = '已收藏'
    setTimeout(() => {
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg><span>收藏</span>'
    }, 1500)
  }
}

// 补全 pending 卡片：走现有普通对话链路让 LLM 生成答案，写回卡片并标记 done
const completeKnowledge = async (kp) => {
  if (!kp || kp.status !== 'pending' || completingId.value) return
  if (!websocket || websocket.readyState !== WebSocket.OPEN) {
    alert('请先启动 agent 服务（pnpm run agent-server）再补全答案')
    return
  }
  completingId.value = kp.id
  expandedKnowledgeId.value = kp.id
  // 复用 sendPrompt 普通对话链路；用 lastSentAction 区分完成来源，避免污染文章索引等后置逻辑
  // 让用户在对话区也能看到这条问题的回答（复习时上下文连续）
  messages.value.push({
    type: 'text',
    sender: 'user',
    content: kp.question,
    timestamp: Date.now(),
  })
  persistSession()
  thinking.value = true
  const ok = await sendPrompt(kp.question, 'knowledge_complete')
  if (!ok) {
    thinking.value = false
    completingId.value = ''
    alert('连接已断开，请检查服务器是否正在运行。')
  }
}

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
  const snapshot = messages.value
    // P4 审批卡片是瞬态消息：服务端等待态不落盘——重放出的僵尸卡片 requestId 已死，
    // 用户会看到一个永远无法答复的按钮；审批只在会话内存态中生存
    .filter((m) => m.type !== 'write_approval')
    .map((m) => ({ ...m }))
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
  showKnowledgePanel.value = false
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

/**
 * 记忆引用悬浮文案：不止给来源，还给"为什么命中"（BM25 分数 + 命中词）——
 * 检索从"结果可见"升级为"理由可见"，不是黑箱记忆
 */
const memoryRefTitle = (refItem) => {
  if (!refItem) return ''
  const lines = [String(refItem.title || ''), String(refItem.url || '')]
  if (Number.isFinite(refItem.score)) {
    let scoreLine = `BM25 相关度 ${refItem.score}`
    if (refItem.matchedTerms?.length) scoreLine += ` · 命中：${refItem.matchedTerms.join(' / ')}`
    lines.push(scoreLine)
  }
  return lines.filter(Boolean).join('\n')
}

/**
 * HITL 打断证据 → 展示行：把"为什么打断"的决策依据摆出来（重试轨迹/预算用量），
 * 证据决定用户信不信任这个打断
 */
const askEvidenceLines = (evidence) => {
  if (!evidence) return []
  const lines = []
  if (evidence.kind === 'deadend') {
    lines.push(`⛔ 打断原因：检索进入死胡同（自动重试已耗尽）`)
    if (evidence.topic) lines.push(`主题：「${evidence.topic}」`)
    if (Number.isFinite(evidence.attempts)) lines.push(`已尝试 ${evidence.attempts} 轮检索与改写`)
    if (evidence.queriesTried?.length)
      lines.push(`试过的检索词：${evidence.queriesTried.join(' → ')}`)
    if (Number.isFinite(evidence.pointsFromTopic))
      lines.push(
        `该主题仅获得 ${evidence.pointsFromTopic} 条要点 / ${evidence.pagesFromTopic} 页来源`
      )
  } else if (evidence.kind === 'budget') {
    lines.push(`⛔ 打断原因：页面预算告警`)
    if (evidence.topic) lines.push(`下一主题：「${evidence.topic}」`)
  }
  if (Number.isFinite(evidence.sourcesCount) && Number.isFinite(evidence.maxTotalPages)) {
    lines.push(`预算用量：${evidence.sourcesCount}/${evidence.maxTotalPages} 页`)
  }
  if (Number.isFinite(evidence.topicsDone) && Number.isFinite(evidence.topicsTotal)) {
    lines.push(`研究进度：${evidence.topicsDone}/${evidence.topicsTotal} 主题`)
  }
  return lines
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
  // 开屏放行：连接成功或失败都不阻塞（失败时用户会在头部状态看到原因）
  if (status === 'connected' || status === 'error' || status === 'disconnected') {
    advanceBoot(3)
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

    websocket.onmessage = async (event) => {
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
              if (data.memory_refs) lastStreamingMsg.memoryRefs = data.memory_refs
              if (data.meta) lastStreamingMsg.tierMeta = data.meta
              finalContent = lastStreamingMsg.content
              finishTrace(lastStreamingMsg, traceStatus)
            } else if (data.success) {
              messages.value.push({
                type: 'text',
                sender: 'ai',
                content: data.content,
                timestamp: Date.now(),
                memoryRefs: data.memory_refs || [],
                tierMeta: data.meta || null,
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
            // 知识点补全：agent_response 收尾时把答案写回对应卡片并标记 done
            if (completingId.value) {
              const doneId = completingId.value
              completingId.value = ''
              expandedKnowledgeId.value = ''
              if (data.success && finalContent) {
                await updateKnowledgePoint(doneId, {
                  answer: finalContent.slice(0, 2000),
                  status: 'done',
                })
              }
              await loadKnowledge()
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
            compressNoticedThisTurn = false
            beginTrace()
            break

          // dph-A Turn/Step 执行模型：Agent 每完成一个 Step（推理/工具执行）推送事件，
          // 前端归约成轨迹节点而非单帧覆盖，用户可看到完整执行过程
          case 'agent_step':
            applyTraceStep(data)
            // 压缩真实发生时在对话流里冒一条提示（含视图 token 前后值），每回合最多一条
            if (data.phase === 'compress' && data.compressed > 0 && !compressNoticedThisTurn) {
              compressNoticedThisTurn = true
              const saved =
                Number.isFinite(data.tokensBefore) && Number.isFinite(data.tokensAfter)
                  ? `，视图 token ${data.tokensBefore} → ${data.tokensAfter}`
                  : ''
              messages.value.push({
                type: 'compress_notice',
                sender: 'ai',
                content: `📦 上下文已压缩：${data.compressed} 条早期消息转为摘要${saved}`,
                timestamp: Date.now(),
              })
              persistSession()
            }
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

          // M1-F8 深度研究：HITL 询问（暂停等待用户答复）——evidence 是"为什么打断"的证据
          case 'workflow_ask':
            thinking.value = false
            messages.value.push({
              type: 'workflow_ask',
              sender: 'ai',
              taskId: data.taskId,
              question: data.question,
              options: data.options || ['继续研究', '停止研究'],
              evidence: data.evidence || null,
              pending: true,
              answer: '',
              customText: '',
              timestamp: Date.now(),
            })
            persistSession()
            break

          // P4 分级权限 HITL：写操作审批请求（卡片展示工具/目标/值，等用户放行或拒绝）
          case 'write_approval':
            thinking.value = false
            messages.value.push({
              type: 'write_approval',
              sender: 'ai',
              requestId: data.requestId,
              tool: data.tool,
              args: data.args || {},
              pending: true,
              approved: false,
              timestamp: Date.now(),
            })
            scrollToBottom()
            break

          // P4 写操作链路：审批通过后真实执行 / 只读枚举可交互元素，经 background 到 content script
          case 'write_action':
          case 'get_interactive_elements':
            forwardWriteChain(data)
            break

          // 会话用量汇总：每次回答/研究结束后推送，驱动输入区上方的用量条
          case 'usage_summary':
            usageSummary.value = { session: data.session, total: data.total }
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

// P4 分级权限 HITL：用户对写操作审批的答复（放行/拒绝），服务端据此放行或拒绝执行
const answerWriteApproval = (msg, approved) => {
  if (!msg.pending) return
  if (!websocket || websocket.readyState !== WebSocket.OPEN) return
  msg.pending = false
  msg.approved = approved
  websocket.send(
    JSON.stringify({
      type: 'write_approval_answer',
      requestId: msg.requestId,
      approved,
      note: approved ? undefined : '用户在侧边栏拒绝了该写操作',
    })
  )
}

// P4 写操作工具的中文标签（审批卡片可读性）
const writeToolLabel = (tool) => {
  const labels = {
    click_element: '点击元素',
    fill_input: '填写输入框',
    select_option: '选择下拉选项',
  }
  return labels[tool] || tool
}

// P4 写操作链路转发：write_action（已审批）与 get_interactive_elements（只读枚举）
// 走 background → content script，回包后按 requestId 回给服务端（与其他工具同构）
const forwardWriteChain = (data) => {
  chrome.runtime
    .sendMessage({
      type: data.type,
      requestId: data.requestId,
      action: data.action,
      selector: data.selector,
      value: data.value,
      maxElements: data.maxElements,
    })
    .then((response) => {
      if (response?.success && response.payload) {
        sendToolResponse(
          data.type === 'write_action' ? 'write_action_result' : 'interactive_elements',
          data.requestId,
          response.payload,
          'Write chain completed'
        )
      } else {
        const err = response?.error || `${data.type} failed`
        sendToolResponse(
          data.type === 'write_action' ? 'write_action_result' : 'interactive_elements',
          data.requestId,
          { error: err },
          err
        )
      }
    })
    .catch((error) => {
      console.error('Write chain forward failed:', error)
      sendToolResponse(
        data.type === 'write_action' ? 'write_action_result' : 'interactive_elements',
        data.requestId,
        { error: error.message },
        error.message
      )
    })
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

  // 「记笔记」：不进普通对话，直接把选中内容收藏成一条待补全知识点
  if (payload.action === 'note') {
    await createKnowledgeCard(text, '划词')
    showKnowledgePanel.value = true
    return
  }

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
  // 主题恢复：上次手动选的主题优先；没有历史偏好时跟随系统，
  // 让 app 底色与浏览器原生侧边栏标题栏同色，避免撞色出"边框感"
  try {
    const savedTheme = localStorage.getItem(THEME_KEY)
    if (savedTheme === 'light' || savedTheme === 'dark') {
      theme.value = savedTheme
    } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
      theme.value = 'light'
    }
  } catch {
    /* ignore */
  }

  // 开屏：步骤 1（UI 挂载）完成；4s 硬兜底，任何异常都不会把用户关在开屏里
  advanceBoot(1)
  setTimeout(() => {
    booting.value = false
  }, 4000)

  // F4：先恢复最近会话（UI + 后续 WS onopen 时重放给服务端）
  await restoreCurrentSession()
  advanceBoot(2)
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
/* ===== 设计令牌 =====
 * 深色为默认主题（.chat-container 自身），[data-theme='light'] 整套覆盖为浅色。
 * 命名按语义不按色相：调主题只改这里，其余 1400 行样式全部引用 var()。
 */
.chat-container {
  /* 面板底色分层：bg（页面）→ surface（区块）→ raised（浮层卡片） */
  --bg: #0a101e;
  --surface: #101a2d;
  --surface-2: #0d1526;
  --surface-raised: #17233c;
  --overlay-rgb: 16, 26, 45;
  --border: #22304d;
  --border-strong: #33425f;
  /* 文字层级 */
  --text-1: #e2e8f0;
  --text-2: #94a3b8;
  --text-3: #7c8aa5;
  --text-muted: #64748b;
  /* 阴影/叠印用基色 */
  --ink-rgb: 0, 0, 0;
  --muted-rgb: 100, 116, 139;
  /* 强调色（indigo）：按钮底用 accent，暗色下提亮一档保证对比 */
  --accent: #6366f1;
  --accent-strong: #4f46e5;
  --accent-bright: #818cf8;
  --accent-rgb: 129, 140, 248;
  --accent-soft: rgba(99, 102, 241, 0.16);
  --accent-border: rgba(129, 140, 248, 0.45);
  --accent-ink: #0a101e;
  --on-accent: #ffffff;
  /* 代码块/知识面板：双主题都保持深色底（内容一致性） */
  --code-bg: #0a0f1a;
  --code-text: #e2e8f0;
  /* 语义色 */
  --info: #60a5fa;
  --info-strong: #3b82f6;
  --info-soft: rgba(59, 130, 246, 0.14);
  --info-border: rgba(96, 165, 250, 0.4);
  --info-rgb: 59, 130, 246;
  --success: #34d399;
  --success-strong: #10b981;
  --success-deep: #6ee7b7;
  --success-soft: rgba(16, 185, 129, 0.13);
  --success-border: rgba(52, 211, 153, 0.45);
  --success-rgb: 16, 185, 129;
  --danger: #f87171;
  --danger-strong: #ef4444;
  --danger-deep: #fca5a5;
  --danger-soft: rgba(220, 38, 38, 0.16);
  --danger-border: rgba(248, 113, 113, 0.45);
  --warn: #fbbf24;
  --warn-strong: #f59e0b;
  --warn-deep: #fcd34d;
  --warn-soft: rgba(217, 119, 6, 0.16);
  --warn-border: rgba(251, 191, 36, 0.45);
  /* 动效节奏：交互反馈 150ms / 内容切换 300ms */
  --speed-fast: 0.15s;
  --speed-normal: 0.3s;
}

.chat-container[data-theme='light'] {
  --bg: #f8fafc;
  --surface: #f1f5f9;
  --surface-2: #eef2f7;
  --surface-raised: #ffffff;
  --overlay-rgb: 255, 255, 255;
  --border: #e2e8f0;
  --border-strong: #cbd5e1;
  --text-1: #0f172a;
  --text-2: #475569;
  --text-3: #64748b;
  --text-muted: #94a3b8;
  --ink-rgb: 15, 23, 42;
  --muted-rgb: 148, 163, 184;
  --accent: #4f46e5;
  --accent-strong: #4338ca;
  --accent-bright: #6366f1;
  --accent-rgb: 79, 70, 229;
  --accent-soft: #eef2ff;
  --accent-border: #c7d2fe;
  --accent-ink: #1e1b4b;
  --code-bg: #0f172a;
  --code-text: #e2e8f0;
  --info: #3b82f6;
  --info-strong: #2563eb;
  --info-soft: #eff6ff;
  --info-border: #bfdbfe;
  --info-rgb: 59, 130, 246;
  --success: #10b981;
  --success-strong: #16a34a;
  --success-deep: #166534;
  --success-soft: #dcfce7;
  --success-border: #bbf7d0;
  --success-rgb: 16, 185, 129;
  --danger: #dc2626;
  --danger-strong: #ef4444;
  --danger-deep: #b91c1c;
  --danger-soft: #fef2f2;
  --danger-border: #fecaca;
  --warn: #f59e0b;
  --warn-strong: #d97706;
  --warn-deep: #b45309;
  --warn-soft: #fffbeb;
  --warn-border: #fde68a;
}

/* ===== 基础 ===== */
*,
*::before,
*::after {
  box-sizing: border-box;
}

.chat-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 100vh;
  width: 100%;
  min-width: 0;
  background: linear-gradient(180deg, var(--bg) 0%, var(--surface-2) 100%);
  color: var(--text-1);
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
  background: rgba(var(--overlay-rgb), 0.85);
  backdrop-filter: saturate(180%) blur(10px);
  -webkit-backdrop-filter: saturate(180%) blur(10px);
  border-bottom: 1px solid rgba(var(--ink-rgb), 0.06);
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
  background: var(--surface);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 2px rgba(var(--ink-rgb), 0.08);
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

.connection-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-3);
  line-height: 1;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--border-strong);
  transition: background 0.2s;
}

.connection-status.connected .status-dot {
  background: var(--success);
  box-shadow: 0 0 0 3px rgba(var(--success-rgb), 0.18);
  animation: pulse-dot 2s infinite;
}

.connection-status.connecting .status-dot {
  background: var(--warn);
  animation: pulse-dot 1.2s infinite;
}

.connection-status.disconnected .status-dot,
.connection-status.error .status-dot {
  background: var(--danger);
}

.connection-status.connected {
  color: var(--success-deep);
}
.connection-status.connecting {
  color: var(--warn-deep);
}
.connection-status.disconnected,
.connection-status.error {
  color: var(--danger-deep);
}

@keyframes pulse-dot {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(var(--success-rgb), 0.5);
  }
  50% {
    box-shadow: 0 0 0 4px rgba(var(--success-rgb), 0);
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
  color: var(--text-2);
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
  background: var(--surface);
  color: var(--text-1);
  border-color: var(--border);
}

.icon-btn:active {
  background: var(--border);
}

.icon-btn.active {
  background: var(--info-soft);
  color: var(--info-strong);
  border-color: var(--info-soft);
}

/* 知识点图标红点：有新待补全条目时显示 */
.icon-btn.has-badge {
  position: relative;
}

.icon-badge {
  position: absolute;
  top: -3px;
  right: -3px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--danger);
  color: var(--on-accent);
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  text-align: center;
  box-shadow: 0 0 0 2px var(--surface-raised);
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
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow:
    0 4px 6px rgba(var(--ink-rgb), 0.05),
    0 12px 24px rgba(var(--ink-rgb), 0.1);
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
  background: var(--surface);
}

.history-item.active {
  background: var(--info-soft);
}

.history-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-time {
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.history-empty {
  padding: 24px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
}

.history-search {
  width: 100%;
  margin-bottom: 6px;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
}

.history-search:focus {
  border-color: var(--info);
  box-shadow: 0 0 0 3px rgba(var(--info-rgb), 0.1);
}

.history-rename,
.history-delete {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
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
  background: var(--accent-soft);
  color: var(--accent);
}

.history-delete:hover {
  background: var(--danger-soft);
  color: var(--danger);
}

.history-rename-input {
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid var(--info);
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  background: var(--surface-raised);
}

.history-clear {
  margin-top: 4px;
  padding: 8px;
  text-align: center;
  font-size: 12px;
  color: var(--danger);
  border-radius: 8px;
  cursor: pointer;
  border-top: 1px solid var(--surface);
  transition: background-color 0.15s;
}

.history-clear:hover {
  background: var(--danger-soft);
}

/* ===== 知识点面板（flashcard） ===== */
.knowledge-panel {
  position: absolute;
  top: 60px;
  right: 8px;
  left: 8px;
  z-index: 100;
  max-height: 70vh;
  overflow-y: auto;
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow:
    0 4px 6px rgba(var(--ink-rgb), 0.05),
    0 12px 24px rgba(var(--ink-rgb), 0.1);
  padding: 8px;
  animation: panelFade 0.15s ease;
}

.knowledge-add {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}

.knowledge-add-input {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
}

.knowledge-add-input:focus {
  border-color: var(--info);
}

.knowledge-add-btn {
  flex-shrink: 0;
  padding: 0 14px;
  border: none;
  border-radius: 8px;
  background: var(--info-strong);
  color: var(--on-accent);
  font-size: 13px;
  cursor: pointer;
  transition: background-color 0.15s;
}

.knowledge-add-btn:disabled {
  background: var(--border-strong);
  cursor: not-allowed;
}

.knowledge-add-btn:hover:not(:disabled) {
  background: var(--info-strong);
}

.knowledge-empty {
  padding: 24px 16px;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.7;
}

.knowledge-item {
  padding: 10px 12px;
  border-radius: 10px;
  cursor: pointer;
  transition: background-color 0.15s;
  border: 1px solid transparent;
}

.knowledge-item:hover {
  background: var(--bg);
}

.knowledge-item.knowledge-pending {
  border-color: var(--warn-border);
  background: var(--warn-soft);
}

.knowledge-item.expanded {
  background: var(--bg);
  border-color: var(--border);
}

.knowledge-item-top {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.knowledge-question {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-1);
  line-height: 1.4;
  white-space: normal;
  word-break: break-word;
}

.knowledge-delete {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: all 0.15s;
}

.knowledge-item:hover .knowledge-delete {
  opacity: 1;
}

.knowledge-delete:hover {
  background: var(--danger-soft);
  color: var(--danger);
}

.knowledge-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.knowledge-status {
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
}

.knowledge-status.pending {
  background: var(--warn-soft);
  color: var(--warn-deep);
}

.knowledge-status.done {
  background: var(--success-soft);
  color: var(--success-deep);
}

.knowledge-time {
  font-size: 11px;
  color: var(--text-muted);
}

.knowledge-source {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: right;
}

.knowledge-answer {
  margin-top: 8px;
  font-size: 12.5px;
  color: var(--text-2);
  line-height: 1.7;
  border-top: 1px dashed var(--border);
  padding-top: 8px;
  word-break: break-word;
}

/* 折叠：只显示前几行摘要，点开看全文 */
.knowledge-answer.collapsed .knowledge-answer-body {
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.knowledge-hint {
  margin-top: 8px;
  font-size: 11px;
  color: var(--warn-strong);
}

.knowledge-clear {
  margin-top: 6px;
  padding: 8px;
  text-align: center;
  font-size: 12px;
  color: var(--danger);
  border-radius: 8px;
  cursor: pointer;
  border-top: 1px solid var(--surface);
  transition: background-color 0.15s;
}

.knowledge-clear:hover {
  background: var(--danger-soft);
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
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: 0 1px 2px rgba(var(--ink-rgb), 0.04);
}

.welcome-icon {
  font-size: 32px;
  margin-bottom: 8px;
  filter: drop-shadow(0 2px 4px rgba(var(--ink-rgb), 0.06));
}

.welcome-text {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
  margin: 0 0 4px;
}

.welcome-desc {
  font-size: 12.5px;
  color: var(--text-3);
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
  color: var(--text-2);
  padding: 7px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
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
  background: linear-gradient(135deg, var(--accent-bright) 0%, var(--accent) 100%);
  color: var(--on-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
  box-shadow: 0 1px 3px rgba(var(--accent-rgb), 0.25);
}

.message-item.user-message .message-avatar {
  background: linear-gradient(135deg, var(--text-3) 0%, var(--text-2) 100%);
  box-shadow: 0 1px 3px rgba(var(--muted-rgb), 0.25);
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
  color: var(--text-2);
  letter-spacing: 0.01em;
}

.message-time {
  font-size: 11px;
  color: var(--text-muted);
}

.message-copy-button {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--text-muted);
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
  color: var(--accent);
  background: var(--accent-soft);
}

/* ===== 消息气泡 ===== */
.message-bubble {
  background: var(--surface-raised);
  padding: 10px 12px;
  border-radius: 12px;
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--text-1);
  border: 1px solid var(--border);
  word-wrap: break-word;
  overflow-wrap: break-word;
  max-width: 100%;
  min-width: 0;
  box-shadow: 0 1px 2px rgba(var(--ink-rgb), 0.04);
}

.message-item.user-message .message-bubble {
  background: linear-gradient(135deg, var(--accent-bright) 0%, var(--accent) 100%);
  color: var(--on-accent);
  border-color: transparent;
  box-shadow: 0 2px 6px rgba(var(--accent-rgb), 0.2);
}

/* ===== Markdown 渲染内容（v-html 插入，需 :deep 生效） ===== */
.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4) {
  margin: 12px 0 6px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--text-1);
}

.markdown-content :deep(h1) {
  font-size: 17px;
}
.markdown-content :deep(h2) {
  font-size: 15.5px;
  border-bottom: 1px solid var(--border);
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
  color: var(--text-1);
}

.markdown-content :deep(code) {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 12px;
  padding: 1px 5px;
  background: rgba(var(--ink-rgb), 0.06);
  border-radius: 4px;
  word-break: break-all;
}

.markdown-content :deep(pre) {
  margin: 0;
  padding: 10px 12px;
  background: var(--code-bg);
  color: var(--code-text);
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
  background: var(--text-1);
  color: var(--text-muted);
  font-size: 11px;
}

.markdown-content :deep(.code-lang) {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  text-transform: lowercase;
}

.markdown-content :deep(.code-copy-btn) {
  border: 1px solid rgba(var(--muted-rgb), 0.3);
  border-radius: 5px;
  background: transparent;
  color: var(--border-strong);
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
  transition:
    background-color 0.15s,
    color 0.15s;
}

.markdown-content :deep(.code-copy-btn:hover) {
  background: rgba(var(--muted-rgb), 0.18);
  color: var(--on-accent);
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
  background: var(--bg);
  border-left: 3px solid var(--accent-bright);
  border-radius: 0 6px 6px 0;
  color: var(--text-2);
  font-size: 13px;
}

.markdown-content :deep(a) {
  color: var(--accent);
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
  border: 1px solid var(--border);
  padding: 6px 8px;
  text-align: left;
}

.markdown-content :deep(th) {
  background: var(--bg);
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
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.selection-action {
  font-size: 11.5px;
  color: var(--accent);
  font-weight: 500;
}

.selection-text {
  padding: 8px 10px;
  font-size: 12.5px;
  color: var(--text-2);
  line-height: 1.6;
  word-break: break-word;
  white-space: pre-wrap;
  max-height: 160px;
  overflow-y: auto;
  background: var(--surface);
}

/* ===== M1-F8 深度研究：进度消息 ===== */
.progress-bubble {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 12px;
  color: var(--text-3);
  align-self: flex-start;
}

/* ===== dph-C 运行时压缩提示：一次性事件条，平时不占空间 ===== */
.compress-bubble {
  display: inline-flex;
  align-items: center;
  padding: 5px 12px;
  background: var(--accent-soft);
  border: 1px dashed var(--accent-border);
  border-radius: 8px;
  font-size: 12px;
  color: var(--text-2);
  align-self: flex-start;
}

/* ===== 档位 badge：本条回答由哪个档位的模型生成（分级路由可见性） ===== */
.tier-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 10px;
  line-height: 1.6;
  background: var(--surface-raised);
  border: 1px solid var(--border);
  color: var(--text-2);
  white-space: nowrap;
}

.tier-badge.light {
  background: var(--accent-soft);
  border-color: var(--accent-border);
  color: var(--accent-strong);
}

.spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid var(--border-strong);
  border-top-color: var(--accent-bright);
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
  background: var(--surface-raised);
  border: 1px solid var(--accent-border);
  box-shadow: 0 2px 8px rgba(var(--accent-rgb), 0.08);
}

.workflow-ask-question {
  margin: 0 0 10px 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--accent-ink);
  font-weight: 500;
}

/* ===== HITL 打断证据：把"为什么打断"的决策依据摆给用户 ===== */
.ask-evidence {
  margin: 0 0 10px 0;
  padding: 8px 10px;
  background: rgba(var(--ink-rgb), 0.04);
  border-left: 2px solid var(--accent-border);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ask-evidence-item {
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-2);
  word-break: break-all;
}

.workflow-ask-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.workflow-ask-btn {
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--bg);
  font-size: 12px;
  color: var(--text-2);
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.workflow-ask-btn:hover {
  background: var(--accent-soft);
  border-color: var(--accent-border);
  color: var(--accent-strong);
}

.workflow-ask-btn.primary {
  background: linear-gradient(135deg, var(--accent-bright) 0%, var(--accent) 100%);
  border-color: transparent;
  color: var(--on-accent);
  box-shadow: 0 1px 3px rgba(var(--accent-rgb), 0.3);
}

.workflow-ask-btn.primary:hover {
  filter: brightness(1.1);
}

.workflow-ask-input {
  flex: 1;
  min-width: 120px;
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: 14px;
  font-size: 12px;
  outline: none;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
  background: var(--surface-raised);
}

.workflow-ask-input:focus {
  border-color: var(--accent-bright);
  box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.1);
}

.workflow-ask-answered {
  margin: 0;
  font-size: 12px;
  color: var(--success-strong);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* ===== 性能数据展示 ===== */
.perf-bubble {
  padding: 0;
  overflow: hidden;
  background: var(--surface-raised);
  border: 1px solid var(--border);
}

.performance-card {
  padding: 12px;
}

.performance-title {
  margin: 0 0 10px 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
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
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  min-width: 0;
}

.detail-label {
  font-size: 11px;
  color: var(--text-3);
}

.detail-value {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
  word-break: break-all;
  overflow-wrap: anywhere;
}

.detail-value.highlight {
  color: var(--accent);
}

/* ===== 思考中动画 ===== */
.thinking-bubble {
  display: inline-flex;
  flex-direction: column;
  gap: 4px;
  background: var(--surface-raised);
  border: 1px solid var(--border);
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
  background: linear-gradient(135deg, var(--accent-bright) 0%, var(--accent) 100%);
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
  color: var(--text-3);
  margin: 0;
  line-height: 1.4;
}

.stop-btn {
  align-self: flex-start;
  margin-top: 4px;
  padding: 3px 10px;
  border: 1px solid var(--danger-border);
  border-radius: 6px;
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}

.stop-btn:hover {
  background: var(--danger-soft);
  border-color: var(--danger-border);
}

/* ===== 输入区域 ===== */
.chat-input-area {
  position: relative;
  flex-shrink: 0;
  padding: 10px 12px 12px;
  background: rgba(var(--overlay-rgb), 0.85);
  backdrop-filter: saturate(180%) blur(10px);
  -webkit-backdrop-filter: saturate(180%) blur(10px);
  border-top: 1px solid rgba(var(--ink-rgb), 0.06);
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
  border: 1px solid var(--border);
  background: var(--surface-raised);
  color: var(--text-2);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(var(--ink-rgb), 0.12);
  transition:
    background-color 0.15s,
    color 0.15s;
  z-index: 20;
}

.scroll-bottom-btn:hover {
  background: var(--accent-soft);
  color: var(--accent-strong);
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
  background: var(--bg);
  color: var(--text-2);
  border: 1px solid var(--border);
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
  background: var(--accent-soft);
  border-color: var(--accent-border);
  color: var(--accent-strong);
  transform: translateY(-1px);
}

.quick-action:active:not(:disabled) {
  transform: translateY(0);
}

.quick-action:disabled {
  background: var(--surface);
  color: var(--text-muted);
  border-color: var(--border);
  cursor: not-allowed;
}

.quick-action.research:not(:disabled) {
  background: var(--success-soft);
  border-color: var(--success-border);
  color: var(--success-deep);
}

.quick-action.research:hover:not(:disabled) {
  background: var(--success-soft);
  border-color: var(--success-border);
  color: var(--success-deep);
}

.quick-action.extract:not(:disabled) {
  background: var(--info-soft);
  border-color: var(--info-border);
  color: var(--info-strong);
}

.quick-action.extract:hover:not(:disabled) {
  background: var(--info-soft);
  border-color: var(--info-border);
  color: var(--info-strong);
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
  border: 1px solid var(--border);
  border-radius: 18px;
  font-size: 13px;
  line-height: 1.5;
  font-family: inherit;
  background: var(--surface-raised);
  color: var(--text-1);
  outline: none;
  resize: none;
  overflow-y: auto;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}

.input-field::placeholder {
  color: var(--text-muted);
}

.input-field:focus {
  border-color: var(--accent-bright);
  box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.1);
}

.send-button {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  background: linear-gradient(135deg, var(--accent-bright) 0%, var(--accent) 100%);
  color: var(--on-accent);
  border: none;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  box-shadow: 0 2px 6px rgba(var(--accent-rgb), 0.25);
}

.send-button:hover:not(:disabled) {
  filter: brightness(1.1);
  transform: translateY(-1px);
  box-shadow: 0 4px 10px rgba(var(--accent-rgb), 0.35);
}

.send-button:active:not(:disabled) {
  transform: translateY(0);
}

.send-button:disabled {
  background: var(--border-strong);
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
  background: rgba(var(--muted-rgb), 0.4);
  border-radius: 3px;
  transition: background 0.15s;
}

.chat-messages::-webkit-scrollbar-thumb:hover,
.history-panel::-webkit-scrollbar-thumb:hover {
  background: rgba(var(--muted-rgb), 0.7);
}

/* Firefox */
.chat-messages,
.history-panel,
.selection-text {
  scrollbar-width: thin;
  scrollbar-color: rgba(var(--muted-rgb), 0.4) transparent;
}

/* ===== 开屏（游戏风启动演出：logo 砸落 + 光环扩散 + 真实进度条） ===== */
.boot-splash {
  position: absolute;
  inset: 0;
  z-index: 999;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  background:
    radial-gradient(ellipse 60% 40% at 50% 38%, rgba(var(--accent-rgb), 0.12), transparent 70%),
    var(--bg);
}

.boot-logo-wrap {
  position: relative;
  width: 72px;
  height: 72px;
  display: grid;
  place-items: center;
}

/* logo 外圈光环：向外扩散并消隐，循环 */
.boot-logo-wrap::after {
  content: '';
  position: absolute;
  inset: -10px;
  border-radius: 24px;
  border: 2px solid rgba(var(--accent-rgb), 0.55);
  animation: boot-ring 1.4s ease-out infinite;
}

.boot-logo {
  width: 60px;
  height: 60px;
  border-radius: 16px;
  animation: boot-logo-in 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
  filter: drop-shadow(0 6px 18px rgba(var(--accent-rgb), 0.45));
}

.boot-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: var(--text-1);
  letter-spacing: 0.14em;
  animation: boot-rise 0.6s 0.25s ease-out both;
}

.boot-progress {
  width: 220px;
  height: 4px;
  border-radius: 999px;
  background: var(--surface-raised);
  overflow: hidden;
}

.boot-progress-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--accent), var(--accent-bright));
  box-shadow: 0 0 10px rgba(var(--accent-rgb), 0.65);
  transition: width 0.45s cubic-bezier(0.4, 0, 0.2, 1);
}

.boot-step {
  font-size: 12px;
  color: var(--text-2);
  animation: boot-rise 0.4s ease-out both;
}

.boot-tip {
  font-size: 12px;
  color: var(--text-muted);
  animation: boot-rise 0.6s 0.45s ease-out both;
}

/* 开屏淡出（<Transition name="boot-fade"> 的 leave 阶段） */
.boot-fade-leave-active {
  transition:
    opacity 0.35s ease,
    transform 0.35s ease;
}
.boot-fade-leave-to {
  opacity: 0;
  transform: scale(1.04);
}

@keyframes boot-logo-in {
  from {
    opacity: 0;
    transform: scale(0.6);
    filter: blur(6px);
  }
  to {
    opacity: 1;
    transform: scale(1);
    filter: blur(0);
  }
}

@keyframes boot-ring {
  0% {
    opacity: 0.9;
    transform: scale(0.82);
  }
  70%,
  100% {
    opacity: 0;
    transform: scale(1.18);
  }
}

@keyframes boot-rise {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ===== 流式打字机光标 ===== */
.message-bubble.streaming::after {
  content: '▍';
  display: inline-block;
  margin-left: 1px;
  color: var(--accent-bright);
  animation: cursor-blink 0.9s steps(2, start) infinite;
}

/* ===== 浏览记忆引用标签 ===== */
.memory-refs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 11px;
  color: var(--text-muted);
}
.memory-refs-label {
  color: var(--accent-bright);
}
.memory-chip {
  display: inline-block;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  color: var(--accent-bright);
  cursor: default;
}

@keyframes cursor-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}

/* 动效关怀：系统开启"减弱动态效果"时关掉装饰动画（信息仍完整呈现） */
@media (prefers-reduced-motion: reduce) {
  .boot-logo,
  .boot-title,
  .boot-step,
  .boot-tip,
  .boot-logo-wrap::after,
  .message-bubble.streaming::after {
    animation: none;
  }
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
