const fs = require('fs')
const path = require('path')
const { v4: uuidv4 } = require('uuid')
const { handleToolCall } = require('../tools/handler.js')
const {
  RESEARCH_PLAN_PROMPT,
  RESEARCH_TOPIC_PROMPT,
  RESEARCH_REPORT_PROMPT,
} = require('../config/prompts.js')

const CHECKPOINT_DIR = path.join(__dirname, '../../checkpoint')

/**
 * 深度研究工作流（M1-F8）
 *
 * 自研轻量状态机，编排思想对齐 LangGraph 的四个核心概念：
 * - State：程序显式持有的研究进度（子问题/各主题要点/来源/报告），不靠 LLM 记对话历史
 * - 节点：plan → research（逐主题）→ compare → report
 * - 条件边：grade 判断信息够不够（sufficient）→ 不够且未超限则换 URL 重试；够了进下一主题
 * - checkpoint：每个节点完成后落盘 JSON，服务重启可从断点恢复（崩溃不重头来）
 * - HITL：每完成一个主题暂停询问用户方向（继续/停止/自定义），确认后继续
 *
 * 为什么自研而非直接引 @langchain/langgraph（面试可讲，见 RETROSPECT）：
 * - 深度研究只有一条工作流，自研约 200 行可控可讲；LangGraph JS 版需引 langchain/core 全家桶
 * - 状态机接口（start/节点/条件边/checkpoint/HITL）与 LangGraph 一一对应，未来多工作流可平滑迁移
 * - 与 ADR-1"按复杂度选型"一致：固定任务模板 / 开放对话 ReAct / 深度研究状态图
 */
class ResearchWorkflow {
  /**
   * @param {object} llm - LLMClient 实例（依赖注入，便于单测）
   * @param {object} [options] - 硬约束配置
   */
  constructor(llm, options = {}) {
    this.llm = llm
    // 工具调用函数（依赖注入，便于单测 mock）
    this.toolCall = options.toolCaller || handleToolCall
    // 硬约束：不靠 LLM 自觉，代码写死上限（LangGraph 中由条件边保证）
    this.maxTopics = options.maxTopics || 3
    this.maxPagesPerTopic = options.maxPagesPerTopic || 3
    this.maxAttempts = options.maxAttempts || 2 // 每主题信息不足时的重试轮次
    this.checkpointEnabled = options.checkpoint !== false
    this.hitlEnabled = options.hitl !== false
    this.hitlTimeoutMs = options.hitlTimeoutMs || 120000 // HITL 等待用户答复超时
  }

  /**
   * 启动/恢复一次深度研究
   * @param {string} question - 研究问题
   * @param {object} [opts] - { connectionId, onProgress, onAsk, onToken }
   * @returns {Promise<{success:boolean, content:string, state:object}>}
   */
  async start(question, opts = {}) {
    const { connectionId, onProgress, onAsk, onToken } = opts
    const state = await this.loadOrCreate(question)

    this.emit(state, onProgress, `开始深度研究：「${question}」`)

    // 状态机主循环：step 字段驱动（等价于 LangGraph 图执行到终止节点的过程）
    while (true) {
      switch (state.step) {
        case 'plan':
          await this.planNode(state, onProgress)
          break
        case 'research':
          await this.researchNode(state, { connectionId, onProgress, onAsk })
          break
        case 'compare':
          await this.compareNode(state, onProgress)
          break
        case 'report':
          await this.reportNode(state, { onProgress, onToken })
          break
        case 'done':
          return { success: true, content: state.report, state }
        case 'failed':
          return { success: false, error: state.error, content: state.error, state }
        default:
          state.step = 'failed'
          state.error = `Unknown workflow step: ${state.step}`
          this.saveCheckpoint(state)
          return { success: false, error: state.error, content: state.error, state }
      }
      this.saveCheckpoint(state) // 节点级持久化：每次节点切换后落盘（对应 checkpoint）
    }
  }

