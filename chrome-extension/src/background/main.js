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

const getPageContentWithRetry = async (requestId, maxChars) => {
  const tabId = await getActiveTabId()
  try {
    return await sendToContentScript(tabId, { type: 'get_page_content', requestId, maxChars })
  } catch (error) {
    const message = String(error?.message || '')
    const shouldRetryByInject = message.includes('Receiving end does not exist')
    if (!shouldRetryByInject) {
      throw error
    }
    await ensureContentScriptInjected(tabId)
    return sendToContentScript(tabId, { type: 'get_page_content', requestId, maxChars })
  }
}

// F1 轻量 pageContext：读取当前页面选中文本，SPA/新开页未注入时自动补注入重试
const getSelectionWithRetry = async () => {
  const tabId = await getActiveTabId()
  try {
    return await sendToContentScript(tabId, { type: 'get_selection' })
  } catch (error) {
    const message = String(error?.message || '')
    const shouldRetryByInject = message.includes('Receiving end does not exist')
    if (!shouldRetryByInject) {
      throw error
    }
    await ensureContentScriptInjected(tabId)
    return sendToContentScript(tabId, { type: 'get_selection' })
  }
}

// M1-F8 深度研究：后台新开 tab 读取指定 URL 正文，读完自动关闭，不打扰用户当前页面
const waitTabComplete = (tabId, timeoutMs = 30000) => {
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      c.tabs.onUpdated.removeListener(listener)
      clearTimeout(timer)
    }
    const finish = (tab) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(tab)
    }
    const listener = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        finish(tab)
      }
    }
    c.tabs.onUpdated.addListener(listener)
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        cleanup()
        reject(new Error('Tab load timeout'))
      }
    }, timeoutMs)
  })
}

const fetchUrlInBackgroundTab = async (url, maxChars) => {
  // active: false 后台静默打开，用户当前浏览不受打扰
  const tab = await c.tabs.create({ url, active: false })
  try {
    await waitTabComplete(tab.id, 30000)
    // 注入重试：新开 tab 可能尚未注入 content-script
    try {
      return await sendToContentScript(tab.id, { type: 'get_page_content', maxChars })
    } catch (error) {
      const message = String(error?.message || '')
      if (!message.includes('Receiving end does not exist')) {
        throw error
      }
      await ensureContentScriptInjected(tab.id)
      return await sendToContentScript(tab.id, { type: 'get_page_content', maxChars })
    }
  } finally {
    c.tabs.remove(tab.id).catch(() => void 0)
  }
}

// 划词动作：打开侧边栏并把选中文本+动作转发给 sidepanel
// 注意：sidePanel.open() 只能在用户手势的同步调用链中执行，因此这里不能有任何 await
const handleTextAction = (payload, sender) => {
  // 唯一 id：sidepanel 广播与 storage 兜底两条路径靠它去重
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const data = { id, action: payload.action, text: payload.text }

  // 写入 storage.session（fire-and-forget）：sidepanel 尚未挂载监听器时靠它兜底读取
  c.storage.session.set({ pendingTextAction: data }).catch(() => void 0)

  // 打开侧边栏：用 sender.tab.windowId 保持用户手势上下文（异步 tabs.query 会丢失手势，导致 open 被拒）
  const windowId = sender?.tab?.windowId
  if (windowId != null) {
    c.sidePanel.open({ windowId }).catch((error) => {
      console.warn('sidePanel.open failed (sidepanel may already be open):', error.message)
    })
  }

  // 广播给已挂载的 sidepanel（快速路径），无论 open 成败都发送
  c.runtime.sendMessage({ type: 'text_action_relay', ...data }).catch(() => void 0)
}

// 监听来自agent-server的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request)
  
  if (request.type === 'text_action') {
    // 划词动作：来自 content-script，无需回包，异步处理；sender 提供 tab.windowId 用于同步打开侧边栏
    handleTextAction(request, sender)
    return false
  }

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

  if (request.type === 'get_page_content') {
    getPageContentWithRetry(request.requestId, request.maxChars)
      .then(response => {
        console.log('Background received page content:', response)
        sendResponse(response)
      })
      .catch(error => {
        console.error('Error getting page content:', error)
        sendResponse({
          success: false,
          error: error.message
        })
      })

    return true
  }

  if (request.type === 'fetch_url') {
    // M1-F8 深度研究：后台新开 tab 读取指定 URL 正文（不打扰用户当前页面）
    fetchUrlInBackgroundTab(request.url, request.maxChars)
      .then(response => {
        console.log('Background fetch_url result:', response)
        sendResponse(response)
      })
      .catch(error => {
        console.error('Error fetching url:', error)
        sendResponse({
          success: false,
          error: error.message
        })
      })

    return true
  }

  if (request.type === 'get_selection') {
    getSelectionWithRetry()
      .then(response => {
        sendResponse(response)
      })
      .catch(error => {
        console.error('Error getting selection:', error)
        sendResponse({ success: false, error: error.message })
      })

    return true
  }
  
  return false
})

console.log('Background script loaded')
