const { test } = require('node:test')
const assert = require('node:assert/strict')
const { runToolPipeline, withTimeout } = require('../src/core/tool-pipeline.js')

test('withTimeout: 正常完成时返回结果并清理定时器', async () => {
  const result = await withTimeout(Promise.resolve('ok'), 1000, 'timeout')
  assert.equal(result, 'ok')
})

test('withTimeout: 超时抛 code=TIMEOUT', async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), 20, 'slow tool'),
    (err) => err.code === 'TIMEOUT' && /slow tool/.test(err.message),
  )
})

test('withTimeout: 内部错误原样上抛', async () => {
  await assert.rejects(
    withTimeout(Promise.reject(new Error('boom')), 1000, 'x'),
    /boom/,
  )
})

test('runToolPipeline: 默认放行并返回工具结果', async () => {
  const result = await runToolPipeline({
    toolName: 'get_page_content',
    args: { url: 'https://example.com' },
    context: {},
    run: (args) => ({ content: [{ text: `content of ${args.url}` }] }),
  })
  assert.equal(result.content[0].text, 'content of https://example.com')
})

test('runToolPipeline: 权限校验拒绝时返回统一错误格式（不执行 run）', async () => {
  let executed = false
  const result = await runToolPipeline({
    toolName: 'write_file',
    args: {},
    context: {},
    permissionCheck: () => false,
    run: () => {
      executed = true
      return { content: [{ text: 'should not run' }] }
    },
  })
  assert.equal(executed, false)
  assert.match(result.content[0].text, /Permission denied/)
})

test('runToolPipeline: 权限校验通过则正常执行', async () => {
  const result = await runToolPipeline({
    toolName: 'get_page_content',
    args: {},
    context: {},
    permissionCheck: () => true,
    run: () => ({ content: [{ text: 'allowed' }] }),
  })
  assert.equal(result.content[0].text, 'allowed')
})

test('runToolPipeline: 超时后抛 code=TIMEOUT', async () => {
  await assert.rejects(
    runToolPipeline({
      toolName: 'slow',
      args: {},
      context: {},
      timeoutMs: 20,
      run: () => new Promise(() => {}),
    }),
    (err) => err.code === 'TIMEOUT',
  )
})

test('runToolPipeline: 权限 hook 是异步时也生效', async () => {
  const result = await runToolPipeline({
    toolName: 'x',
    args: {},
    context: {},
    permissionCheck: async () => false,
    run: () => ({ content: [{ text: 'nope' }] }),
  })
  assert.match(result.content[0].text, /Permission denied/)
})
