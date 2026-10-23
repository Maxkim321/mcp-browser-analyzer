<template>
  <div class="chat-container">
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
        <!-- P10 能力可见性：AI 背后有什么工具/MCP 能力，点开即见（运行时注册表驱动） -->
        <button
          class="icon-btn"
          title="能力工具箱"
          :class="{ active: showCapabilitiesPanel }"
          @click="toggleCapabilitiesPanel"
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
            <path
              d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
            />
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

    <!-- P12c UX：执行中状态条——工具静默期（读页面/等加载）也能明确"agent 在干活"，
         中间轮次文本只进执行轨迹，最终回复才落气泡，消除"结论一直在变"的观感。
         有后台回合（归属会话 ≠ 当前查看会话）时保持可见并标明归属，点击跳回 -->
    <Transition name="exec-fade">
      <div
        v-if="thinking || turnBackground"
        class="exec-status"
        :class="{ 'exec-bg': turnBackground }"
        :title="turnBackground ? '点击回到该会话' : ''"
        @click="bgTurns.length && switchSession(bgTurns[0].sessionId)"
      >
        <span class="exec-spinner"></span>
        <span class="exec-status-text">
          {{ turnBackground ? bgStatusText : `AI 正在执行 · ${traceCurrentLabel || '思考中'}` }}
        </span>
      </div>
    </Transition>

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

    <!-- 知识点面板（秋招随手记 / flashcard）：P11 列表/详情两态 -->
    <div v-if="showKnowledgePanel" class="knowledge-panel">
      <!-- ===== 列表态：添加 + 搜索筛选 + 单行卡 ===== -->
      <template v-if="knowledgeView === 'list'">
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

        <!-- P11 搜索 + 状态筛选 -->
        <input
          v-model="knowledgeKeyword"
          class="knowledge-search"
          placeholder="搜索问题或答案..."
          @keydown.stop
        />
        <div class="knowledge-filters">
          <button
            v-for="f in KNOWLEDGE_FILTERS"
            :key="f.value"
            class="knowledge-filter-chip"
            :class="{ active: knowledgeFilter === f.value }"
            @click="knowledgeFilter = f.value"
          >
            {{ f.label }}
          </button>
        </div>

        <div v-if="!knowledgeList.length" class="knowledge-empty">
          还没有知识点。去网页划词点「记笔记」、把 AI 回答点「收藏」，或在上方手输问题。
        </div>
        <div v-else-if="!knowledgeFiltered.length" class="knowledge-empty">没有匹配的知识点</div>
        <template v-else>
          <div
            v-for="kp in knowledgeFiltered"
            :key="kp.id"
            class="knowledge-row"
            @click="openKnowledgeDetail(kp)"
          >
            <span class="knowledge-dot" :class="kp.status" :title="kp.status === 'pending' ? '待补全' : '已整理'"></span>
            <span class="knowledge-question">{{ kp.question }}</span>
            <span v-if="completingId === kp.id" class="spinner"></span>
            <button
              class="knowledge-delete"
              title="删除该知识点"
              @click.stop="deleteKnowledge(kp.id)"
            >
              ×
            </button>
          </div>
          <div class="knowledge-clear" @click="clearAllKnowledge">清空全部知识点</div>
        </template>
      </template>

      <!-- ===== 详情态：问题全文 + meta + 答案 + 操作区 ===== -->
      <template v-else-if="detailKp">
        <button class="knowledge-back" @click="backToKnowledgeList">‹ 返回列表</button>
        <div class="knowledge-detail-question">{{ detailKp.question }}</div>
        <div class="knowledge-meta">
          <span class="knowledge-status" :class="detailKp.status">
            {{ detailKp.status === 'pending' ? '待补全' : '已整理' }}
          </span>
          <span class="knowledge-time">{{ formatShortTime(detailKp.createdAt) }}</span>
          <a
            v-if="detailKpUrl"
            class="knowledge-source-link"
            :title="`打开来源页面：${detailKpUrl}`"
            @click.prevent="openSourceUrl(detailKpUrl)"
            >{{ detailKp.source }}</a
          >
          <span v-else class="knowledge-source">{{ detailKp.source }}</span>
        </div>

        <!-- pending：显式「AI 补全」按钮——与"进入详情"解耦，避免误触烧 LLM 调用 -->
        <div v-if="detailKp.status === 'pending'" class="knowledge-detail-actions">
          <button
            v-if="completingId !== detailKp.id"
            class="knowledge-complete-btn"
            @click="completeKnowledge(detailKp)"
          >
            AI 补全答案
          </button>
          <button v-else class="knowledge-complete-btn" disabled>
            <span class="spinner"></span>
            <span>补全中...</span>
          </button>
          <div v-if="failedKpId === detailKp.id" class="knowledge-hint is-failed">
            上次补全未完成 · 可重试
          </div>
        </div>

        <!-- 补全中骨架屏：3 条 shimmer 占位 -->
        <div v-if="completingId === detailKp.id" class="knowledge-skeleton">
          <div class="skeleton-line w60"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line w80"></div>
        </div>
        <!-- done：答案全文（markdown） -->
        <div
          v-else-if="detailKp.status === 'done'"
          class="knowledge-answer markdown-content"
        >
          <div class="knowledge-answer-body" v-html="renderMarkdown(detailKp.answer)"></div>
        </div>

        <div class="knowledge-detail-footer">
          <button class="knowledge-delete-detail" @click="deleteKnowledge(detailKp.id)">
            删除
          </button>
        </div>
      </template>
      <!-- 产品决策（2026-10-12）：不做个人向 SRS 复习闭环——知识点定位为通用内容，不绑定个人学习场景。
           遗留小项：来源 URL 建卡时截断 80 字符，下次动 schema 时加全量 URL 字段 -->
    </div>

    <!-- P10 能力面板：内置工具 + MCP server 清单（服务端注册表快照，拉取 + 广播双通道） -->
    <CapabilitiesPanel v-if="showCapabilitiesPanel" :capabilities="capabilities" />

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
      <!-- P10 空态引导：chip 由真实注册的 MCP server 驱动——接了什么才推荐什么，
           没接入就整组不渲染（不硬编码承诺不存在的能力）。放在欢迎卡片外：
           连接成功会推一条 greeting 消息把 welcome 区顶掉，chip 不该跟着消失 -->
      <div v-if="capabilityChips.length && !hasConversation" class="capability-chips">
        <button
          v-for="chip in capabilityChips"
          :key="chip.label"
          class="capability-chip"
          :title="chip.prompt"
          @click="sendCapabilityChip(chip)"
        >
          {{ chip.label }}
        </button>
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
          <AgentTrace
            v-if="msg.trace && msg.trace.length"
            :nodes="msg.trace"
            :graph="msg.traceGraph"
          />
          <!-- Agent 执行轨迹（当前流式回答，实时追踪）。
               答案文本一开始输出就自动收起成一行摘要：过程让位给结论（DeepSeek
               "思考过程"同款模式），点击可展开看实时步骤；纯工具阶段保持展开 -->
          <AgentTrace
            v-if="msg.streaming && traceNodes.length"
            :nodes="traceNodes"
            :graph="traceGraph"
            :active="traceActive"
            :force-collapsed="msg.streaming && !!msg.content"
          />
          <!-- dph-A 可取消：流式阶段同样提供停止入口——此前停止按钮只在"轨迹气泡"
               （!streamingActive）里，答案开始流式后全 UI 无处可点，回合无法中途打断 -->
          <button v-if="msg.streaming" class="stop-btn" @click="cancelAgentTask">
            ⏹ 停止生成
          </button>
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
            <p class="workflow-ask-question">
              🔐 AI 请求执行写操作：{{ writeToolLabel(msg.tool) }}
            </p>
            <div class="ask-evidence">
              <!-- P12a：寻址 selector → ref——目标展示 ref + LLM 给的人类可读说明；
                   ref 执行前还会经内容脚本身份校验（审批到执行之间页面变了会被拒绝） -->
              <div class="ask-evidence-item">
                目标：{{ msg.args?.description || '未说明' }}
                <span class="ask-evidence-ref">{{ msg.args?.ref }}</span>
              </div>
              <!-- P12b：fill_form 批量字段——一次审批看全部 -->
              <div v-if="msg.args?.fields" class="ask-evidence-fields">
                <div
                  v-for="(f, fi) in msg.args.fields"
                  :key="fi"
                  class="ask-evidence-item"
                >
                  {{ fi + 1 }}. <span class="ask-evidence-ref">{{ f.ref }}</span>
                  {{ f.type ? `[${f.type}] ` : '' }}将填入：{{ f.value }}
                </div>
              </div>
              <div v-if="msg.args?.value" class="ask-evidence-item">内容：{{ msg.args.value }}</div>
              <div v-if="msg.args?.description" class="ask-evidence-item">
                说明：{{ msg.args.description }}
              </div>
              <!-- P7 注入防御：本轮上下文检出过疑似指令注入——把风险亮到人审面前 -->
              <div
                v-if="msg.taint && msg.taint.length"
                class="ask-evidence-item"
                style="color: var(--danger-strong)"
              >
                ⚠️ 本轮上下文含疑似指令注入内容（命中 {{ msg.taint.length }} 处{{
                  msg.taint[0]?.patterns?.length ? '：' + msg.taint[0].patterns.join('、') : ''
                }}），请格外谨慎确认目标与内容
              </div>
            </div>
            <div v-if="msg.pending" class="workflow-ask-actions">
              <!-- P16.1 审批记忆：sudo 缓存模式——读流程里反复点击（日期条/翻页/筛选）
                   不必每次打断；作用域=会话级全部写操作（agent 会在 click/trusted_click
                   间切换策略，按工具记忆追不上），写预算+审计+停止按钮兜底 -->
              <label class="approval-remember">
                <input type="checkbox" v-model="msg.rememberChecked" />
                本会话内写操作自动放行，不再询问
              </label>
              <button class="workflow-ask-btn primary" @click="answerWriteApproval(msg, true)">
                允许执行
              </button>
              <button class="workflow-ask-btn" @click="answerWriteApproval(msg, false)">
                拒绝
              </button>
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

      <!-- 思考中 / 实时执行轨迹（仅在流式回答尚未开始前展示）：
           有后台回合时不展示（归约器里若是后台事件，轨迹属于别的会话）；
           但当前会话自己的回合在跑（currentBusy）则正常展示 -->
      <div
        v-if="(thinking || traceActive) && !streamingActive && (!turnBackground || currentBusy)"
        class="message-item ai-message"
      >
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
          <AgentTrace
            v-if="traceNodes.length"
            :nodes="traceNodes"
            :graph="traceGraph"
            :active="traceActive"
          />
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
          :disabled="!inputText.trim() || currentBusy"
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

    <!-- P11 撤销删除轻提示：5 秒内可撤销，超时自动消失 -->
    <Transition name="toast-fade">
      <div v-if="undoToast" class="undo-toast">
        <span class="undo-toast-text">{{ undoToast.message }}</span>
        <button class="undo-toast-btn" @click="undoLastAction">撤销</button>
      </div>
    </Transition>

    <!-- 后台回合轻提示：切走的会话在后台完成回复/等待审批，点击跳回归属会话 -->
    <Transition name="toast-fade">
      <div v-if="turnToast" class="undo-toast turn-toast" @click="goTurnToast">
        <span class="undo-toast-text">{{ turnToast.message }}</span>
        <button v-if="turnToast.sessionId" class="undo-toast-btn">查看</button>
      </div>
    </Transition>
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
  clearKnowledgePoints,
} from '@/utils/prefs'
import AgentTrace from '@/components/AgentTrace.vue'
import UsageBar from '@/components/UsageBar.vue'
import CapabilitiesPanel from '@/components/CapabilitiesPanel.vue'
import { trustedClick } from '@/background/trusted-input.js'
import { useAgentTrace, TRACE_STATUS } from '@/composables/useAgentTrace'
import {
  createTurnRegistry,
  appendTurnToken,
  finalizeTurnMessages,
  pickPersistable,
  insertBeforeStreaming,
} from '@/logic/turn-router.js'

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

