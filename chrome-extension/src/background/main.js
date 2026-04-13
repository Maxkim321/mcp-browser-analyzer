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

// 监听来自agent-server的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request)
  
  if (request.type === 'get_performance') {
    // 找到当前激活的标签页
    c.tabs.query({ active: true, currentWindow: true }).then(tabs => {
      if (tabs.length > 0) {
        const tabId = tabs[0].id
        
        // 向content-script发送性能数据采集请求
        sendToContentScript(tabId, {
          type: 'get_performance',
          requestId: request.requestId
        }).then(response => {
          console.log('Background received performance data:', response)
          sendResponse(response)
        }).catch(error => {
          console.error('Error getting performance data:', error)
          sendResponse({
            success: false,
            error: error.message
          })
        })
      } else {
        sendResponse({
          success: false,
          error: 'No active tab found'
        })
      }
    }).catch(error => {
      console.error('Error querying tabs:', error)
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
