/**
 * P12c 可信输入 CDP 直连通道
 *
 * agent-server 直连 Chrome CDP 端口（--remote-debugging-port），
 * 发 Input.dispatchMouseEvent（isTrusted:true）——完全绕过扩展消息系统。
 * 无 SW 唤醒竞态、无多上下文路由、无消息端口丢失。
 *
 * 前提：Chrome 以 --remote-debugging-port=9222 启动（测试环境已满足）。
 */

const http = require('http')

let cdpWs = null

/** HTTP GET 短请求 */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let b = ''
      res.on('data', (c) => (b += c))
      res.on('end', () => { try { resolve(JSON.parse(b)) } catch (e) { reject(e) } })
    }).on('error', reject)
  })
}

/** 找 zhipin tab 的 CDP target */
async function findZhipinTarget() {
  const targets = await httpGet('http://127.0.0.1:9222/json/list')
  return targets.find((t) => t.type === 'page' && t.url.includes('zhipin.com')) || null
}

/** 连接 CDP WebSocket（懒连接） */
async function ensureCdpConnection(targetUrl) {
  if (cdpWs) return
  return new Promise((resolve, reject) => {
    const WebSocket = require('ws')
    cdpWs = new WebSocket(targetUrl, { perMessageDeflate: false })
    let msgId = 0
    const pending = new Map()
    cdpWs.on('open', () => resolve())
    cdpWs.on('message', (d) => {
      const m = JSON.parse(d.toString())
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id)
        pending.delete(m.id)
        m.error ? p.rej(new Error(m.error.message || 'cdp err')) : p.res(m.result)
      }
    })
    cdpWs.on('error', reject)
    // 重写 send 为 promise-based
    cdpWs.sendCdp = (method, params = {}) => new Promise((res, rej) => {
      const id = ++msgId
      pending.set(id, { res, rej })
      cdpWs.send(JSON.stringify({ id, method, params }))
    })
  })
}

/** 确保连接并返回 cdp 操作接口 */
async function ensureCdp() {
  if (cdpWs) return
  const target = await findZhipinTarget()
  if (!target) throw new Error('未找到 zhipin 标签页（Chrome 需以 --remote-debugging-port 启动）')
  await ensureCdpConnection(target.webSocketDebuggerUrl)
}

/** CDP 真实鼠标点击（isTrusted:true） */
async function cdpTrustedClick(x, y) {
  await ensureCdp()
  await cdpWs.sendCdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await new Promise((r) => setTimeout(r, 120))
  await cdpWs.sendCdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await cdpWs.sendCdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}

/** CDP 在页面上执行 JS 并返回结果 */
async function cdpEvaluate(expression) {
  await ensureCdp()
  const r = await cdpWs.sendCdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error('CDP 页面异常: ' + String(r.exceptionDetails.exception?.description || '').slice(0, 250))
  return r.result?.value
}

/** 断开 CDP 连接 */
function disconnect() {
  if (cdpWs) { cdpWs.close(); cdpWs = null }
}

module.exports = { cdpTrustedClick, cdpEvaluate, disconnect, findZhipinTarget }