// ===== Turn 归属注册表（会话串台修复，纯逻辑见 logic/turn-router.js） =====
// P15 服务端会话路由的对端：全部回合事件带 sessionId 回传，跨会话可并行。
// 不属于当前查看会话的事件写进该会话的后台缓冲，回合结束落盘归属会话并提示；
// 切回原会话时缓冲并回、流式继续。切换会话时服务端上下文用 restore_session
// （store.replace 替换语义，幂等）恢复，运行中回合的会话跳过重放。
const turnRegistry = createTurnRegistry()
let lastLocalBegin = '' // 服务端未带 sessionId 时的兜底归属（旧服务端兼容）
// 响应式镜像：进行中回合列表 [{sessionId,title}]（registry 是普通 Map，模板不追踪）
const turnSessions = ref([])
const syncTurnMirror = () => {
  turnSessions.value = turnRegistry.busyIds().map((id) => ({
    sessionId: id,
    title: turnRegistry.record(id)?.title || '会话',
  }))
}
// 后台回合 = 进行中回合里归属会话 ≠ 当前查看会话的那些
const bgTurns = computed(() => turnSessions.value.filter((s) => s.sessionId !== sessionId.value))
const turnBackground = computed(() => bgTurns.value.length > 0)
// 当前查看会话自己有回合在跑（发送按钮禁用 + 同会话发送拦截）
const currentBusy = computed(() => turnSessions.value.some((s) => s.sessionId === sessionId.value))
const bgStatusText = computed(() =>
  bgTurns.value.length === 1
    ? `「${bgTurns.value[0].title}」后台回复中 · ${traceCurrentLabel.value || '思考中'}`
    : `${bgTurns.value.length} 个会话后台回复中`
)

