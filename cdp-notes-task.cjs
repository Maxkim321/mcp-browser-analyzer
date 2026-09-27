/** 续跑：给 agent 明确内容来源（fetch_url 抓 README）→ 总结 → 审批 → 落盘 笔记.md */
const http = require('http')
const fs = require('fs')
const path = require('path')
const WebSocket = require('agent-server/node_modules/ws')

const PORT = 9222
const NOTES = path.join(__dirname, 'agent-server', 'mcp-e2e-scope', '笔记.md')

function httpJson(p, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method }, (res) => {
      let b = ''
      res.on('data', (c) => (b += c))
      res.on('end', () => { try { resolve(JSON.parse(b)) } catch (e) { reject(e) } })
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
    ws.on('open', () => resolve({
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const id = ++seq
          pending.set(id, { res, rej })
          ws.send(JSON.stringify({ id, method, params }))
        })
      },
      close: () => ws.close(),
    }))
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
  if (r.exceptionDetails) throw new Error('页面异常: ' + String(r.exceptionDetails.exception?.description || '').slice(0, 200))
  return r.result?.value
}

async function shot(session, file) {
  const r = await session.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(__dirname, 'agent-server', 'eval', 'results', file), Buffer.from(r.data, 'base64'))
  console.log(`📸 截图: ${file}`)
}

async function main() {
  const targets = await httpJson('/json/list')
  const panel = targets.find((t) => t.type === 'page' && t.url.includes('sidepanel/index.html'))
  if (!panel) throw new Error('侧边栏标签不存在')
  const session = await attach(panel.webSocketDebuggerUrl)
  await session.send('Page.enable')
  await session.send('Runtime.enable')

  const prompt =
    '内容来源用工具抓：先用 fetch_url 抓取 https://cdn.jsdelivr.net/gh/Maxkim321/mcp-browser-analyzer@main/README.md （jsdelivr 镜像，国内可达），基于真实内容总结要点，然后立刻用文件写入工具把 Markdown 要点保存为 C:\\Users\\Maxkim\\Desktop\\mcp\\mcp-browser-analyzer\\agent-server\\mcp-e2e-scope\\笔记.md，不要再向我确认。'
  await evaluate(session, `(() => {
    const ta = document.querySelector('textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, ${JSON.stringify(prompt)})
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
    return 'sent'
  })()`)
  console.log('👤 已下达续跑指令：fetch_url 抓 README → 总结 → 写入笔记.md')

  let approvalSeen = false
  for (let i = 0; i < 180; i++) {
    const has = await evaluate(session, `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('允许执行')); return b? 'yes':'no' })()`)
    if (has === 'yes') { approvalSeen = true; break }
    await sleep(1000)
  }
  if (!approvalSeen) throw new Error('180s 内未出现审批卡')
  console.log('🔔 审批卡出现')
  await shot(session, 'ui-notes-审批卡.png')
  await evaluate(session, `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('允许执行')); b.click(); return 'ok' })()`)
  console.log('🖱️ 已点击「允许执行」')

  let ok = false
  for (let i = 0; i < 30; i++) {
    if (fs.existsSync(NOTES) && fs.readFileSync(NOTES, 'utf8').length > 150) { ok = true; break }
    await sleep(1000)
  }
  await sleep(2500)
  await shot(session, 'ui-notes-完成.png')
  const tail = await evaluate(session, `document.body.innerText.slice(-700)`)
  console.log(`侧边栏收尾: ${tail.replace(/\n+/g, ' | ').slice(0, 400)}`)
  if (ok) {
    const c = fs.readFileSync(NOTES, 'utf8')
    console.log(`\n📄 笔记.md 落盘（${c.length} 字）：\n───\n${c.slice(0, 700)}\n───`)
    console.log('\n✅ 实用任务 PASS：fetch_url 真抓取 → LLM 总结 → MCP 审批落盘')
  } else {
    console.log('\n❌ 笔记.md 未落盘')
  }
  session.close()
  process.exit(ok ? 0 : 1)
}

main().catch((e) => { console.error('失败:', e.message); process.exit(1) })
