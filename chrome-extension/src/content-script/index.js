/**
 * Content Script - 页面内容脚本
 * 注入到目标页面，用于采集页面性能数据
 * 使用 Chrome 消息 API 与插件通信
 */

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

      default:
        console.warn('Unknown message type:', request.type)
        sendResponse({
          success: false,
          error: 'Unknown message type'
        })
        return true
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

  console.log('Performance monitor content script loaded')
})()
