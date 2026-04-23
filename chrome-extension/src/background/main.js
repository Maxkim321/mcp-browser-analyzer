const c = globalThis.chrome

// 侧边栏配置
if (c && c.sidePanel) {
  try {
    c.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => void 0)
  } catch (e) {
    void e
  }
}

if (c && c.action && c.sidePanel) {
  c.action.onClicked.addListener(async (tab) => {
    try {
      if (tab && tab.windowId != null) {
        await c.sidePanel.open({ windowId: tab.windowId })
      }
    } catch (e) {
      void e
    }
  })
}

// 与content-script通信的方法
const sendToContentScript = (tabId, message) => {
  return new Promise((resolve, reject) => {
    try {
      c.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
        } else {
          resolve(response)
        }
      })
    } catch (error) {
      reject(error)
    }
  })
}

const ensureContentScriptInjected = async (tabId) => {
  if (!c?.scripting?.executeScript) {
    throw new Error('Missing scripting permission')
  }
  await c.scripting.executeScript({
    target: { tabId },
    files: ['dist/src/content-script/index.js']
  })
}

const getActiveTabId = async () => {
  const tabs = await c.tabs.query({ active: true, currentWindow: true })
  if (!tabs.length || !tabs[0].id) {
    throw new Error('No active tab found')
  }
  const tab = tabs[0]
  if (!tab.url || tab.url.startsWith('edge://') || tab.url.startsWith('chrome://')) {
    throw new Error('Unsupported page: cannot inject into browser internal pages')
  }
  return tab.id
}

const getPerformanceWithRetry = async (requestId) => {
  const tabId = await getActiveTabId()
  try {
    return await sendToContentScript(tabId, { type: 'get_performance', requestId })
  } catch (error) {
    const message = String(error?.message || '')
    const shouldRetryByInject = message.includes('Receiving end does not exist')
    if (!shouldRetryByInject) {
      throw error
    }
    await ensureContentScriptInjected(tabId)
    return sendToContentScript(tabId, { type: 'get_performance', requestId })
  }
}

// 监听来自agent-server的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request)
  
  if (request.type === 'get_performance') {
    getPerformanceWithRetry(request.requestId)
      .then(response => {
        console.log('Background received performance data:', response)
        sendResponse(response)
      })
      .catch(error => {
        console.error('Error getting performance data:', error)
        sendResponse({
          success: false,
          error: error.message
        })
      })

    return true // 保持消息通道开放，用于异步响应
  }
  
  return false
})

console.log('Background script loaded')
