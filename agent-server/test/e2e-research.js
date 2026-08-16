/**
 * M1-F8 深度研究端到端验证脚本（临时，验证后可删）
 * 模拟浏览器插件：连接 WS，发送 research 请求，自动响应 fetch_url / workflow_answer
 * 用法：node test/e2e-research.js
 */
const WebSocket = require('ws')

const ws = new WebSocket('ws://localhost:9999')
const question = process.argv[2] || '帮我研究一下 MCP 和 A2A 有什么区别，并输出研究报告'

let fetchCount = 0
let askCount = 0

ws.on('open', () => {
  console.log('[client] connected, sending research request...')
  ws.send(JSON.stringify({ type: 'user_prompt', prompt: question, action: 'research' }))
})

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString())
  switch (msg.type) {
    case 'workflow_progress':
      console.log(`[progress] ${msg.message}`)
      break
    case 'fetch_url': {
      // 模拟插件：后台 tab 读取指定 URL 的正文
      fetchCount++
      const content = `【模拟页面 ${fetchCount}】url=${msg.url}\n` +
        'Model Context Protocol (MCP) 是 Anthropic 提出的开放协议，用于标准化 AI 应用与外部数据源、工具之间的连接。\n' +
        'Agent2Agent (A2A) 是 Google 提出的代理间通信协议，用于不同 Agent 之间交换任务、状态与能力声明。\n' +
        '两者定位不同：MCP 连接 AI 与工具/数据（Agent 与世界的接口），A2A 连接 Agent 与 Agent（Agent 之间的协作协议）。'
      ws.send(JSON.stringify({
        type: 'fetch_url_result',
        requestId: msg.requestId,
        payload: { url: msg.url, title: `页面${fetchCount}`, content, charCount: content.length },
      }))
      console.log(`[mock] fetch_url ${msg.url} -> 回包 ${content.length} 字符`)
      break
    }
    case 'workflow_ask':
      askCount++
      console.log(`[ask] ${msg.question}`)
      // 第一问：自定义方向；之后：停止
      ws.send(JSON.stringify({
        type: 'workflow_answer',
        taskId: msg.taskId,
        answer: askCount === 1 ? '补充研究一下它们如何协作' : '停止研究',
        cancel: askCount !== 1,
      }))
      console.log(`[mock] workflow_answer -> ${askCount === 1 ? '自定义方向' : '停止研究'}`)
      break
    case 'token':
      process.stdout.write(`[token] ${msg.content}`)
      break
    case 'agent_response':
      console.log('\n\n===== 最终回复（前 1500 字）=====')
      console.log(msg.content.slice(0, 1500))
      console.log('=================================')
      console.log(`fetch_url 次数: ${fetchCount}, HITL 询问次数: ${askCount}`)
      ws.close()
      process.exit(msg.success ? 0 : 1)
  }
})

ws.on('error', (err) => {
  console.error('[client] ws error:', err.message)
  process.exit(1)
})

// 总超时兜底（真实 LLM 调用可能较慢）
setTimeout(() => {
  console.error('[client] timeout: 研究超过 5 分钟未完成')
  ws.close()
  process.exit(1)
}, 300000)
