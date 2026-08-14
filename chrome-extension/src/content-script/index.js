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
      console.log('Page content extracted, chars:', charCount)
      sendResponse({
        success: true,
        type: 'page_content',
        requestId: request.requestId,
        payload: {
          url: window.location.href,
          title,
          content,
          charCount,
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
        gap: 4px;
        padding: 6px 8px;
        background: #1f2937;
        border-radius: 8px;
        box-shadow: 0 4px 14px rgba(0,0,0,0.25);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif;
      }
      .selection-btn {
        border: none;
        background: transparent;
        color: #e5e7eb;
        font-size: 12px;
        padding: 4px 10px;
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
      btn.addEventListener('click', () => {
        const selectedText = getSelectionText()
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
    const x = Math.max(4, Math.min(rect.left, window.innerWidth - 180))
    const y = rect.top - 44 >= 0 ? rect.top - 44 : rect.bottom + 8
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
