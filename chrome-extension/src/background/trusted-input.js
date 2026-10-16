/**
 * P12c 可信输入通道：chrome.debugger（CDP）Input.dispatchMouseEvent
 *
 * 背景：Boss 直聘等强风控站点的事件处理器校验 isTrusted——content script 合成
 * 事件（isTrusted:false）无论单击还是完整鼠标序列都被拒（真机三重验证，含登录态）。
 * CDP Input 走浏览器真实输入管线，事件 isTrusted:true（Playwright/Puppeteer 内部同路径）。
 *
 * 代价与对策：debugger attach 期间页面顶部显示"正在调试"横幅——空闲 10s 自动
 * detach，连续动作期间保持连接（横幅不闪烁）。host_permissions <all_urls> 已覆盖。
 */

const attached = new Set()
const idleTimers = new Map()
const IDLE_DETACH_MS = 10000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const attach = (tabId) =>
  new Promise((resolve, reject) => {
    if (attached.has(tabId)) return resolve()
    chrome.debugger.attach({ tabId }, '1.3', () => {
      if (chrome.runtime.lastError) {
        // 已在调试中（重复 attach）视为成功
        if (/already attached/i.test(chrome.runtime.lastError.message || '')) {
          attached.add(tabId)
          return resolve()
        }
        return reject(new Error(`debugger attach 失败: ${chrome.runtime.lastError.message}`))
      }
      attached.add(tabId)
      resolve()
    })
  })

const detach = (tabId) =>
  new Promise((resolve) => {
    if (!attached.has(tabId)) return resolve()
    chrome.debugger.detach({ tabId }, () => {
      attached.delete(tabId)
      resolve()
    })
  })

const scheduleIdleDetach = (tabId) => {
  clearTimeout(idleTimers.get(tabId))
  idleTimers.set(
    tabId,
    setTimeout(() => {
      void detach(tabId)
      idleTimers.delete(tabId)
    }, IDLE_DETACH_MS)
  )
}

const sendInput = (tabId, method, params) =>
  new Promise((resolve, reject) => {
    const target = { tabId }
    chrome.debugger.sendCommand(target, method, params, (r) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message))
      resolve(r)
    })
  })

/**
 * 可信点击：CDP 真实鼠标序列（move → pressed → released），事件 isTrusted:true
 * @param {number} tabId 目标标签页
 * @param {number} x 视口坐标（content script 已 scrollIntoView 并取中心）
 * @param {number} y
 */
export async function trustedClick(tabId, x, y) {
  await attach(tabId)
  clearTimeout(idleTimers.get(tabId))
  idleTimers.set(tabId, setTimeout(() => {
    void detach(tabId)
    idleTimers.delete(tabId)
  }, IDLE_DETACH_MS))
  await sendInput(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await sleep(80)
  await sendInput(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await sleep(50)
  await sendInput(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  return { ok: true, info: `可信点击已发送（${x},${y}，isTrusted:true）` }
}

/** 显式释放（调试横幅尽快消失） */
export async function trustedDetach(tabId) {
  clearTimeout(idleTimers.get(tabId))
  idleTimers.delete(tabId)
  await detach(tabId)
  return { ok: true }
}