  // ===== 节点：plan（规划子问题） =====
  async planNode(state, onProgress) {
    this.emit(state, onProgress, '正在拆解研究问题...')
    const response = await this.llm.chat(
      [{ role: 'user', content: `研究问题：${state.question}` }],
      [],
      RESEARCH_PLAN_PROMPT
    )
    const parsed = parseJSON(response.content)
    const subQuestions = Array.isArray(parsed?.subQuestions) ? parsed.subQuestions : []
    if (subQuestions.length === 0) {
      // plan 失败兜底：无法拆解时按原问题单主题继续，不让整个研究挂掉
      state.plan = [{ question: state.question, urls: [], points: [], sufficient: false, attempts: 0 }]
    } else {
      state.plan = subQuestions
        .slice(0, this.maxTopics)
        .map((t) => ({
          question: String(t.question || '').slice(0, 200),
          urls: Array.isArray(t.urls) ? t.urls.map(String).slice(0, this.maxPagesPerTopic) : [],
          points: [],
          sufficient: false,
          attempts: 0,
        }))
    }
    state.currentTopic = 0
    state.step = 'research'
    this.emit(
      state,
      onProgress,
      `已规划 ${state.plan.length} 个子问题：${state.plan.map((t) => t.question).join('；')}`
    )
  }

  // ===== 节点：research（逐主题调研，含 grade 条件边 + HITL） =====
  async researchNode(state, { connectionId, onProgress, onAsk }) {
    // 全部主题完成 → 条件边：进 compare
    if (state.currentTopic >= state.plan.length) {
      state.step = 'compare'
      this.emit(state, onProgress, '全部主题调研完成，开始交叉对比')
      return
    }

    const topic = state.plan[state.currentTopic]
    const topicLabel = `${state.currentTopic + 1}/${state.plan.length}「${topic.question}」`

    // 信息已足够（重试轮次内由 grade 判断过）→ 条件边：直接进下一主题
    if (topic.sufficient) {
      this.emit(state, onProgress, `主题 ${topicLabel}：信息已足够`)
      this.advanceTopic(state)
      return
    }

    // 重试次数超限 → 条件边兜底：带着已有信息进下一主题，不阻塞整个研究
    if (topic.attempts >= this.maxAttempts) {
      this.emit(state, onProgress, `主题 ${topicLabel}：多次尝试后信息仍不足（不阻塞，继续后续主题）`)
      this.advanceTopic(state)
      return
    }

    topic.attempts++
    this.emit(state, onProgress, `正在调研主题 ${topicLabel}（第 ${topic.attempts} 轮）`)

    const sources = await this.fetchAndGradeTopic(state, connectionId, onProgress)
    state.sources = state.sources.concat(sources)

    // grade 条件边：sufficient 或本轮取到过内容但还没攒够 → 下一轮尝试
    if (topic.sufficient) {
      this.emit(state, onProgress, `主题 ${topicLabel}：调研完成（${topic.points.length} 条要点）`)
      this.advanceTopic(state)
    } else if (topic.attempts < this.maxAttempts) {
      // 信息不足且还有余量：让 LLM 基于缺口补充候选 URL（对应"重写查询再搜"）
      const gap = topic.gap || '信息不足'
      this.emit(state, onProgress, `主题 ${topicLabel}：信息不足（${gap}），尝试补充来源...`)
      await this.suggestMoreUrls(topic)
    } else {
      this.emit(state, onProgress, `主题 ${topicLabel}：达到重试上限，使用已有信息`)
      this.advanceTopic(state)
    }

    // HITL：每完成一个主题暂停，询问用户是否继续（对应 LangGraph human-in-the-loop interrupt）
    if (this.hitlEnabled && onAsk && state.step === 'research' && state.currentTopic < state.plan.length) {
      const next = state.plan[state.currentTopic]
      const answer = await this.askUser(
        onAsk,
        `已完成 ${state.currentTopic}/${state.plan.length} 个主题调研。是否继续研究下一个主题「${next.question}」？`,
        ['继续研究', '停止研究']
      )
      if (answer.cancel) {
        this.emit(state, onProgress, '用户选择停止，基于已收集资料生成报告')
        state.step = 'compare'
        return
      }
      if (answer.text && !['继续研究', '继续'].includes(answer.text.trim())) {
        // 用户自定义方向：插入为下一个待调研主题（HITL 真正的"调方向"价值）
        state.plan.splice(state.currentTopic, 0, {
          question: answer.text.trim().slice(0, 200),
          urls: [],
          points: [],
          sufficient: false,
          attempts: 0,
        })
        this.emit(state, onProgress, `已加入新调研方向：「${answer.text.trim()}」`)
      }
    }
  }

