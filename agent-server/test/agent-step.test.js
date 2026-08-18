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
