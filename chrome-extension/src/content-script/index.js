/**
 * Content Script - 页面内容脚本
 * 注入到目标页面，用于采集页面性能数据
 * 使用 Chrome 消息 API 与插件通信
 */

(function() {
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
  function handleGetPerformance(request, sender, sendResponse) {
    try {
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
   * 采集浏览器性能数据
   */
  function collectPerformanceData() {
    // 获取页面加载时间
    const navigationTiming = performance.getEntriesByType('navigation')[0]
    const loadTime = navigationTiming ? (navigationTiming.loadEventEnd - navigationTiming.fetchStart) : 0

    // 获取首次内容绘制时间 (FCP) 和最大内容绘制时间 (LCP)
    const paintEntries = performance.getEntriesByType('paint')
    const lcpEntry = performance.getEntriesByType('largest-contentful-paint')

    let fcp = 0
    let lcp = 0

    paintEntries.forEach(entry => {
      if (entry.name === 'first-contentful-paint') {
        fcp = entry.startTime
      }
    })

    if (lcpEntry.length > 0) {
      lcp = lcpEntry[0].startTime
    }

    return {
      url: window.location.href,
      loadTime: Math.round(loadTime),
      fcp: Math.round(fcp),
      lcp: Math.round(lcp),
      timestamp: Date.now()
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