let turnToastTimer = null
const turnToast = ref(null) // { message, sessionId } sessionId 非空则可点击跳转
// 提示类 2.5s 自动消失（可点击跳过的场景信息不值得占屏 6s）；带跳转的完成/审批类 5s 给反应时间
const showTurnToast = (message, gotoId = '') => {
  turnToast.value = { message, sessionId: gotoId }
  clearTimeout(turnToastTimer)
  turnToastTimer = setTimeout(() => {
    turnToast.value = null
  }, gotoId ? 5000 : 2500)
}

const goTurnToast = () => {
  const target = turnToast.value?.sessionId
  turnToast.value = null
  if (target) switchSession(target)
}

// 事件归属判定：服务端事件带 sessionId 为准；未带（旧服务端）回落到最近一次本地发起
const turnOwnerOf = (data) => data.sessionId || lastLocalBegin || sessionId.value
const isBgOwner = (owner) => !!owner && owner !== sessionId.value

// 回合进行中禁止在本会话再发送（服务端会话内串行排队，客户端拦截给明确反馈）；
// 其他会话不受影响——跨会话并行是 P15 的核心能力
const blockIfTurnBusy = () => {
  if (!turnRegistry.has(sessionId.value)) return false
  showTurnToast('当前会话正在回复中，请等待完成')
  return true
}

// 回合开始（sendPrompt 成功出站后调用）：标题取会话索引条目，新会话回落首条用户消息
const beginTurn = () => {
  const entry = sessionList.value.find((s) => s.id === sessionId.value)
  const firstUserMsg = messages.value.find((m) => m.sender === 'user')
  const title = entry?.title || (firstUserMsg?.content || '新对话').slice(0, 20)
  turnRegistry.begin(sessionId.value, title)
  lastLocalBegin = sessionId.value
  syncTurnMirror()
}

// ===== 知识点卡片库（flashcard：收藏问题 + 异步补全答案 + 回顾） =====
const showKnowledgePanel = ref(false)
const knowledgeList = ref([])
const newKnowledgeQuestion = ref('')
// ===== P11 列表/详情两态 + 搜索筛选 + 撤销删除 =====
const knowledgeView = ref('list') // 'list' | 'detail'
const detailKnowledgeId = ref('')
const knowledgeKeyword = ref('')
const knowledgeFilter = ref('all') // 'all' | 'pending' | 'done'
const KNOWLEDGE_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'pending', label: '待补全' },
  { value: 'done', label: '已整理' },
]
const completingId = ref('') // 正在补全的卡片 id
let completingTimer = null // 补全 90s 超时兜底：agent_response 丢失时锁会永久卡死
const failedKpId = ref('') // 上次补全失败的卡片（详情态提示可重试）
const undoToast = ref(null) // { items: [kp...], message } 撤销删除轻提示
let undoTimer = null

// ===== P10 能力可见性：工具箱面板 + 运行时注册表快照 =====
// capabilities 由服务端 listCapabilities() 快照驱动（连接时拉取 + MCP 注册完成广播），
// 面板与空态 chip 都吃这份数据——接了什么显示什么，前端不硬编码能力清单
const showCapabilitiesPanel = ref(false)
const capabilities = ref(null)

// 空态引导 chip：按"工具能力特征"匹配而非 server 实例名——server 被用户配成
// fs / filesystem / my-notes 都无所谓，只要它真的提供了那类工具，对应 chip 才出现
const CAPABILITY_CHIPS = [
  {
    match: (tools) => tools.some((t) => /write_file|edit_file|create_directory/.test(t)),
    label: '📝 把本页总结存成桌面笔记',
    prompt: '把当前页面的核心内容总结成一篇结构化笔记，保存到我的桌面',
  },
  {
    match: (tools) => tools.some((t) => /browser_navigate|browser_click|navigate/.test(t)),
    label: '🌐 让 AI 操作浏览器',
    prompt: '用浏览器工具打开 https://example.com 并告诉我页面标题',
  },
  {
    match: (tools) => tools.some((t) => /issue|pull_request|repository/.test(t)),
    label: '🐙 查我的 GitHub 仓库',
    prompt: '查看我 GitHub 上 mcp-browser-analyzer 仓库的 open issue 列表',
  },
  {
    match: (tools) => tools.some((t) => /sql|query|database/.test(t)),
    label: '🗄️ 查询本地数据库',
    prompt: '列出本地 SQLite 数据库里有哪些表和字段',
  },
]
const capabilityChips = computed(() => {
  const caps = capabilities.value
  if (!caps) return []
  // 把 MCP 工具剥成短名（mcp_fs_write_file → write_file）再做特征匹配
  const toolShortNames = caps.mcpServers.flatMap((s) =>
    s.tools.map((t) => t.name.replace(/^mcp_[a-z0-9]+?_/, ''))
  )
  return CAPABILITY_CHIPS.filter((c) => c.match(toolShortNames))
})

// 空态判定：greeting（连接成功提示）不算对话开始——chip 在 greeting 下方继续可见，
// 用户真正发起对话后才收起
const hasConversation = computed(() => messages.value.some((m) => !m.isGreeting))

