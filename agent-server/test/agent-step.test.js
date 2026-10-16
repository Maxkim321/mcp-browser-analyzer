const test = require('node:test')
const assert = require('node:assert')
const { Agent } = require('../src/core/agent.js')

/**
 * dph-A 单测：mock fetch 返回 SSE 流，验证
 * 1. onStep 收到 reasoning → done 事件（可观测）
 * 2. result.steps 计数正确
 * 3. AbortController 提前 abort → 抛 ABORTED（可取消）
 */
function mockFetchWithSSE(payloads) {
  global.fetch = async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream({
      start(controller) {
        for (const p of payloads) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(p)}\n\n`))
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    return { ok: true, status: 200, body, text: async () => '' }
  }
}

const delta = (content) => ({ choices: [{ delta: { content } }] })

test('dph-A: onStep 收到 reasoning/done 事件，steps 计数正确', async () => {
  mockFetchWithSSE([delta('这是最终回答。')])
  const agent = new Agent()
  const steps = []
  const result = await agent.process('测试问题', {
    onStep: (s) => steps.push(s),
  })
  assert.strictEqual(result.success, true)
  assert.strictEqual(result.content, '这是最终回答。')
  // reasoning(step1) + done(step2)
  assert.ok(steps.length >= 2)
  assert.strictEqual(steps[0].phase, 'reasoning')
  assert.strictEqual(steps[0].step, 1)
  assert.strictEqual(steps[steps.length - 1].phase, 'done')
  assert.ok(result.steps >= 2)
})

test('dph-A: 工具轮触发 tool step 事件', async () => {
  mockFetchWithSSE([
    // 第一轮：要求调用 todo_write
    {
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call_1',
            type: 'function',
            function: { name: 'todo_write', arguments: '{"todos":[{"content":"x","status":"pending"}]}' },
          }],
        },
      }],
    },
    // 第二轮：直接回答
    delta('已记录。'),
  ])
  const agent = new Agent()
  const steps = []
  const result = await agent.process('记录一个任务', { onStep: (s) => steps.push(s) })
  assert.strictEqual(result.success, true)
  const toolStep = steps.find((s) => s.phase === 'tool')
  assert.ok(toolStep, '应有 tool step 事件')
  assert.strictEqual(toolStep.tool, 'todo_write')
})

test('P10: 工具执行补发 done 终态事件（executed 路径，带 dangerLevel 与耗时）', async () => {
  // get_page_content 需要插件在线，评测覆盖口给个罐头结果，走完整编排链路
  const handler = require('../src/tools/handler.js')
  handler.init({ manager: { getIds: () => [], getCount: () => 0 }, send: () => true })
  handler.setToolOverrides({
    get_page_content: async () => ({ content: [{ type: 'text', text: '页面正文内容' }] }),
  })
  try {
    mockFetchWithSSE([
      {
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_1',
              type: 'function',
              function: { name: 'get_page_content', arguments: '{}' },
            }],
          },
        }],
      },
      delta('已读取页面。'),
    ])
    const agent = new Agent()
    const steps = []
    const result = await agent.process('读一下页面', { onStep: (s) => steps.push(s) })
    assert.strictEqual(result.success, true)
    const running = steps.find((s) => s.phase === 'tool' && s.status === 'running')
    const done = steps.find((s) => s.phase === 'tool' && s.status === 'done')
    assert.ok(running, '应先有 running 事件')
    assert.ok(done, '应有 done 终态事件（此前轨迹会永远停在调用中）')
    assert.strictEqual(done.tool, 'get_page_content')
    assert.strictEqual(done.outcome, 'executed')
    assert.strictEqual(done.ok, true)
    assert.strictEqual(done.dangerLevel, 'read')
    assert.ok(typeof done.durationMs === 'number')
  } finally {
    handler.setToolOverrides({})
  }
})

test('P10: 权限拒绝也是终态——done 事件如实落 denied，不再被动等下一轮收敛', async () => {
  const handler = require('../src/tools/handler.js')
  handler.init({ manager: { getIds: () => [], getCount: () => 0 }, send: () => true })
  handler.setToolOverrides({
    get_page_content: async () => ({ content: [{ type: 'text', text: '不应被执行' }] }),
  })
  try {
    mockFetchWithSSE([
      {
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_1',
              type: 'function',
              function: { name: 'get_page_content', arguments: '{}' },
            }],
          },
        }],
      },
      delta('好的，我不读了。'),
    ])
    const agent = new Agent()
    const steps = []
    await agent.process('读一下页面', {
      onStep: (s) => steps.push(s),
      permissionCheck: async () => ({ allowed: false, reason: '测试拒绝' }),
    })
    const done = steps.find((s) => s.phase === 'tool' && s.status === 'done')
    assert.ok(done, '被拒也应有 done 事件')
    assert.strictEqual(done.outcome, 'denied')
    assert.strictEqual(done.ok, true, '被拒不是异常，调用本身闭环了')
  } finally {
    handler.setToolOverrides({})
  }
})

test('dph-A: 取消时抛 ABORTED，不返回系统错误', async () => {
  // 永不结束的 SSE（模拟慢响应），监听 signal.abort 后立即 error 流 → reader.read() 抛 AbortError
  global.fetch = async (_url, init) => {
    const encoder = new TextEncoder()
    let timer = null
    const body = new ReadableStream({
      start(controller) {
        init.signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          controller.error(new DOMException('Aborted', 'AbortError'))
        })
        // 无 abort 时 3s 后兜底关闭，避免事件循环挂起
        timer = setTimeout(() => {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        }, 3000)
      },
    })
    return { ok: true, status: 200, body, text: async () => '' }
  }
  const agent = new Agent()
  const controller = new AbortController()
  const promise = agent.process('慢问题', { signal: controller.signal })
  setTimeout(() => controller.abort(), 50)
  await assert.rejects(promise, (err) => err.code === 'ABORTED' || err.name === 'AbortError')
})