  /**
   * 调研当前主题：逐个抓取候选 URL，正文交给 LLM 提炼要点并评估是否足够（grade）
   * @param {object} state - 当前 State（含 plan/currentTopic）
   * @returns {Array} 本次新增的来源列表
   */
  async fetchAndGradeTopic(state, connectionId, onProgress) {
    const topic = state.plan[state.currentTopic]
    const newSources = []
    for (const url of topic.urls) {
      this.emit(state, onProgress, `  读取页面：${url}`)
      let page = null
      try {
        // 复用工具封装：fetch_url 由插件在后台 tab 读取正文，不打扰用户当前页面
        const result = await this.toolCall(
          'fetch_url',
          { url, connectionId },
          { connectionId }
        )
        page = parseJSON(result.content?.[0]?.text || '')
      } catch (error) {
        console.warn(`[Workflow] fetch_url failed for ${url}:`, error.message)
      }

      if (!page || !page.content) {
        this.emit(state, onProgress, `  页面读取失败：${url}（跳过）`)
        continue
      }

      newSources.push({
        url: page.url || url,
        title: (page.title || url).slice(0, 200),
        truncated: page.truncated === true,
      })

      // grade：LLM 判断该页信息对子问题够不够 + 提炼要点
      let grade = null
      try {
        const response = await this.llm.chat(
          [
            {
              role: 'user',
              content: `研究子问题：${topic.question}\n\n网页正文：\n${String(page.content).slice(0, 12000)}`,
            },
          ],
          [],
          RESEARCH_TOPIC_PROMPT
        )
        grade = parseJSON(response.content)
      } catch (error) {
        console.warn('[Workflow] grade failed:', error.message)
      }

      if (grade) {
        const points = Array.isArray(grade.points)
          ? grade.points.map(String).filter(Boolean).map((p) => p.slice(0, 120))
          : []
        topic.points = topic.points.concat(points)
        topic.sufficient = grade.sufficient === true
        topic.gap = String(grade.gap || '').slice(0, 300)
        if (topic.sufficient) break // 信息够了就不再读该主题剩余页面
      } else if (page.content) {
        // grade 解析失败兜底：正文本身作为一条要点，按"不足"继续
        topic.points.push(String(page.content).slice(0, 120))
        topic.sufficient = false
        topic.gap = '无法评估信息充分性'
      }
    }
    return newSources
  }

  /**
   * 信息不足时补充候选 URL（"重写查询再搜"的轻量版：LLM 基于缺口重新生成 URL）
   */
  async suggestMoreUrls(topic) {
    try {
      const response = await this.llm.chat(
        [
          {
            role: 'user',
            content: `研究子问题：${topic.question}\n\n目前信息不足：${topic.gap}\n\n请给出 1-2 个能补充该主题信息的权威 URL，严格输出 JSON 数组：["https://..."]`,
          },
        ],
        [],
        RESEARCH_TOPIC_PROMPT
      )
      const urls = parseJSON(response.content)
      if (Array.isArray(urls) && urls.length > 0) {
        const fresh = urls.map(String).filter((u) => !topic.urls.includes(u)).slice(0, this.maxPagesPerTopic)
        topic.urls = topic.urls.concat(fresh)
      }
    } catch (error) {
      console.warn('[Workflow] suggestMoreUrls failed:', error.message)
    }
  }

  // ===== 节点：compare（交叉对比） =====
  async compareNode(state, onProgress) {
    if (state.plan.length <= 1) {
      state.step = 'report'
      this.emit(state, onProgress, '仅一个主题，跳过交叉对比，直接生成报告')
      return
    }
    this.emit(state, onProgress, '正在交叉对比各主题信息...')
    // 对比信息写入 State（不把原文塞回对话历史）：report 节点直接用各主题要点
    state.comparePoints = state.plan
      .filter((t) => t.points.length > 0)
      .map((t) => ({ question: t.question, points: t.points }))
    state.step = 'report'
    this.emit(state, onProgress, '交叉对比完成')
  }

  // ===== 节点：report（生成研究报告） =====
  async reportNode(state, { onProgress, onToken }) {
    this.emit(state, onProgress, '正在生成研究报告...')
    const topicsText = state.plan
      .map(
        (t, i) =>
          `### 主题 ${i + 1}：${t.question}\n` +
          `信息充分度：${t.sufficient ? '充分' : '不充分'}\n` +
          `要点：\n${t.points.map((p) => `- ${p}`).join('\n') || '- 无'}\n`
      )
      .join('\n')
    const sourcesText = state.sources
      .map((s) => `- ${s.title}（${s.url}）${s.truncated ? ' [正文已截断]' : ''}`)
      .join('\n')

    const messages = [
      {
        role: 'user',
        content: `原始研究问题：${state.question}\n\n${topicsText}\n\n来源列表：\n${sourcesText || '- 无来源'}`,
      },
    ]

    // 流式生成报告：研究报告可能较长，用打字机效果推送，最终 report 兜底
    const response = await this.llm.chatStream(messages, [], RESEARCH_REPORT_PROMPT, onToken)
    state.report = response.content || '（未能生成报告）'
    state.step = 'done'
    this.emit(state, onProgress, '研究报告生成完毕')
  }

