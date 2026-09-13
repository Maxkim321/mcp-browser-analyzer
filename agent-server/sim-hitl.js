/**
 * 深度研究 HITL 体验模拟：mock LLM + mock 工具，
 * 按真实 workflow 状态机跑完 3 主题研究，打印用户视角的事件时间线
 */
const { ResearchWorkflow } = require('./src/core/workflow.js')

const PLAN = {
  subQuestions: [
    { question: '主题一：市场规模', queries: ['市场规模 数据'] },
    { question: '主题二：主要玩家', queries: ['主要玩家 对比'] },
    { question: '主题三：发展趋势', queries: ['发展趋势 预测'] },
  ],
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 假 LLM：按消息内容分发到 plan / grade / compare / report
const fakeLLM = {
  async chat(messages) {
    const text = String(messages[0]?.content)
    if (text.startsWith('研究问题：')) {
      return { content: JSON.stringify(PLAN) }
    }
    if (text.includes('网页正文')) {
      return { content: JSON.stringify({ points: ['要点A', '要点B'], sufficient: true, gap: '' }) }
    }
    return { content: JSON.stringify({ agreements: ['共识'], conflicts: ['分歧'], insights: ['洞察'] }) }
  },
  async chatStream(messages, tools, systemPrompt, onToken) {
    const report = '# 模拟报告\n\n这是最终报告正文。'
    for (const chunk of report.match(/.{1,4}/g) || []) {
      onToken?.(chunk)
    }
    return { content: report }
  },
}

// 假工具：web_search / fetch_url 都秒回
const fakeToolCall = async (name) => {
  if (name === 'web_search') {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            results: [
              { title: '来源1', url: 'https://a.example.com/1' },
              { title: '来源2', url: 'https://b.example.com/2' },
            ],
          }),
        },
      ],
    }
  }
  return {
    content: [{ type: 'text', text: JSON.stringify({ url: 'https://x.example.com', title: '页面', content: '正文'.repeat(100) }) }],
  }
}

async function runScenario(label, { answer, answerDelayMs }) {
  console.log(`\n========== 场景：${label} ==========`)
  const t0 = Date.now()
  let paused = 0
  let pauseOpen = null

  const wf = new ResearchWorkflow(fakeLLM, {
    maxTopics: 3,
    checkpoint: false,
    hitlTimeoutMs: 3000,
    toolCaller: fakeToolCall,
  })

  const result = await wf.start('模拟研究问题', {
    connectionId: 1,
    onProgress: (p) => {
      // 进入 ask 时会有一个进度事件，这里只打印普通进度
      console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)}s] 💬 ${p.message}`)
    },
    onAsk: async (question, options) => {
      paused++
      console.log(`\n  [${((Date.now() - t0) / 1000).toFixed(1)}s] ⏸️  ⏸️  研究暂停，等待用户：${question}`)
      console.log(`        选项按钮：${(options || []).join(' / ')}`)
      pauseOpen = Date.now()
      if (answer === 'none') {
        // 用户没看到弹窗（挂后台/切走了）→ 等 workflow 超时
        await sleep(3500)
        console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)}s] ⌛ 用户一直没答（本场景模拟超时）`)
        return { cancel: false, text: '继续研究' }
      }
      await sleep(answerDelayMs)
      console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)}s] ▶️  用户点了「${answer}」，恢复（暂停了 ${((Date.now() - pauseOpen) / 1000).toFixed(1)}s）\n`)
      return { cancel: answer === '停止研究', text: answer }
    },
    onToken: () => {},
  })

  console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)}s] ✅ 结束：${result.success ? '出报告' : '失败'}，全程打断 ${paused} 次`)
}

(async () => {
  await runScenario('用户每次都秒点「继续研究」', { answer: '继续研究', answerDelayMs: 300 })
  await runScenario('用户在忙别的，每次都没理（走超时）', { answer: 'none', answerDelayMs: 0 })
  await runScenario('用户第一个主题看完就想停', { answer: '停止研究', answerDelayMs: 5000 })
})()
