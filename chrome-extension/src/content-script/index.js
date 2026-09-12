/**
 * Content Script - 页面内容脚本
 * 注入到目标页面，用于采集页面性能数据与正文内容
 * 使用 Chrome 消息 API 与插件通信
 */

import { Readability } from '@mozilla/readability'

(function() {
  let latestLcp = 0

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
    return rect.width > 0 && rect.height > 0
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