  // ===== 基础设施 =====

  // 每完成一个主题推进游标（研究循环的条件边：全部完成退出）
  advanceTopic(state) {
    state.currentTopic++
  }

  // HITL：暂停工作流等待用户答复；超时默认继续（不阻塞研究）
  // 注意：onAsk 答复后必须 clearTimeout 兜底 timer，否则 timer 会一直挂着拖住进程
  async askUser(onAsk, question, options) {
    if (!onAsk) return { cancel: false, text: '继续研究' }
    let timer
    try {
      const answer = await Promise.race([
        onAsk(question, options),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve({ cancel: false, text: '继续研究', timeout: true }), this.hitlTimeoutMs)
        }),
      ])
      clearTimeout(timer)
      return answer || { cancel: false, text: '继续研究' }
    } catch (error) {
      clearTimeout(timer)
      console.warn('[Workflow] HITL ask failed:', error.message)
      return { cancel: false, text: '继续研究' }
    }
  }

  // 进度推送（workflow_progress）
  emit(state, onProgress, message) {
    if (typeof onProgress === 'function') {
      onProgress({ taskId: state.taskId, message, step: state.step })
    }
  }

  // ===== checkpoint：节点级持久化，崩溃/重启可恢复 =====

  /**
   * 创建新 State 或从 checkpoint 恢复（同一问题重发时续跑）
   */
  async loadOrCreate(question) {
    if (this.checkpointEnabled && fs.existsSync(CHECKPOINT_DIR)) {
      const files = fs.readdirSync(CHECKPOINT_DIR).filter((f) => f.endsWith('.json'))
      for (const file of files) {
        try {
          const saved = JSON.parse(fs.readFileSync(path.join(CHECKPOINT_DIR, file), 'utf8'))
          if (saved.question === question && !['done', 'failed'].includes(saved.step)) {
            console.log(`[Workflow] Resuming checkpoint ${saved.taskId} at step ${saved.step}`)
            return saved
          }
        } catch (error) {
          console.warn('[Workflow] Checkpoint load failed:', error.message)
        }
      }
    }
    return {
      taskId: uuidv4().slice(0, 8),
      question,
      plan: [],
      currentTopic: 0,
      sources: [],
      comparePoints: [],
      report: null,
      step: 'plan', // 状态机当前所在节点
      status: 'running',
      error: null,
    }
  }

  saveCheckpoint(state) {
    if (!this.checkpointEnabled) return
    try {
      fs.mkdirSync(CHECKPOINT_DIR, { recursive: true })
      fs.writeFileSync(
        path.join(CHECKPOINT_DIR, `${state.taskId}.json`),
        JSON.stringify(state, null, 2),
        'utf8'
      )
    } catch (error) {
      console.warn('[Workflow] Checkpoint save failed:', error.message)
    }
  }

  /**
   * 删除已完成/失败的 checkpoint（研究结束后清理）
   */
  clearCheckpoint(taskId) {
    if (!this.checkpointEnabled || !taskId) return
    try {
      const file = path.join(CHECKPOINT_DIR, `${taskId}.json`)
      if (fs.existsSync(file)) fs.unlinkSync(file)
    } catch (error) {
      console.warn('[Workflow] Checkpoint clear failed:', error.message)
    }
  }
}

/**
 * 容错解析 LLM 输出的 JSON：
 * - 可能被 ```json 代码块包裹
 * - 可能混有前后缀文字
 * 提取首个 {...} 或 [...] 并 JSON.parse，失败返回 null
 */
function parseJSON(text) {
  if (typeof text !== 'string') return null
  let t = text.trim()
  // 去掉 ```json ... ``` 代码块
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1].trim()
  // 提取首个对象/数组
  const first = t.search(/[[{]/)
  if (first === -1) return null
  const candidates = [t.slice(first)]
  for (const s of candidates) {
    try {
      return JSON.parse(s)
    } catch {
      // 尝试按括号配对截取
      const open = s[0]
      const close = open === '{' ? '}' : ']'
      let depth = 0
      for (let i = 0; i < s.length; i++) {
        if (s[i] === open) depth++
        else if (s[i] === close) {
          depth--
          if (depth === 0) {
            try {
              return JSON.parse(s.slice(0, i + 1))
            } catch {
              return null
            }
          }
        }
      }
    }
  }
  return null
}

module.exports = { ResearchWorkflow, parseJSON }
