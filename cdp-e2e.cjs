/**
 * 真 UI 级 e2e：真 Chrome(CfT) + 真扩展侧边栏 + 真 LLM + 真 MCP + 真审批点击
 * 架构事实：WS 连接由侧边栏页面自身持有（SidePanel.vue:1450），打开侧边栏即建立连接，
 * 后台 SW 休眠不影响。扩展 ID 是 unpacked 路径哈希（同路径稳定），扫描不到时用已捕获常量。
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const WebSocket = require('agent-server/node_modules/ws')

const PORT = 9222
const KNOWN_EXT_ID = 'lohncjjgijmfeebodmpnklepmceamhgi' // 2026-09-27 会话捕获（unpacked 路径哈希，同路径稳定）
const SIDEPANEL_PATH = 'dist/src/ui/sidepanel/index.html'
const SCOPE = path.join(__dirname, 'agent-server', 'mcp-e2e-scope')
const TARGET = path.join(SCOPE, '真机测试.md')
const SHOT_DIR = path.join(__dirname, 'agent-server', 'eval', 'results')

function httpJson(p, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method }, (res) => {
      let b = ''
      res.on('data', (c) => (b += c))
      res.on('end', () => {
        try { resolve(JSON.parse(b)) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function attach(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false })
    let seq = 0
    const pending = new Map()
    ws.on('open', () => {
      resolve({
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const id = ++seq
            pending.set(id, { res, rej })
            ws.send(JSON.stringify({ id, method, params }))
          })
        },
        close: () => ws.close(),
      })
    })
    ws.on('message', (d) => {
      const msg = JSON.parse(d.toString())
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id)
        pending.delete(msg.id)
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result)
      }
    })
    ws.on('error', reject)
  })
}

async function evaluate(session, expression) {
  const r = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error('页面执行异常: ' + JSON.stringify(r.exceptionDetails.exception?.description || '').slice(0, 300))
  return r.result?.value
}

async function shot(session, file) {
  const r = await session.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(SHOT_DIR, file), Buffer.from(r.data, 'base64'))
  console.log(`📸 截图: ${file}`)
}

async function main() {
  // 1) 扩展 ID：优先从活跃 SW 扫描，休眠则用已捕获常量
  let extensionId = null
  try {
    const targets = await httpJson('/json/list')
    const sw = targets.find((t) => t.type === 'service_worker' && t.url.includes('dist/script/background.js'))
    if (sw) extensionId = sw.url.slice('chrome-extension://'.length).split('/')[0]
  } catch {}
  if (!extensionId) extensionId = KNOWN_EXT_ID
  console.log(`扩展 ID: ${extensionId}`)

  // 2) 打开侧边栏页（普通标签页即可完整运行；打开即建立 WS 连接）
  let created
  try {
    created = await httpJson(`/json/new?chrome-extension://${extensionId}/${SIDEPANEL_PATH}`)
  } catch {
    created = await httpJson(`/json/new?chrome-extension://${extensionId}/${SIDEPANEL_PATH}`, 'PUT')
  }
  console.log(`侧边栏标签页: ${created.id}`)
  await sleep(3000)

  const session = await attach(created.webSocketDebuggerUrl)
  await session.send('Page.enable')
  await session.send('Runtime.enable')

  // 3) 等 UI 就绪 + WS 连接建立
  let ready = false
  for (let i = 0; i < 20; i++) {
    ready = await evaluate(session, `!!document.querySelector('textarea')`)
    if (ready) break
    await sleep(1000)
  }
  if (!ready) throw new Error('侧边栏输入框未出现')
  await sleep(3000) // 留给 WS 握手
  const connText = await evaluate(session, `document.body.innerText.slice(0, 500).replace(/\\n+/g, ' | ')`)
  console.log(`UI 状态: ${connText.slice(0, 260)}`)

  // 4) 真实填写指令并发送（原生 setter + input 事件喂 Vue v-model，Enter 触发发送）
  const prompt =
    '请用你的文件写入工具，在 C:\\Users\\Maxkim\\Desktop\\mcp\\mcp-browser-analyzer\\agent-server\\mcp-e2e-scope 目录创建文件「真机测试.md」，内容为：# MCP 全链路真机测试（UI 审批） 本文件由 Browser Assistant 侧边栏真实审批后写入。'
  await evaluate(session, `(() => {
    const ta = document.querySelector('textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, ${JSON.stringify(prompt)})
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
    return 'sent'
  })()`)
  console.log('指令已从侧边栏真实发送')

  // 5) 轮询审批卡（"允许执行"），最长 120s（与审批超时上限一致）
  let approvalSeen = false
  for (let i = 0; i < 120; i++) {
    const has = await evaluate(
      session,
      `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('允许执行')); return b? 'yes':'no' })()`
    )
    if (has === 'yes') { approvalSeen = true; break }
    await sleep(1000)
  }
  if (!approvalSeen) throw new Error('120s 内未出现审批卡')
  console.log('🔔 审批卡已出现在侧边栏（真实 UI）')
  await shot(session, 'ui-e2e-审批卡出现.png')

  // 6) 真实点击"允许执行"
  await evaluate(session, `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('允许执行')); b.click(); return 'clicked' })()`)
  console.log('🖱️ 已真实点击「允许执行」')

  // 7) 磁盘真值验证
  let diskOk = false
  for (let i = 0; i < 30; i++) {
    if (fs.existsSync(TARGET) && fs.readFileSync(TARGET, 'utf8').includes('UI 审批')) { diskOk = true; break }
    await sleep(1000)
  }
  const disk = diskOk ? fs.readFileSync(TARGET, 'utf8') : '(不存在)'
  console.log(`磁盘真值: exists=${diskOk} content=${disk.trim().slice(0, 120)}`)
  await sleep(3000)
  await shot(session, 'ui-e2e-审批后完成.png')

  const finalText = await evaluate(session, `document.body.innerText.slice(-600).replace(/\\n+/g, ' | ')`)
  console.log(`侧边栏最终状态: ${finalText.slice(0, 300)}`)
  console.log(diskOk ? '\n✅ 真 UI 全链路 PASS：真扩展侧边栏 → 真 LLM → 真 MCP → 真 UI 审批点击 → 真磁盘' : '\n❌ FAIL：文件未落盘')
  session.close()
  process.exit(diskOk ? 0 : 1)
}

main().catch((e) => {
  console.error('UI e2e 失败:', e.message)
  process.exit(1)
})
