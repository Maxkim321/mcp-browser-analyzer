/**
 * Content Script - 页面内容脚本
 * 注入到目标页面，用于采集页面性能数据与正文内容
 * 使用 Chrome 消息 API 与插件通信
 */

import { Readability } from '@mozilla/readability'
import { createRefStore } from './ref-store.js'
import { playActionOverlay, settleActionOverlay } from './action-overlay.js'

(function() {
  let latestLcp = 0

  // P12a：写操作 ref 存储——元素身份发放与执行前校验（页面导航随脚本重置）
  const refStore = createRefStore()

  // 使用 buffered observer 读取已经发生过的 LCP，避免在 document_idle 注入时错过关键事件
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      if (PerformanceObserver.supportedEntryTypes?.includes('largest-contentful-paint')) {
        const lcpObserver = new PerformanceObserver((entryList) => {
          const entries = entryList.getEntries()
          if (entries.length > 0) {
            latestLcp = entries[entries.length - 1].startTime
          }
        })
        lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true })

        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') {
            try {
              lcpObserver.disconnect()
            } catch (error) {
              void error
            }
          }
        }, { once: true })
      }
    } catch (error) {
      console.warn('LCP observer init failed:', error)
    }
  }

  // 监听来自插件的消息
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    console.log('Content script received message:', request)

    switch(request.type) {
      case 'get_performance':
        handleGetPerformance(request, sender, sendResponse)
        return true // 保持消息通道开放，用于异步响应

      case 'get_page_content':
        handleGetPageContent(request, sender, sendResponse)
        return true

      case 'get_search_results':
        handleGetSearchResults(request, sender, sendResponse)
        return true

      case 'get_selection':
        // F1 轻量 pageContext：同步返回当前选中文本（无选中返回空串）
        // 纯同步操作，无需保持消息通道
        try {
          sendResponse({ success: true, selection: getSelectionText() })
        } catch (error) {
          sendResponse({ success: false, error: error.message })
        }
        return false

      case 'get_interactive_elements':
        // P4 写操作前置定位：枚举可交互元素及 CSS 选择器（只读）
        handleGetInteractiveElements(request, sender, sendResponse)
        return true

      case 'write_action':
        // P4 写操作执行：服务端审批通过后，在页面 DOM 上执行 click/fill/select/fill_form
        handleWriteAction(request, sender, sendResponse)
        return true

      case 'wait_for':
        // P12b 等待页面文本出现（异步结果等待，只读）
        handleWaitFor(request, sender, sendResponse)
        return true

      default:
        // 与本脚本无关的消息（如 background 广播给 sidepanel 的划词消息）不响应
        return false
    }
  })

  /**
   * 处理性能数据采集请求
   */
  async function handleGetPerformance(request, sender, sendResponse) {
    try {
      await waitForPageReady(5000)
      const data = collectPerformanceData()

      console.log('Performance data collected:', data)

      sendResponse({
        success: true,
        type: 'performance_data',
        requestId: request.requestId,
        payload: data
      })
    } catch (error) {
      console.error('Failed to collect performance data:', error)

      sendResponse({
        success: false,
        type: 'performance_data',
        requestId: request.requestId,
        error: error.message
      })
    }
  }

  /**
   * 处理页面正文提取请求
   * 使用 Readability 提取正文（去导航/广告），超长按 maxChars 截断
   */
  async function handleGetPageContent(request, sender, sendResponse) {
    try {
      const { content, title, charCount } = extractPageContent(request.maxChars || 12000)
      // F7 结构化提取：表格/列表 DOM 数据随正文一起返回（供 extract 动作格式化）
      const structured = extractStructuredContent()
      console.log('Page content extracted, chars:', charCount, 'structured:', structured?.type || 'none')
      sendResponse({
        success: true,
        type: 'page_content',
        requestId: request.requestId,
        payload: {
          url: window.location.href,
          title,
          content,
          charCount,
          structured,
        },
      })
    } catch (error) {
      console.error('Failed to extract page content:', error)
      sendResponse({
        success: false,
        type: 'page_content',
        requestId: request.requestId,
        error: error.message,
      })
    }
  }

  /**
   * 提取页面正文
   * 优先 Readability（<article> 识别），失败降级 body.innerText
   * 在克隆文档上操作，避免干扰原页面
   * @param {number} maxChars - 最大字符数，超出截断
   */
  function extractPageContent(maxChars) {
    let content = ''
    let title = document.title || ''

    try {
      const docClone = document.cloneNode(true)
      const article = new Readability(docClone).parse()
      if (article && article.textContent) {
        title = article.title || title
        content = article.textContent.trim()
      }
    } catch (error) {
      console.warn('Readability parse failed, fallback to innerText:', error)
    }

    if (!content && document.body) {
      content = document.body.innerText.trim()
    }

    const charCount = content.length
    if (content.length > maxChars) {
      content = content.slice(0, maxChars)
    }
    return { content, title, charCount }
  }

  /**
   * 处理搜索结果提取请求（M1-F8 深度研究）
   * 从搜索引擎结果页 DOM 提取真实结果链接，供后续 fetch_url 抓正文
   */
  async function handleGetSearchResults(request, sender, sendResponse) {
    try {
      const results = extractSearchResults(request.maxResults || 5)
      console.log('Search results extracted:', results.length)
      sendResponse({
        success: true,
        type: 'search_results',
        requestId: request.requestId,
        payload: {
          url: window.location.href,
          results,
        },
      })
    } catch (error) {
      console.error('Failed to extract search results:', error)
      sendResponse({
        success: false,
        type: 'search_results',
        requestId: request.requestId,
        error: error.message,
      })
    }
  }

  /**
   * 从搜索结果页提取 {title, url} 列表
   * 各引擎结构差异大：优先用引擎专属选择器，取不到再降级为「页面内所有外链」兜底
   * @param {number} maxResults - 最多返回条数
   */
  function extractSearchResults(maxResults) {
    const host = window.location.hostname
    // 结果标题链接的选择器（按引擎），顺序即优先级
    const selectorMap = [
      { match: 'bing.com', selectors: ['#b_results li.b_algo h2 a', '#b_results li.b_algo a.tilk'] },
      { match: 'sogou.com', selectors: ['.results .vrwrap h3 a', '.results h3 a'] },
      { match: 'baidu.com', selectors: ['#content_left .result h3 a'] },
    ]

    const matched = selectorMap.find((item) => host.includes(item.match))
    const selectors = matched ? matched.selectors : ['h2 a[href^="http"]', 'h3 a[href^="http"]']

    const results = []
    const seen = new Set()

    const push = (title, rawHref, anchor) => {
      const url = normalizeResultUrl(rawHref, anchor)
      if (!url || !title) return
      if (seen.has(url)) return
      seen.add(url)
      results.push({ title: title.slice(0, 200), url })
    }

    for (const selector of selectors) {
      for (const anchor of document.querySelectorAll(selector)) {
        if (results.length >= maxResults) return results
        push(anchor.innerText.trim(), anchor.getAttribute('href'), anchor)
      }
      if (results.length > 0) break
    }

    return results.slice(0, maxResults)
  }

  /**
   * 把结果页链接还原成可直接抓取的真实 URL
   * 搜索引擎常用跳转链接（Bing 的 /ck/a?u=a1<base64>、搜狗的 /link?url=...），
   * 直接抓跳转链接会拿到空白中转页，必须先还原
   */
  function normalizeResultUrl(rawHref, anchor) {
    if (!rawHref) return ''

    let absolute = ''
    try {
      absolute = new URL(rawHref, window.location.href).href
    } catch (error) {
      void error
      return ''
    }
    if (!/^https?:/.test(absolute)) return ''

    let parsed
    try {
      parsed = new URL(absolute)
    } catch (error) {
      void error
      return ''
    }

    // Bing 跳转链接：u 参数为 "a1" + base64url(真实地址)
    if (parsed.hostname.includes('bing.com') && parsed.pathname.startsWith('/ck/')) {
      const decoded = decodeBingRedirect(parsed.searchParams.get('u'))
      if (decoded) return decoded
    }

    // 搜狗跳转链接：无法在此还原真实地址，回退到结果条上的 data-url / 展示域名
    if (parsed.hostname.includes('sogou.com') && parsed.pathname.startsWith('/link')) {
      const fallback = findResultFallbackUrl(anchor)
      return fallback || ''
    }

    // 过滤搜索引擎自身的站内链接（登录/设置/相关搜索等）
    if (parsed.hostname === window.location.hostname) return ''

    return absolute
  }

  function decodeBingRedirect(uParam) {
    if (!uParam || !uParam.startsWith('a1')) return ''
    try {
      const base64 = uParam.slice(2).replace(/-/g, '+').replace(/_/g, '/')
      const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
      const decoded = atob(padded)
      return /^https?:\/\//.test(decoded) ? decoded : ''
    } catch (error) {
      void error
      return ''
    }
  }

  /**
   * 从结果条目上找可用的真实地址：优先 data-url 属性，其次展示出来的域名文本
   */
  function findResultFallbackUrl(anchor) {
    if (!anchor) return ''
    let node = anchor
    for (let depth = 0; node && depth < 5; depth += 1) {
      const dataUrl = node.getAttribute?.('data-url')
      if (dataUrl && /^https?:\/\//.test(dataUrl)) return dataUrl
      node = node.parentElement
    }

    const container = anchor.closest('.vrwrap') || anchor.parentElement
    const citeText = container?.querySelector('cite, .citeurl, .fz-mid')?.innerText?.trim()
    if (citeText) {
      const domain = citeText.split(/[\s>]/)[0]
      if (/^[\w.-]+\.[a-z]{2,}/i.test(domain)) {
        return domain.startsWith('http') ? domain : `https://${domain}`
      }
    }
    return ''
  }

  /**
   * 提取页面结构化数据（F7 结构化提取）
   * 数据对比场景页面上往往有不止一张表（每张一个对比维度），因此提取所有可见表格；
   * 无表格时再退回第一个可见列表。确定性 DOM 提取（JS 做），格式化交给 LLM（EXTRACT_PROMPT）
   * @returns {null|{type:'tables',tables:|{type:'list',items:}} 无结构化内容返回 null
   */
  function extractStructuredContent() {
    const MAX_ROWS = 50
    const MAX_ITEMS = 50

    // 全部可见表格：每张表给出 index / headers / rows / truncated
    const tables = Array.from(document.querySelectorAll('table'))
      .map((table, i) => {
        if (!isVisible(table)) return null
        const rows = Array.from(table.querySelectorAll('tr'))
        if (rows.length === 0) return null
        const grid = rows
          .map((row) => Array.from(row.querySelectorAll('th,td')).map((cell) => cell.innerText.trim()))
          .filter((cells) => cells.length > 0)
        if (grid.length === 0) return null
        return {
          index: i,
          headers: grid[0],
          rows: grid.slice(1, MAX_ROWS),
          truncated: grid.length > MAX_ROWS,
        }
      })
      .filter(Boolean)
    if (tables.length > 0) return { type: 'tables', tables, tablesCount: tables.length }

    // 其次列表：取第一个可见 ul/ol 的直接 li 项
    const lists = Array.from(document.querySelectorAll('ul,ol'))
    for (const list of lists) {
      if (!isVisible(list)) continue
      const items = Array.from(list.children)
        .filter((el) => el.tagName === 'LI')
        .map((li) => li.innerText.trim())
        .filter(Boolean)
      if (items.length === 0) continue
      return { type: 'list', items: items.slice(0, MAX_ITEMS), truncated: items.length > MAX_ITEMS }
    }

    return null
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return false
    const style = getComputedStyle(el)
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.05
  }

  /**
   * ===== P4/P12a 写操作：DOM 原语 =====
   * 职责边界：这里只做确定性 DOM 操作（枚举/点击/填写/选择），
   * "该不该做"由服务端分级权限审批把关；LLM 只产出目标 ref 和值。
   * P12a 寻址升级：ref 绑定元素身份（WeakRef+指纹），执行前校验——
   * 选择器"重新解释"导致的静默点错被结构性移除。
   */

  /**
   * 可交互判定级联（browser-use 实战清单的 content-script 子集）：
   * 标签 allowlist → 可聚焦（tabIndex≥0）→ ARIA 角色 → onclick 类属性 → cursor:pointer。
   * JS 框架监听器探测（getEventListeners）需要 CDP，留给 P12c 增强通道。
   */
  const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'checkbox', 'radio', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
    'tab', 'option', 'switch', 'slider', 'textbox', 'combobox', 'searchbox', 'treeitem',
  ])

  function isInteractiveCandidate(el) {
    const tag = el.tagName.toLowerCase()
    if (['a', 'button', 'input', 'select', 'textarea', 'summary'].includes(tag)) {
      return tag !== 'a' || el.hasAttribute('href')
    }
    if (el.tabIndex >= 0) return true
    const role = el.getAttribute('role')
    if (role && INTERACTIVE_ROLES.has(role)) return true
    if (el.hasAttribute('onclick') || el.hasAttribute('ng-click') || el.hasAttribute('@click') || el.hasAttribute('v-on:click')) return true
    return getComputedStyle(el).cursor === 'pointer'
  }

  /**
   * 枚举页面可交互元素（写操作前的定位步骤，只读）
   * P12a：递归穿透 open shadow DOM；每个元素发稳定 ref（同元素跨枚举复用）；
   * 输出伪 HTML 快照行（Skyvern 实证：HTML 表示比 JSON 成功率高、token 省）
   */
  function handleGetInteractiveElements(request, sender, sendResponse) {
    try {
      const elements = collectInteractiveElements(request.maxElements || 30)
      sendResponse({
        success: true,
        type: 'interactive_elements',
        requestId: request.requestId,
        payload: { url: window.location.href, count: elements.length, snapshot: renderSnapshot(elements), elements },
      })
    } catch (error) {
      sendResponse({
        success: false,
        type: 'interactive_elements',
        requestId: request.requestId,
        error: error.message,
      })
    }
  }

  function collectInteractiveElements(maxElements) {
    const out = []
    const visit = (root, inShadow) => {
      for (const el of root.querySelectorAll('*')) {
        if (out.length >= maxElements) return
        // open shadow root 递归：querySelectorAll 天然不进 shadow，这是旧版"看不见组件"的根因
        if (el.shadowRoot) visit(el.shadowRoot, true)
        if (!isInteractiveCandidate(el) || !isVisible(el)) continue
        out.push(buildElementEntry(el, inShadow))
      }
    }
    visit(document, false)
    return out
  }

  /** 元素的可指纹描述（ref-store 指纹的原料，执行时现场重算比对） */
  /** 控件关联的 label 文本（for= 关联或包裹式），作为输入框语义兜底 */
  function labelTextFor(el) {
    try {
      if (el.id) {
        const linked = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
        if (linked) return String(linked.innerText || '').trim()
      }
      const wrapped = el.closest('label')
      if (wrapped) return String(wrapped.innerText || '').trim()
    } catch {
      /* CSS.escape 不可用等场景静默降级 */
    }
    return ''
  }

  function buildDescriptor(el) {
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      name: el.getAttribute('name') || '',
      type: el.getAttribute('type') || '',
      text: String(
        el.innerText ||
          el.getAttribute('aria-label') ||
          labelTextFor(el) || // label 文本是字段名（姓名），优先于 placeholder 提示语（你的称呼）
          el.getAttribute('placeholder') ||
          ''
      ).trim(),
    }
  }

  /** 人类可读描述（审批卡/动画 pill/工具结果共用） */
  function buildLabel(el, descriptor, inShadow) {
    const text = descriptor.text.slice(0, 20)
    const type = descriptor.type ? `[${descriptor.type}]` : ''
    const inner = text || descriptor.id || descriptor.name || descriptor.tag
    return `${descriptor.tag}${type}「${inner}」${inShadow ? '（shadow DOM 内）' : ''}`
  }

  function buildElementEntry(el, inShadow) {
    const descriptor = buildDescriptor(el)
    const ref = refStore.register(el, descriptor)
    const entry = { ref, tag: descriptor.tag, text: descriptor.text.slice(0, 60), label: buildLabel(el, descriptor, inShadow) }
    if (descriptor.type) entry.type = descriptor.type
    // 语义锚点：光给 ref LLM 无法把"姓名"映射到具体输入框——id/name/placeholder 进快照行
    if (descriptor.id) entry.id = descriptor.id
    if (descriptor.name) entry.name = descriptor.name
    const placeholder = el.getAttribute('placeholder')
    if (placeholder) entry.placeholder = placeholder.slice(0, 30)
    if (['input', 'textarea', 'select'].includes(descriptor.tag)) {
      entry.value = String(el.value ?? '').slice(0, 60)
      // checkbox/radio 必须带状态进快照：模型看不到勾选状态就只能猜——
      // eval 实测它会猜"未勾选"并停下来向用户确认（eval 抓到的真协议缺口）
      if (descriptor.tag === 'input' && (descriptor.type === 'checkbox' || descriptor.type === 'radio')) {
        entry.checked = el.checked
      }
    }
    return entry
  }

  /** 伪 HTML 快照行（LLM 读这个做决策；结构化 elements 仅进 payload 供评测/审计） */
  function renderSnapshot(elements) {
    return elements
      .map((e) => {
        const attrs = [
          e.type ? ` type="${e.type}"` : '',
          e.id ? ` id="${e.id}"` : '',
          e.name ? ` name="${e.name}"` : '',
          e.placeholder ? ` placeholder="${e.placeholder}"` : '',
          e.value !== undefined ? ` value="${String(e.value).replace(/"/g, "'")}"` : '',
          e.checked !== undefined ? ` ${e.checked ? 'checked' : 'unchecked'}` : '',
        ].join('')
        return `- <${e.tag} ref=${e.ref}${attrs}>${e.text || ''}</${e.tag}>`
      })
      .join('\n')
  }

  /**
   * 执行写动作：click / fill / select（P12a 全异步化）
   * 链路：ref 身份校验 → actionability 矩阵 → 动画"先看见" → 执行 → 动作后校验
   * 任何失败都以 error 文本回传，保持"可自纠"契约让 LLM 能重试
   */
  async function handleWriteAction(request, sender, sendResponse) {
    try {
      const result = await executeWriteAction(request)
      sendResponse({
        success: true,
        type: 'write_action_result',
        requestId: request.requestId,
        payload: result,
      })
    } catch (error) {
      settleActionOverlay()
      sendResponse({
        success: false,
        type: 'write_action_result',
        requestId: request.requestId,
        error: error.message,
      })
    }
  }

  // rAF 在非活动/被遮挡 tab 里不触发——与 80ms setTimeout 竞速：
  // 前台 tab rAF 先到（精确两帧校验），后台 tab 退化为近似校验，动作永不挂起
  const nextFrame = () =>
    new Promise((r) => {
      requestAnimationFrame(() => r())
      setTimeout(r, 80)
    })

  /**
   * actionability 矩阵：可见 / 稳定（两帧 bbox 不变）/ enabled；遮挡命中判定仅对
   * click（指针动作的语义）——fill/select 对齐 Playwright 口径：只要可见+enabled，
   * 程序化赋值不受视觉遮挡影响（bing 首页搜索框被装饰层盖住但照常可填，e2e 实测）
   */
  async function assertActionable(el, action = 'click') {
    el.scrollIntoView({ block: 'center' })
    await nextFrame()
    if (!isVisible(el)) throw new Error('元素不可见（display:none/visibility:hidden 或零尺寸）')
    if (el.disabled) throw new Error(`元素处于 disabled 状态，当前不可交互（<${el.tagName.toLowerCase()}>）`)
    const r1 = el.getBoundingClientRect()
    await nextFrame()
    await nextFrame()
    const r2 = el.getBoundingClientRect()
    if (Math.abs(r1.left - r2.left) > 1 || Math.abs(r1.top - r2.top) > 1 || Math.abs(r1.width - r2.width) > 1 || Math.abs(r1.height - r2.height) > 1) {
      throw new Error('元素位置尚未稳定（可能正在动画或过渡），请稍后重试')
    }
    if (action !== 'click') return
    const hit = document.elementFromPoint(r2.left + r2.width / 2, r2.top + r2.height / 2)
    if (!composedAncestryContains(el, hit)) {
      throw new Error('元素被其他内容遮挡（该位置点击不会命中目标，可能被弹层/遮罩覆盖）')
    }
  }

  /**
   * 遮挡判定（composed 祖先链）：elementFromPoint 对 shadow 内容会 retarget 到
   * shadow host（实测 Chrome 154：shadow 内按钮的命中结果是 host 元素）——
   * 所以"命中 = hit 在 el 的 composed 祖先链上"：el 自身/后代直接判，
   * 跨 shadow 边界沿 getRootNode().host 向上收集宿主链逐段判。
   */
  function composedAncestryContains(el, hit) {
    if (!hit) return false
    let node = el
    while (node) {
      if (node === hit || node.contains(hit)) return true
      const root = node.getRootNode()
      if (root === document) return false
      node = root.host
    }
    return false
  }

  /** 动作后校验：400ms 窗口内 body 有无 mutation / URL 有无变化（喂 LLM 自诊"点了没反应"） */
  function observePageChange(windowMs = 400) {
    return new Promise((resolve) => {
      const urlBefore = window.location.href
      let changed = false
      const observer = new MutationObserver(() => {
        changed = true
      })
      observer.observe(document.body, { childList: true, subtree: true, attributes: true })
      setTimeout(() => {
        observer.disconnect()
        resolve(changed || window.location.href !== urlBefore)
      }, windowMs)
    })
  }

  async function executeWriteAction({ action, ref, value, fields }) {
    if (!ref && action !== 'fill_form') {
      throw new Error('缺少 ref 参数——写操作只能引用 get_interactive_elements 快照里返回的 ref，禁止凭空构造')
    }
    let label = ''
    let el = null
    if (action === 'fill_form') {
      // P12b 批量填表：两阶段执行——先全量预检（任何 ref/类型问题都不落一笔），
      // 再逐字段执行（动画逐字段移动，"手"的连续感）；部分失败只在执行期出现并如实回报
      if (!Array.isArray(fields) || fields.length === 0) throw new Error('fill_form 需要非空的 fields 数组')
      if (fields.length > 20) throw new Error('fill_form 单次最多 20 个字段，更多请分批调用')
      const prepared = fields.map((field) => {
        if (!field?.ref) throw new Error('fill_form 的每个字段都必须带 ref')
        const resolved = refStore.resolve(field.ref, (e) => buildDescriptor(e))
        if (!resolved.ok) throw new Error(`字段 ${field.ref}: ${resolved.reason}`)
        const fEl = resolved.el
        const fLabel = buildLabel(fEl, buildDescriptor(fEl), fEl.getRootNode() !== document)
        const fType =
          field.type ||
          (fEl instanceof HTMLSelectElement
            ? 'select'
            : fEl instanceof HTMLInputElement && fEl.type === 'checkbox'
              ? 'checkbox'
              : 'textbox')
        const before =
          fType === 'checkbox' ? fEl.checked : String(fEl.value ?? '').slice(0, 40)
        return { field, el: fEl, label: fLabel, type: fType, before }
      })
      for (const p of prepared) {
        if (p.type === 'select' && !(p.el instanceof HTMLSelectElement)) {
          throw new Error(`字段 ${p.field.ref} 不是下拉框: ${p.label}（<${p.el.tagName.toLowerCase()}>）`)
        }
        if (p.type === 'textbox' && !(p.el instanceof HTMLInputElement) && !(p.el instanceof HTMLTextAreaElement)) {
          throw new Error(`字段 ${p.field.ref} 不是输入框: ${p.label}（<${p.el.tagName.toLowerCase()}>）`)
        }
      }
      const results = []
      for (const p of prepared) {
        await assertActionable(p.el, 'fill')
        await playActionOverlay(p.el, p.type === 'select' ? 'select' : 'fill', p.label)
        if (p.type === 'checkbox') {
          const want = String(p.field.value).toLowerCase() === 'true'
          if (p.el.checked !== want) p.el.click()
          results.push({ ref: p.field.ref, label: p.label, before: p.before, after: p.el.checked })
        } else if (p.type === 'select') {
          const option = findSelectOption(p.el, String(p.field.value ?? ''))
          if (!option) throw new Error(`下拉框中没有匹配选项: ${p.field.value}（${p.label}）`)
          setNativeValue(p.el, option.value)
          results.push({ ref: p.field.ref, label: p.label, before: p.before, after: option.text.slice(0, 40) })
        } else {
          setNativeValue(p.el, String(p.field.value ?? ''))
          results.push({ ref: p.field.ref, label: p.label, before: p.before, after: String(p.el.value).slice(0, 40) })
        }
      }
      const pageChanged = await observePageChange()
      settleActionOverlay()
      return {
        ok: true,
        info: `批量填写 ${results.length} 个字段：${results
          .map((r) => `${r.label} ${r.before}→${r.after}`)
          .join('、')}${pageChanged ? '（页面有响应）' : '（页面无变化，若与预期不符请重新枚举确认）'}`,
        fields: results,
        pageChanged,
      }
    }
    if (!ref) {
      throw new Error('缺少 ref 参数——写操作只能引用 get_interactive_elements 快照里返回的 ref，禁止凭空构造')
    }
    const resolved = refStore.resolve(ref, (e) => buildDescriptor(e))
    if (!resolved.ok) throw new Error(resolved.reason)
    el = resolved.el
    label = buildLabel(el, buildDescriptor(el), el.getRootNode() !== document)

    await assertActionable(el, action)
    // 先看见，再发生：动画播完才动 DOM
    await playActionOverlay(el, action, label)

    let result
    switch (action) {
      case 'click': {
        el.focus?.()
        el.click()
        result = { ok: true, info: `已点击 ${label}` }
        break
      }
      case 'fill': {
        if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
          throw new Error(`目标不是输入框: ${label}（<${el.tagName.toLowerCase()}>）`)
        }
        setNativeValue(el, String(value ?? ''))
        result = { ok: true, info: `已填写 ${label}`, value: String(el.value).slice(0, 120) }
        break
      }
      case 'select': {
        if (!(el instanceof HTMLSelectElement)) {
          throw new Error(`目标不是下拉框: ${label}（<${el.tagName.toLowerCase()}>）`)
        }
        const option = findSelectOption(el, String(value ?? ''))
        if (!option) throw new Error(`下拉框中没有匹配选项: ${value}`)
        setNativeValue(el, option.value)
        result = { ok: true, info: `已选择 ${label}`, value: option.text.slice(0, 120) }
        break
      }
      default:
        throw new Error(`未知写动作: ${action}`)
    }

    // 动作后校验：页面有响应/无变化是信息字段，供 LLM 自诊"点了没反应"
    result.pageChanged = await observePageChange()
    result.info += result.pageChanged ? '（页面有响应）' : '（页面无变化，若与预期不符请重新枚举确认）'
    settleActionOverlay()
    return result
  }

  /**
   * 绕过框架代理的 value setter：用原型原生 setter 赋值再派发 input/change，
   * 否则 Vue/React 的受控组件感知不到变化（表单看似填了，状态其实没变）。
   * 三类元素必须各用各的原型——真实环境实测：select 落到 HTMLInputElement 的
   * setter 会抛 Illegal invocation（跨原型调用内部槽位不合法），真机 E2E 才暴露
   */
  function setNativeValue(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
    descriptor.set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  function findSelectOption(selectEl, value) {
    for (const option of selectEl.options) {
      if (option.value === value || option.text.trim() === value) return option
    }
    return null
  }

  /**
   * P12b 等待页面文本出现（任一命中即返回）：点击/提交后的异步结果等待，
   * 避免模型盲目重复操作。轮询 body.innerText（250ms 间隔），超时如实报未出现
   */
  async function handleWaitFor(request, sender, sendResponse) {
    try {
      const result = await waitForTexts(request.texts || [], request.timeoutMs)
      sendResponse({
        success: true,
        type: 'wait_for_result',
        requestId: request.requestId,
        payload: result,
      })
    } catch (error) {
      sendResponse({
        success: false,
        type: 'wait_for_result',
        requestId: request.requestId,
        error: error.message,
      })
    }
  }

  function waitForTexts(texts, timeoutMs) {
    const wanted = texts.map((t) => String(t)).filter(Boolean)
    if (!wanted.length) return Promise.resolve({ found: false, info: '没有候选文本' })
    const budget = Math.min(Math.max(Number(timeoutMs) || 8000, 1000), 20000)
    const deadline = Date.now() + budget
    return new Promise((resolve) => {
      const check = () => {
        const bodyText = document.body ? document.body.innerText : ''
        const matched = wanted.find((t) => bodyText.includes(t))
        if (matched) return resolve({ found: true, matched, waitedMs: budget - (deadline - Date.now()) })
        if (Date.now() >= deadline) {
          return resolve({ found: false, waitedMs: budget, info: '候选文本均未出现' })
        }
        setTimeout(check, 250)
      }
      check()
    })
  }

  function waitForPageReady(timeoutMs = 5000) {
    if (document.readyState === 'complete') {
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        window.removeEventListener('load', onLoad)
        clearTimeout(timer)
        resolve()
      }
      const onLoad = () => finish()
      window.addEventListener('load', onLoad, { once: true })
      const timer = setTimeout(finish, timeoutMs)
    })
  }

  /**
   * 采集浏览器性能数据
   */
  function collectPerformanceData() {
    const navigationTiming = performance.getEntriesByType('navigation')[0]
    const loadEventEnd = navigationTiming?.loadEventEnd || 0
    const loadTime = navigationTiming ? (loadEventEnd - navigationTiming.startTime) : 0

    const fcpEntries = performance.getEntriesByName('first-contentful-paint')
    const fcpRaw = fcpEntries.length > 0 ? fcpEntries[0].startTime : 0

    let lcp = latestLcp
    if (!lcp) {
      const lcpEntries = performance.getEntriesByType('largest-contentful-paint')
      if (lcpEntries.length > 0) {
        lcp = lcpEntries[lcpEntries.length - 1].startTime
      }
    }

    const pageAgeMs = Math.max(0, Date.now() - performance.timeOrigin)
    const sampledAfterLoadMs = loadEventEnd > 0 ? Math.max(0, pageAgeMs - loadEventEnd) : null
    const likelyLateSample = sampledAfterLoadMs !== null && sampledAfterLoadMs > 15000
    const metricConflict = loadTime > 0 && fcpRaw > loadTime + 5000
    const fcp = metricConflict ? 0 : fcpRaw

    return {
      url: window.location.href,
      loadTime: Math.round(loadTime),
      fcp: Math.round(fcp),
      fcpRaw: Math.round(fcpRaw),
      lcp: Math.round(lcp),
      timestamp: Date.now(),
      readyState: document.readyState,
      navigationType: navigationTiming?.type || 'unknown',
      sampledAfterLoadMs: sampledAfterLoadMs === null ? null : Math.round(sampledAfterLoadMs),
      dataQuality: {
        likelyLateSample,
        metricConflict,
        note: likelyLateSample || metricConflict
          ? '采样时机可能偏晚或指标存在冲突，建议强制刷新后立即重测'
          : '采样时机正常'
      }
    }
  }

  // 监听页面可见性变化，可能需要重新采集
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') {
      console.log('Page became visible, performance data may be ready')
    }
  })

  /**
   * ===== 划词即问：选中文字后弹出浮动工具条 =====
   * 工具条用 Shadow DOM 隔离样式，避免被页面 CSS 污染
   * 点击动作按钮后经 background 打开侧边栏并转发给 sidepanel
   */
  let selectionBarHost = null

  const SELECTION_ACTIONS = [
    { action: 'translate', label: '翻译' },
    { action: 'summarize_selection', label: '总结' },
    { action: 'explain', label: '解释' },
    { action: 'rewrite', label: '改写' },
    { action: 'ask', label: '问问' },
    { action: 'note', label: '记笔记' },
  ]

  function getSelectionText(maxChars = 2000) {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return ''
    const text = sel.toString().trim()
    return text.length > maxChars ? text.slice(0, maxChars) : text
  }

  function hideSelectionBar() {
    if (selectionBarHost) {
      selectionBarHost.remove()
      selectionBarHost = null
    }
  }

  function showSelectionBar() {
    const text = getSelectionText()
    if (!text) return

    const sel = window.getSelection()
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    if (!rect || (rect.width === 0 && rect.height === 0)) return

    hideSelectionBar()

    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;z-index:2147483647;'
    const shadow = host.attachShadow({ mode: 'closed' })

    const style = document.createElement('style')
    style.textContent = `
      .selection-bar {
        display: flex;
        flex-wrap: wrap;
        max-width: 240px;
        gap: 3px;
        padding: 6px;
        background: #1f2937;
        border-radius: 8px;
        box-shadow: 0 4px 14px rgba(0,0,0,0.25);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif;
      }
      .selection-btn {
        border: none;
        background: transparent;
        color: #e5e7eb;
        font-size: 11px;
        padding: 4px 9px;
        border-radius: 6px;
        cursor: pointer;
        white-space: nowrap;
      }
      .selection-btn:hover {
        background: #374151;
        color: #ffffff;
      }
    `
    shadow.appendChild(style)

    const bar = document.createElement('div')
    bar.className = 'selection-bar'

    for (const { action, label } of SELECTION_ACTIONS) {
      const btn = document.createElement('button')
      btn.className = 'selection-btn'
      btn.textContent = label
      // 阻止按钮抢焦点/清空页面选区，否则 click 时选区已丢失
      btn.addEventListener('mousedown', (event) => event.preventDefault())
      btn.addEventListener('click', () => {
        // 用工具条弹出时缓存的文本，不再依赖点击时刻的实时选区
        const selectedText = text
        hideSelectionBar()
        if (!selectedText) return
        // isolated world 下 chrome.* 完整可用，直接发给 background（无需 postMessage 桥）
        try {
          console.log('[BA] dispatch text_action:', action)
          chrome.runtime.sendMessage({ type: 'text_action', action, text: selectedText }, () => void chrome.runtime.lastError)
        } catch (error) {
          console.warn('Dispatch text_action failed:', error)
        }
      })
      bar.appendChild(btn)
    }
    shadow.appendChild(bar)

    // 定位：优先放选区上方，上方空间不足则放下方
    const WIDTH_RESERVE = 260
    const HEIGHT_RESERVE = 54
    const x = Math.max(4, Math.min(rect.left, window.innerWidth - WIDTH_RESERVE))
    const y = rect.top - HEIGHT_RESERVE >= 0 ? rect.top - HEIGHT_RESERVE : rect.bottom + 8
    host.style.left = `${x}px`
    host.style.top = `${y}px`

    document.documentElement.appendChild(host)
    selectionBarHost = host
  }

  function isInsideSelectionBar(event) {
    // 工具条在 shadow DOM 内，host.contains() 不包含 shadow 树内部节点，
    // 必须用 composedPath() 才能命中（点击 shadow 内按钮时路径包含 shadow host）
    return !!(selectionBarHost && event?.composedPath && event.composedPath().includes(selectionBarHost))
  }

  document.addEventListener('mouseup', (event) => {
    if (isInsideSelectionBar(event)) return
    // 延迟一拍，等浏览器更新 selection 状态后再读取
    setTimeout(() => {
      const text = getSelectionText()
      if (text) {
        showSelectionBar()
      } else {
        hideSelectionBar()
      }
    }, 0)
  })

  document.addEventListener('mousedown', (event) => {
    if (isInsideSelectionBar(event)) return
    hideSelectionBar()
  })

  window.addEventListener('scroll', hideSelectionBar, true)

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideSelectionBar()
    }
  })

  console.log('Performance monitor content script loaded')
})()