const sendCapabilityChip = async (chip) => {
  if (blockIfTurnBusy()) return
  // 与快捷按钮同一套入场演出：先落一条用户消息再走 sendPrompt 通道
  messages.value.push({
    type: 'text',
    sender: 'user',
    content: chip.label,
    timestamp: Date.now(),
  })
  persistSession()
  thinking.value = true
  const ok = await sendPrompt(chip.prompt, undefined)
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

const requestCapabilities = () => {
  if (websocket && websocket.readyState === WebSocket.OPEN) {
    websocket.send(JSON.stringify({ type: 'list_capabilities' }))
  }
}

const toggleCapabilitiesPanel = () => {
  showHistoryList.value = false
  showKnowledgePanel.value = false
  showCapabilitiesPanel.value = !showCapabilitiesPanel.value
  // 每次打开都拉最新注册表：MCP server 可能刚被接入/下线
  if (showCapabilitiesPanel.value) requestCapabilities()
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
  showCapabilitiesPanel.value = false
  showKnowledgePanel.value = !showKnowledgePanel.value
  if (showKnowledgePanel.value) {
    // 每次打开回列表态（详情态是一次性的阅读动作，不跨开关保持）
    knowledgeView.value = 'list'
    detailKnowledgeId.value = ''
    loadKnowledge()
  }
}

// P11 搜索 + 状态筛选（复用会话历史面板的 keyword 过滤模式）
const knowledgeFiltered = computed(() => {
  const kw = knowledgeKeyword.value.trim().toLowerCase()
  return knowledgeList.value.filter((kp) => {
    if (knowledgeFilter.value !== 'all' && kp.status !== knowledgeFilter.value) return false
    if (kw && !`${kp.question}\n${kp.answer}`.toLowerCase().includes(kw)) return false
    return true
  })
})

// 详情态当前卡片：列表里被删时 computed 自动变 null，模板兜底显示列表
const detailKp = computed(
  () => knowledgeList.value.find((kp) => kp.id === detailKnowledgeId.value) || null
)

// 详情态来源里的 URL（source 形如「划词 · https://...」；URL 建卡时截到 80 字符，已知局限）
const detailKpUrl = computed(() => {
  const m = /https?:\/\/\S+/.exec(detailKp.value?.source || '')
  return m ? m[0] : ''
})

const openSourceUrl = (url) => {
  try {
    chrome.tabs.create({ url })
  } catch {
    /* 打不开就当纯文本，静默降级 */
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

// 手动添加：存完直接进详情态（原"自动展开新卡"行为平移）
const addKnowledgeManual = async () => {
  const kp = await createKnowledgeCard(newKnowledgeQuestion.value, '手输')
  if (kp) {
    newKnowledgeQuestion.value = ''
    knowledgeView.value = 'detail'
    detailKnowledgeId.value = kp.id
  }
}

// P11：点行进详情——补全改为详情里的显式按钮，不再"点卡即烧 LLM 调用"
const openKnowledgeDetail = (kp) => {
  knowledgeView.value = 'detail'
  detailKnowledgeId.value = kp.id
}

const backToKnowledgeList = () => {
  knowledgeView.value = 'list'
  detailKnowledgeId.value = ''
}

// P11 删除带 5s 撤销：卡片暂存 toast，撤销 = 原样回插
// （loadKnowledge 按 createdAt 降序，位置自然还原，无需记录原下标）
const deleteKnowledge = async (id) => {
  const kp = knowledgeList.value.find((k) => k.id === id)
  if (!kp) return
  await removeKnowledgePoint(id)
  await loadKnowledge()
  if (detailKnowledgeId.value === id) backToKnowledgeList()
  showUndoToast([kp], '已删除 1 条知识点')
}

// 清空全部：从裸写 storage 收口到 prefs 工具层（P11），同样给 5s 撤销
const clearAllKnowledge = async () => {
  if (!knowledgeList.value.length) return
  if (!confirm(`确认清空全部 ${knowledgeList.value.length} 条知识点？5 秒内可撤销`)) return
  const stash = knowledgeList.value
  await clearKnowledgePoints()
  knowledgeList.value = []
  backToKnowledgeList()
  showUndoToast(stash, `已清空 ${stash.length} 条知识点`)
}

const showUndoToast = (items, message) => {
  undoToast.value = { items, message }
  clearTimeout(undoTimer)
  undoTimer = setTimeout(() => {
    undoToast.value = null
  }, 5000)
}

const undoLastAction = async () => {
  const t = undoToast.value
  if (!t) return
  clearTimeout(undoTimer)
  undoToast.value = null
  for (const kp of t.items) await addKnowledgePoint(kp)
  await loadKnowledge()
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

// 补全 pending 卡片：P11 专用链路——服务端注册 knowledge_complete 提示词 + tools:[] 硬闸
// （此前未注册，补全白跑完整 ReAct Agent 还不带页面上下文）；显式按钮触发 + 90s 超时兜底
const KNOWLEDGE_COMPLETE_TIMEOUT = 90000
const completeKnowledge = async (kp) => {
  if (!kp || kp.status !== 'pending' || completingId.value) return
  if (blockIfTurnBusy()) return
  if (!websocket || websocket.readyState !== WebSocket.OPEN) {
    alert('请先启动 agent 服务（pnpm run agent-server）再补全答案')
    return
  }
  completingId.value = kp.id
  failedKpId.value = ''
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
  // 超时兜底：服务端既不回 agent_response 也不断连时，锁会永久卡死（后续补全全部进不去）
  clearTimeout(completingTimer)
  completingTimer = setTimeout(() => {
    if (completingId.value === kp.id) {
      completingId.value = ''
      failedKpId.value = kp.id
      thinking.value = false
    }
  }, KNOWLEDGE_COMPLETE_TIMEOUT)
  const ok = await sendPrompt(kp.question, 'knowledge_complete')
  if (!ok) {
    thinking.value = false
    completingId.value = ''
    failedKpId.value = kp.id
    clearTimeout(completingTimer)
    alert('连接已断开，请检查服务器是否正在运行。')
  }
}

// dph-A Turn/Step 可观测：把离散的 agent_step / workflow_progress 事件
// 归约成结构化执行轨迹（原实现是单帧覆盖，回答出现后整块丢弃，无法回看）
const {
  nodes: traceNodes,
  active: traceActive,
  currentLabel: traceCurrentLabel,
  graph: traceGraph,
  begin: beginTrace,
  reset: resetTrace,
  applyStep: applyTraceStep,
  applyWorkflow: applyTraceWorkflow,
  complete: completeTrace,
  snapshot: snapshotTrace,
  graphSnapshot: snapshotTraceGraph,
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
  if (message && traceGraph.value.length) {
    message.traceGraph = snapshotTraceGraph()
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
  // 回合归属绑定：本回合的一切事件归发起时的会话（切走后走后台缓冲）
  beginTurn()
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

// P15：把会话持久化历史重放到服务端对应会话的 Agent。
// 服务端 restore 是替换语义（store.replace，幂等）——无需先 clear_history；
// 运行中回合的会话跳过重放：其上下文正被运行中回合使用，重放会与之竞争
// （服务端该会话 Agent 的历史已包含回合内容，本就正确）
const restoreSessionToServer = (id) => {
  if (turnRegistry.has(id)) return
  if (!websocket || websocket.readyState !== WebSocket.OPEN) return
  const history = buildOpenAIHistory(messages.value)
  if (!history.length) return
  console.log('[Session] Restoring history to server session:', id, history.length)
  websocket.send(JSON.stringify({ type: 'restore_session', sessionId: id, history }))
}

// 后台回合落盘：把定格后的回合消息合并进归属会话的存储并刷新索引条目
// （回答不丢，回到该会话可见；会话已被删除则不复活索引）
const persistTurnToSession = async (id, turnMsgs) => {
  const stored = (await loadSessionMessages(id)).filter((m) => !m.streaming)
  const merged = [...stored, ...pickPersistable(turnMsgs)]
  await chrome.storage.local.set({ [`ba_session_${id}`]: { id, messages: merged } })
  const { [SESSION_INDEX_KEY]: sessions = [] } = await chrome.storage.local.get(SESSION_INDEX_KEY)
  if (!sessions.some((s) => s.id === id)) return
  const prev = sessions.find((s) => s.id === id)
  const entry = { ...prev, updatedAt: Date.now(), msgCount: merged.length }
  const next = [entry, ...sessions.filter((s) => s.id !== id)].slice(0, MAX_SESSIONS)
  sessionList.value = next
  await chrome.storage.local.set({ [SESSION_INDEX_KEY]: next })
}

// 知识点补全收尾：把答案写回对应卡片并标记 done（前台/后台回合共用）
const finalizeKnowledgeCompletion = async (data, finalContent) => {
  if (!completingId.value) return
  const doneId = completingId.value
  completingId.value = ''
  clearTimeout(completingTimer)
  if (data.success && finalContent) {
    failedKpId.value = ''
    await updateKnowledgePoint(doneId, {
      answer: finalContent.slice(0, 2000),
      status: 'done',
    })
  } else {
    // P11：失败不再静默——卡片留 pending，详情态提示"可重试"
    failedKpId.value = doneId
  }
  await loadKnowledge()
}

// 后台回合收尾（事件归属会话 ≠ 当前查看会话）：定格缓冲 → 落盘归属会话 → 提示
// P15：服务端每会话独立 Agent，回合结束后该会话上下文本就正确，无需再重放同步
const handleBackgroundResponse = async (data, owner) => {
  const finished = turnRegistry.end(owner)
  syncTurnMirror()
  if (!finished) return
  const traceStatus = data.success
    ? TRACE_STATUS.SUCCESS
    : data.error === 'cancelled'
      ? TRACE_STATUS.CANCELLED
      : TRACE_STATUS.FAILED
  completeTrace(traceStatus)
  const msgs = finalizeTurnMessages(finished.buffer, data)
  // 轨迹随最终消息持久化（与前台 finishTrace 同口径，回到该会话可回看）
  const lastAi = [...msgs].reverse().find((m) => m.type === 'text' && m.sender === 'ai')
  if (lastAi) {
    if (traceNodes.value.length) lastAi.trace = snapshotTrace()
    if (traceGraph.value.length) lastAi.traceGraph = snapshotTraceGraph()
  }
  resetTrace()
  const finalContent = lastAi?.content || ''
  // F5-2 文章索引与补全等后置逻辑不依赖当前视图会话，后台完成同样生效
  if (data.success && lastSentAction === 'summarize' && finalContent) {
    recordArticleIndex(finalContent)
  }
  await finalizeKnowledgeCompletion(data, finalContent)
  lastSentAction = ''
  if (!finished.discarded) {
    await persistTurnToSession(owner, msgs)
    const stopped = data.error === 'cancelled'
    showTurnToast(
      stopped
        ? `「${finished.title}」后台回答已停止`
        : data.success
          ? `「${finished.title}」已在后台完成回复，点击查看`
          : `「${finished.title}」后台回复失败，点击查看`,
      owner
    )
  }
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
  // 回合进行中切走：回合消息抽离进缓冲（切回时并回），事件改走后台缓冲
  if (turnRegistry.has(sessionId.value)) {
    turnRegistry.detach(sessionId.value, messages.value)
  }
  await flushSession()
  sessionId.value = id
  messages.value = (await loadSessionMessages(id)).filter((m) => !m.streaming)
  // 切回回合归属会话：缓冲并回，流式/审批卡恢复实时直写与交互
  if (turnRegistry.has(id)) {
    turnRegistry.attach(id, messages.value)
  }
  pendingSelection.value = ''
  showHistoryList.value = false
  autoFollow.value = true
  await chrome.storage.local.set({ ba_current_session: id })
  // P15：恢复目标会话在服务端的上下文（会话级替换，幂等；运行中回合的会话内部跳过）
  restoreSessionToServer(id)
}

// 新建会话
const startNewSession = async () => {
  if (turnRegistry.has(sessionId.value)) {
    turnRegistry.detach(sessionId.value, messages.value)
  }
  await flushSession()
  sessionId.value = createSessionId()
  messages.value = []
  pendingSelection.value = ''
  showHistoryList.value = false
  await chrome.storage.local.set({ ba_current_session: sessionId.value })
  await flushSession() // 建立新会话占位，保证索引立即可见
  if (turnRegistry.busyIds().length > 0) {
    // 串台修复的核心场景：回答不再串进新会话，而是在原会话后台跑完后提示。
    // 新会话 id 在服务端还没有任何上下文，无需 clear
    showTurnToast('已新建会话，后台回合完成后会自动送达原会话', turnRegistry.busyIds()[0])
  }
  nextTick(() => inputRef.value?.focus())
}

// 删除单个会话
// 注意：删除当前会话时不能走 flushSession()（会把已删 id 的索引/消息重新写回 storage），必须手动切换
const deleteSession = async (id) => {
  if (turnRegistry.has(id)) {
    // 删除正在回复的会话 = 放弃该回合：精确停掉该会话任务，收尾不落盘不提示
    turnRegistry.discard(id)
    if (websocket && websocket.readyState === WebSocket.OPEN) {
      websocket.send(JSON.stringify({ type: 'cancel_request', sessionId: id }))
    }
  } else if (id === sessionId.value && websocket && websocket.readyState === WebSocket.OPEN) {
    // 同步清掉服务端该会话的上下文（会话级 clear）
    websocket.send(JSON.stringify({ type: 'clear_history', sessionId: id }))
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
      restoreSessionToServer(next[0].id)
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
  const running = turnRegistry.busyIds()
  if (running.length > 0) {
    // 有运行中回合等同删除其归属会话：放弃全部回合（不落盘），停掉该连接所有任务
    running.forEach((sid) => turnRegistry.discard(sid))
    syncTurnMirror()
    if (websocket && websocket.readyState === WebSocket.OPEN) {
      websocket.send(JSON.stringify({ type: 'cancel_request' }))
    }
  }
  const { [SESSION_INDEX_KEY]: sessions = [] } = await chrome.storage.local.get(SESSION_INDEX_KEY)
  await chrome.storage.local.remove(sessions.map((s) => `ba_session_${s.id}`))
  await chrome.storage.local.remove(SESSION_INDEX_KEY)
  sessionList.value = []
  sessionId.value = createSessionId()
  messages.value = []
  pendingSelection.value = ''
  showHistoryList.value = false
  await chrome.storage.local.set({ ba_current_session: sessionId.value })
}

const toggleHistoryList = () => {
  showKnowledgePanel.value = false
  showCapabilitiesPanel.value = false
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

// P16：回合工作 tab——服务端为每个会话记忆"该回合最近触碰的 tab"，工具命令带
// tabId 提示；有效则粘住（用户切窗口/多会话并行都不串页），无效或缺失回落 activeTab
const resolveWorkingTab = async (hintTabId) => {
  if (Number.isFinite(hintTabId)) {
    try {
      const tab = await chrome.tabs.get(hintTabId)
      if (tab && /^https?:/i.test(tab.url || '')) return tab
    } catch (e) {
      // 提示 tab 已关闭：回落 activeTab
    }
  }
  return getActiveTab()
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
// P15：带 sessionId 精确停当前会话的回合（跨会话并行下不能误伤后台回合）
const cancelAgentTask = () => {
  if (!websocket || websocket.readyState !== WebSocket.OPEN) return
  websocket.send(JSON.stringify({ type: 'cancel_request', sessionId: sessionId.value }))
  messages.value.push({
    type: 'text',
    sender: 'user',
    content: '停止生成',
    // 本地回显标记：不参与回合边界判定（turn-router 找回合触发消息时跳过）
    isLocalNotice: true,
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
      // F4 + P15：重连后服务端全新 Agent（内存历史为空），把当前会话持久化历史
      // 重放到对应会话的 Agent（替换语义，幂等）
      restoreSessionToServer(sessionId.value)
      // P10 能力可见性：连接建立即拉能力清单；若 MCP 注册尚未完成，
      // 服务端注册结束时会广播 capabilities 补推，两条通道互为兜底
      requestCapabilities()
      if (messages.value.length === 0) {
        messages.value.push({
          type: 'text',
          sender: 'ai',
          content: '连接成功！选中网页文字或点击"总结本页"即可开始，也可以直接问我问题。',
          timestamp: Date.now(),
          isGreeting: true, // P10 空态引导：greeting 不算对话开始，能力 chip 继续展示
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
            const tokenOwner = turnOwnerOf(data)
            if (!isBgOwner(tokenOwner)) thinking.value = false
            if (isBgOwner(tokenOwner)) {
              // 后台回合：增量写进该会话的缓冲（普通对象，不进当前查看会话的消息数组），
              // 回合结束落盘归属会话；用户切回时缓冲并回恢复实时直写
              const rec = turnRegistry.record(tokenOwner) || turnRegistry.begin(tokenOwner)
              appendTurnToken(rec.buffer, data.content)
              break
            }
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
            const responseOwner = turnOwnerOf(data)
            if (isBgOwner(responseOwner)) thinking.value = false
            // 回合已切后台：走后台收尾（定格缓冲→落盘归属会话→提示），不进当前会话
            if (isBgOwner(responseOwner)) {
              await handleBackgroundResponse(data, responseOwner)
              break
            }
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
            await finalizeKnowledgeCompletion(data, finalContent)
            lastSentAction = ''
            persistSession()
            // 回合结束：移除该会话的归属记录（此后本会话可再发送）
            turnRegistry.end(responseOwner)
            syncTurnMirror()
            break
          }

          case 'performance_data': {
            const perfOwner = turnOwnerOf(data)
            thinking.value = false
            const perfCard = {
              type: 'performance',
              sender: 'ai',
              data: data.payload,
              timestamp: Date.now(),
            }
            if (isBgOwner(perfOwner)) {
              const rec = turnRegistry.record(perfOwner) || turnRegistry.begin(perfOwner)
              rec.buffer.push(perfCard)
            } else {
              messages.value.push(perfCard)
              persistSession()
            }
            break
          }

          case 'thinking': {
            const stepOwner = turnOwnerOf(data)
            // 后台回合不在当前会话冒"思考中"气泡（状态条已标明后台归属）；
            // 轨迹归约器同一时刻只服务一个回合：前台回合占用时后台回合不碰
            if (isBgOwner(stepOwner)) {
              if (!turnRegistry.has(sessionId.value)) beginTrace()
              break
            }
            thinking.value = true
            compressNoticedThisTurn = false
            beginTrace()
            break
          }

          // dph-A Turn/Step 执行模型：Agent 每完成一个 Step（推理/工具执行）推送事件，
          // 前端归约成轨迹节点而非单帧覆盖，用户可看到完整执行过程
          case 'agent_step': {
            const stepOwner = turnOwnerOf(data)
            // 轨迹归约器被前台回合占用时，后台回合的 step 只进缓冲不进全局轨迹
            if (isBgOwner(stepOwner) && turnRegistry.has(sessionId.value)) {
              break
            }
            applyTraceStep(data)
            // 压缩真实发生时在对话流里冒一条提示（含视图 token 前后值），每回合最多一条
            if (data.phase === 'compress' && data.compressed > 0 && !compressNoticedThisTurn) {
              compressNoticedThisTurn = true
              const saved =
                Number.isFinite(data.tokensBefore) && Number.isFinite(data.tokensAfter)
                  ? `，视图 token ${data.tokensBefore} → ${data.tokensAfter}`
                  : ''
              const notice = {
                type: 'compress_notice',
                sender: 'ai',
                content: `📦 上下文已压缩：${data.compressed} 条早期消息转为摘要${saved}`,
                timestamp: Date.now(),
              }
              if (isBgOwner(stepOwner)) {
                const rec = turnRegistry.record(stepOwner) || turnRegistry.begin(stepOwner)
                rec.buffer.push(notice)
              } else {
                messages.value.push(notice)
                persistSession()
              }
            }
            break
          }

          case 'cancel_ack':
            // 取消已受理，等待 agent_response(已停止) 收尾
            break

          // M1-F8 深度研究：进度推送 → 归约进执行轨迹
          // 原实现把每条进度当消息 push，几十条进度会把对话流冲掉，
          // 且失败步骤需要靠 sticky 标记硬留痕；改由轨迹层做分层与状态标记
          case 'workflow_progress': {
            const wfOwner = turnOwnerOf(data)
            if (isBgOwner(wfOwner)) {
              if (!turnRegistry.has(sessionId.value)) thinking.value = false
              if (!turnRegistry.has(sessionId.value)) applyTraceWorkflow(data)
              break
            }
            thinking.value = false
            applyTraceWorkflow(data)
            break
          }

          // M1-F8 深度研究：HITL 询问（暂停等待用户答复）——evidence 是"为什么打断"的证据
          case 'workflow_ask': {
            const askOwner = turnOwnerOf(data)
            thinking.value = false
            const askCard = {
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
            }
            if (isBgOwner(askOwner)) {
              const rec = turnRegistry.record(askOwner) || turnRegistry.begin(askOwner)
              insertBeforeStreaming(rec.buffer, askCard)
              showTurnToast(
                `「${rec.title || '后台会话'}」深度研究需要你的确认，点击处理`,
                askOwner
              )
            } else {
              insertBeforeStreaming(messages.value, askCard)
              persistSession()
            }
            break
          }

          // P4 分级权限 HITL：写操作审批请求（卡片展示工具/目标/值，等用户放行或拒绝）
          case 'write_approval': {
            const approvalOwner = turnOwnerOf(data)
            thinking.value = false
            const approvalCard = {
              type: 'write_approval',
              sender: 'ai',
              requestId: data.requestId,
              tool: data.tool,
              args: data.args || {},
              taint: Array.isArray(data.taint) ? data.taint : [],
              pending: true,
              approved: false,
              rememberChecked: false,
              timestamp: Date.now(),
            }
            if (isBgOwner(approvalOwner)) {
              // 审批卡不落盘（瞬态消息），进缓冲等切回后可交互；必须提示，否则回合会一直等
              const rec = turnRegistry.record(approvalOwner) || turnRegistry.begin(approvalOwner)
              insertBeforeStreaming(rec.buffer, approvalCard)
              showTurnToast(`「${rec.title || '后台会话'}」等待你审批写操作，点击处理`, approvalOwner)
            } else {
              insertBeforeStreaming(messages.value, approvalCard)
              scrollToBottom()
            }
            break
          }

          // P4 写操作链路：审批通过后真实执行 / 只读枚举可交互元素，经 background 到 content script
          case 'write_action':
          case 'get_interactive_elements':
          // P12b：fill_form 走 write_action 同通道；wait_for 只读等待
          case 'wait_for':
            forwardWriteChain(data)
            break

          // 会话用量汇总：每次回答/研究结束后推送，驱动输入区上方的用量条
          case 'usage_summary':
            usageSummary.value = { session: data.session, total: data.total }
            break

          // P10 能力可见性：能力清单快照（onopen 拉取 + MCP 注册完成广播共用此类型），
          // 工具箱面板与空态 chip 都吃这份数据
          case 'capabilities':
            capabilities.value = data.capabilities || null
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
                tabId: data.tabId,
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
                tabId: data.tabId,
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
                const tab = await resolveWorkingTab(data.tabId)
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
                const tab = await resolveWorkingTab(data.tabId)
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
                const tab = await resolveWorkingTab(data.tabId)
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
      // 断连即全部回合死亡（服务端对未完成任务 abort）：清空归属注册表，
      // 避免发送被永久阻塞
      turnRegistry.reset()
      syncTurnMirror()
      thinking.value = false
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
  if (!inputText.value.trim() || blockIfTurnBusy()) {
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
      remember: approved ? msg.rememberChecked === true : false,
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
// P12c 收尾：直发 tabs.sendMessage（与探针同路径，砍掉 runtime→background→tabs 中间跳）。
// 此前经 background 中转的路径在 SW 唤醒/多上下文竞态下 flaky（"message port closed"
// 连环失败的真凶）——直发路径在历次 e2e 与探针中百发百中
const WRITE_CHAIN_TARGET_URL = 'https://www.zhipin.com/'
const findContentTab = async (hintTabId) => {
  // P16：工作 tab 提示优先（该回合最近触碰的 tab；有效则粘住，多会话并行不互抢）
  if (Number.isFinite(hintTabId)) {
    try {
      const tab = await chrome.tabs.get(hintTabId)
      if (tab && /^https?:/i.test(tab.url || '')) return tab.id
    } catch (e) {
      // 提示 tab 已关闭：回落常规解析
    }
  }
  const tabs = await chrome.tabs.query({ url: [`${WRITE_CHAIN_TARGET_URL}*`, 'http://www.zhipin.com/*'] })
  if (tabs.length) return tabs[tabs.length - 1].id
  const all = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] })
  if (!all.length) throw new Error('未找到可操作的内容页标签页')
  return all[all.length - 1].id
}

const forwardWriteChain = async (data) => {
  const resType =
    data.type === 'write_action'
      ? 'write_action_result'
      : data.type === 'wait_for'
        ? 'wait_for_result'
        : 'interactive_elements'
  const respondOk = (payload) => sendToolResponse(resType, data.requestId, payload, 'Write chain completed')
  const respondErr = (err) => sendToolResponse(resType, data.requestId, { error: err }, err)
  const isWrite = data.type === 'write_action'
  // P13 自动投递：agent 一条龙要连续调用 15-20 轮工具，点击引发的页面跳转会让
  // 下一次调用撞上"旧 content script 已死、新文档还没注入完"的窗口——单次发送
  // 必然偶发 "Receiving end does not exist" / "message port closed"。
  // 修复：瞬态通道错误按退避重试（400ms/800ms/1600ms），每轮重新解析目标 tab。
  // 分类重试边界：
  // - 读操作（枚举/wait_for）：三种瞬态错误都安全重试；
  // - 写操作：仅"消息未送达"（Receiving end does not exist）可重试；
  //   "回包丢失"（message port closed）说明消息已送达、动作可能已执行——重发有
  //   双击/双填风险，转自纠话术让 LLM 重新枚举确认页面状态后再决定
  let lastDetail = `${data.type} failed`
  for (let attempt = 1; attempt <= 4; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 2)))
    let target = null
    try {
      target = await findContentTab(data.tabId)
      let response
      try {
        response = await sendWriteMessage(target, data)
      } catch (e) {
        const msg = String(e?.message || e)
        if (!msg.includes('Receiving end does not exist')) throw e
        lastDetail = msg
        // 通道未建立（页面早于扩展加载/点击跳转后新文档）→ 补注入后重发
        // （content script 有幂等守卫，重复注入不会产生双监听器）
        await chrome.scripting.executeScript({ target: { tabId: target }, files: ['dist/src/content-script/index.js'] })
        response = await sendWriteMessage(target, data)
      }
      if (response?.success && response.payload) {
        // P16：标注实际执行的 tabId，服务端回捕为该会话的工作 tab
        respondOk({ ...response.payload, tabId: target })
        return
      }
      // 页面业务错误（ref 失效、元素不可见等）：与通道无关，直接回传给 LLM 自纠
      lastDetail = response?.error || `${data.type} failed`
      respondErr(lastDetail)
      return
    } catch (error) {
      lastDetail = String(error?.message || error)
      const notDelivered = lastDetail.includes('Receiving end does not exist')
      const responseLost = lastDetail.includes('message port closed')
      const transient =
        notDelivered ||
        responseLost ||
        lastDetail.includes('Frame with ID') ||
        lastDetail.includes('cannot be scripted') ||
        lastDetail.includes('discarded')
      if (!transient) break
      if (isWrite && responseLost) {
        lastDetail = '写操作已下发但回包丢失（页面可能已跳转），无法确认是否生效。请先重新枚举页面元素确认当前状态，再决定是否重试该操作'
        break
      }
      // 读操作或"未送达"：退避后重试
    }
  }
  chrome.storage.local.set({ lastForwardError: { at: Date.now(), type: data.type, target: null, detail: lastDetail } }).catch(() => void 0)
  console.error('[forwardWriteChain] failed:', lastDetail)
  respondErr(lastDetail)
}

const sendWriteMessage = (tid, data) =>
  chrome.tabs.sendMessage(tid, {
    type: data.type,
    requestId: data.requestId,
    action: data.action,
    ref: data.ref, // P12a：元素引用身份
    value: data.value,
    fields: data.fields, // P12b：fill_form 批量字段
    texts: data.texts, // P12b：wait_for 候选文本
    timeoutMs: data.timeoutMs,
    maxElements: data.maxElements,
  })

// M1-F8 深度研究：以输入框内容为研究问题，显式触发深度研究工作流
const handleResearch = async () => {
  if (blockIfTurnBusy()) return
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
  if (blockIfTurnBusy()) {
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
  if (blockIfTurnBusy()) {
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

  if (blockIfTurnBusy()) return

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
const onRuntimeMessage = (request, sender, sendResponse) => {
  if (request.type === 'text_action_relay') {
    handleTextAction(request)
    // 广播已成功到达，清掉 storage 里同一条，避免下次打开侧边栏重复触发
    chrome.storage.session.remove('pendingTextAction').catch(() => void 0)
  }
  // P12c 可信输入：SidePanel 常驻不睡且持 chrome.debugger（SW 消息路由竞态的绕行方案），
  // content script 解析 ref 后把视口坐标 + 自身 tabId 发来，这里发真实受信点击
}

onMounted(async () => {

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
/* 字体：ui-ux-pro-max skill「Developer Mono」字配——代码/数据用 JetBrains Mono，
   在线加载失败回落系统 mono 栈（CSP 仅限 script，style 引入不受限） */
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap');
/* ===== 设计令牌 =====
 * 浅色为唯一主题（2026-10-20 移除暗色：使用频率低，双主题配色维护易出 BUG）。
 * 命名按语义不按色相：调主题只改这里，其余 1400 行样式全部引用 var()。
 */
.chat-container {
  /* 面板底色分层：bg（页面）→ surface（区块）→ raised（浮层卡片）*/
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
  /* AI-Native UI 设计变量（同暗色块，亮色主题共用） */
  --message-gap: 16px;
  --typing-dot-size: 8px;
  --font-mono: 'JetBrains Mono', 'Cascadia Code', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  --on-accent: #ffffff;
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

/* P11 搜索 + 状态筛选 */
.knowledge-search {
  width: 100%;
  margin-bottom: 6px;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 12.5px;
  outline: none;
  transition: border-color 0.15s;
}

.knowledge-search:focus {
  border-color: var(--info);
}

.knowledge-filters {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}

.knowledge-filter-chip {
  padding: 3px 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: transparent;
  color: var(--text-3);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}

.knowledge-filter-chip.active {
  background: var(--accent-soft);
  border-color: var(--accent-border);
  color: var(--accent-strong);
}

.knowledge-empty {
  padding: 24px 16px;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.7;
}

/* P11 列表态：单行卡 = 状态点 + 问题 + 悬浮删除（信息密度优先，详情进二级） */
.knowledge-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.15s;
}

.knowledge-row:hover {
  background: var(--bg);
}

.knowledge-dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success);
}

.knowledge-dot.pending {
  background: var(--warn-strong);
}

.knowledge-question {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--text-1);
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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

.knowledge-row:hover .knowledge-delete {
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

/* P11 详情态：来源含 URL 时可点击跳回原页 */
.knowledge-source-link {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: var(--info);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: right;
  cursor: pointer;
}

.knowledge-source-link:hover {
  text-decoration: underline;
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

/* P11 详情态：返回 / 操作区 / 骨架屏 / 底部删除 */
.knowledge-back {
  display: inline-flex;
  align-items: center;
  margin-bottom: 8px;
  padding: 4px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.15s;
}

.knowledge-back:hover {
  background: var(--surface);
  color: var(--text-1);
}

.knowledge-detail-question {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-1);
  line-height: 1.5;
  word-break: break-word;
}

.knowledge-detail-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.knowledge-complete-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: none;
  border-radius: 8px;
  background: var(--info-strong);
  color: var(--on-accent);
  font-size: 12.5px;
  cursor: pointer;
  transition: background-color 0.15s;
}

.knowledge-complete-btn:hover:not(:disabled) {
  filter: brightness(1.1);
}

.knowledge-complete-btn:disabled {
  opacity: 0.7;
  cursor: wait;
}

.knowledge-detail-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
  padding-top: 8px;
  border-top: 1px solid var(--surface);
}

.knowledge-delete-detail {
  padding: 4px 12px;
  border: 1px solid var(--danger-border);
  border-radius: 8px;
  background: transparent;
  color: var(--danger);
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.15s;
}

.knowledge-delete-detail:hover {
  background: var(--danger-soft);
}

/* 骨架屏：补全中 shimmer 占位（替代"正在补全..."纯文案） */
.knowledge-skeleton {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skeleton-line {
  height: 12px;
  border-radius: 6px;
  background: linear-gradient(
    90deg,
    var(--surface) 25%,
    var(--surface-raised) 50%,
    var(--surface) 75%
  );
  background-size: 400% 100%;
  animation: skeletonShimmer 1.4s ease infinite;
}

.skeleton-line.w60 {
  width: 60%;
}

.skeleton-line.w80 {
  width: 80%;
}

@keyframes skeletonShimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: 0 0;
  }
}

.knowledge-hint {
  margin-top: 8px;
  font-size: 11px;
  color: var(--warn-strong);
}

.knowledge-hint.is-failed {
  color: var(--danger);
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

/* ===== P12c 执行中状态条 ===== */
.exec-status {
  position: absolute;
  top: 52px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 90;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 14px;
  border-radius: 999px;
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  color: var(--accent-strong);
  font-size: 11.5px;
  white-space: nowrap;
  box-shadow: 0 2px 8px rgba(var(--accent-rgb), 0.15);
}

.exec-spinner {
  width: 10px;
  height: 10px;
  border: 2px solid var(--accent-border);
  border-top-color: var(--accent-strong);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}

/* 后台回合：状态条可点击跳回归属会话 */
.exec-status.exec-bg {
  cursor: pointer;
}

.exec-fade-enter-active,
.exec-fade-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.exec-fade-enter-from,
.exec-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-4px);
}

/* ===== P11 撤销删除轻提示（输入区上方，5 秒自动消失） ===== */
.undo-toast {
  position: absolute;
  bottom: 84px;
  left: 12px;
  right: 12px;
  z-index: 200;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 20px rgba(var(--ink-rgb), 0.16);
  font-size: 12.5px;
  color: var(--text-1);
  animation: panelFade 0.15s ease;
}

.undo-toast-text {
  flex: 1;
  min-width: 0;
}

.undo-toast-btn {
  flex-shrink: 0;
  padding: 4px 12px;
  border: 1px solid var(--accent-border);
  border-radius: 6px;
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.15s;
}

.undo-toast-btn:hover {
  background: var(--accent-border);
}

/* 后台回合提示：整条可点击跳回 */
.turn-toast {
  cursor: pointer;
}

.toast-fade-enter-active,
.toast-fade-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.toast-fade-enter-from,
.toast-fade-leave-to {
  opacity: 0;
  transform: translateY(6px);
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
  gap: var(--message-gap);
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

/* ===== P10 空态引导 chip：由真实注册的 MCP server 驱动 ===== */
.capability-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
  margin-top: 10px;
}

.capability-chip {
  padding: 6px 10px;
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  border-radius: 16px;
  font-size: 12px;
  color: var(--accent-strong);
  cursor: pointer;
  transition:
    background-color 0.15s,
    border-color 0.15s;
}

.capability-chip:hover {
  background: var(--accent-border);
  border-color: var(--accent-strong);
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

/* AI-Native：AI 气泡左侧 accent 竖线（context card 样式），与用户气泡的渐变底
   形成"谁在说话"的强区分；用户气泡走上面的渐变覆盖不受影响 */
.message-item.ai-message .message-bubble {
  border-left: 2px solid var(--accent-border);
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
  font-family: var(--font-mono);
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
  font-family: var(--font-mono);
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

/* P12a：审批卡上的 ref 徽章（元素引用身份，执行前经内容脚本身份校验） */
.ask-evidence-ref {
  display: inline-block;
  margin-left: 4px;
  padding: 0 6px;
  border: 1px solid var(--info-border);
  border-radius: 8px;
  background: var(--info-soft);
  color: var(--info-strong);
  font-family: var(--font-mono);
  font-size: 10px;
}

/* P12b：fill_form 批量字段列表 */
.ask-evidence-fields {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 0;
  border-top: 1px dashed var(--border);
}

/* P16.1 审批记忆勾选框：弱化视觉，不抢主操作 */
.approval-remember {
  flex-basis: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--text-2);
  cursor: pointer;
  user-select: none;
}

.approval-remember input {
  accent-color: var(--accent);
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
  width: var(--typing-dot-size);
  height: var(--typing-dot-size);
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
