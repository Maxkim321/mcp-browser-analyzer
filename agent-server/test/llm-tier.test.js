const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { LLMClient } = require('../src/core/llm.js')
const { getProvider, isRetryable } = require('../src/core/llm-providers.js')

/**
 * 多模型抽象 + 分级路由测试
 */

// ===== resolveTierConfig：档位解析与回落 =====

const baseClient = () =>
  new LLMClient({
    apiKey: 'sk-base',
    baseURL: 'https://api.example.com/v1',
    model: 'main-model',
    temperature: 0.7,
    tiers: {
      light: { model: 'lite-model', temperature: 0.2 },
      reasoning: { model: undefined }, // env 未设置时的占位：必须回落主模型
      remote: { model: 'remote-model', baseURL: 'https://other.example.com/v1' },
    },
  })

test('resolveTierConfig: 未标注档位 → 主配置', () => {
  const cfg = baseClient().resolveTierConfig(undefined)
  assert.equal(cfg.model, 'main-model')
  assert.equal(cfg.apiKey, 'sk-base')
})

test('resolveTierConfig: light 档覆盖 model/temperature，其余沿用主配置', () => {
  const cfg = baseClient().resolveTierConfig('light')
  assert.equal(cfg.model, 'lite-model')
  assert.equal(cfg.temperature, 0.2)
  assert.equal(cfg.baseURL, 'https://api.example.com/v1', 'baseURL 应回落主配置')
})

test('resolveTierConfig: 档位里 undefined 占位不能抹掉主模型', () => {
  const cfg = baseClient().resolveTierConfig('reasoning')
  assert.equal(cfg.model, 'main-model', 'config 里 model:undefined 的档位应整体回落')
})

test('resolveTierConfig: 档位可换 baseURL（不同厂商混布）', () => {
  const cfg = baseClient().resolveTierConfig('remote')
  assert.equal(cfg.model, 'remote-model')
  assert.equal(cfg.baseURL, 'https://other.example.com/v1')
  assert.equal(cfg.apiKey, 'sk-base', 'apiKey 未单独配置时沿用主配置')
})

// ===== chat / chatStream：请求体确实用了档位模型 =====

const fakeFetchCalls = []
function installMockFetch(handler) {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    fakeFetchCalls.push({ url, init })
    return handler(url, init)
  }
  return () => {
    globalThis.fetch = original
    fakeFetchCalls.length = 0
  }
}

const okResponse = (body) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
})

beforeEach(() => fakeFetchCalls.length = 0)

test('chat: tier 路由生效——请求体 model 用档位模型，Authorization 沿用主 apiKey', async () => {
  const restore = installMockFetch(() =>
    okResponse({ choices: [{ message: { role: 'assistant', content: 'ok' } }] })
  )
  try {
    const client = baseClient()
    const reply = await client.chat([{ role: 'user', content: 'hi' }], [], undefined, undefined, {
      tier: 'light',
    })
    assert.equal(reply.content, 'ok')
    assert.equal(fakeFetchCalls.length, 1)
    const body = JSON.parse(fakeFetchCalls[0].init.body)
    assert.equal(body.model, 'lite-model', 'light 档请求应携带便宜模型')
    assert.equal(fakeFetchCalls[0].url, 'https://api.example.com/v1/chat/completions')
    assert.equal(fakeFetchCalls[0].init.headers.Authorization, 'Bearer sk-base')
    assert.equal(body.temperature, 0.2)
  } finally {
    restore()
  }
})

test('chat: 未标注档位时用主模型（上层零改动即是默认行为）', async () => {
  const restore = installMockFetch(() =>
    okResponse({ choices: [{ message: { role: 'assistant', content: 'ok' } }] })
  )
  try {
    await baseClient().chat([{ role: 'user', content: 'hi' }])
    assert.equal(JSON.parse(fakeFetchCalls[0].init.body).model, 'main-model')
  } finally {
    restore()
  }
})

// ===== 重试：瞬时错误（5xx/429/网络）自动退避重试，4xx 不重试 =====

test('chat: 500 两次后成功 → 自动重试且最终返回', async () => {
  let calls = 0
  const restore = installMockFetch(() => {
    calls++
    if (calls <= 2) {
      return { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' }
    }
    return okResponse({ choices: [{ message: { role: 'assistant', content: 'recovered' } }] })
  })
  try {
    const reply = await new LLMClient({ apiKey: 'k', baseURL: 'https://x/v1', model: 'm' }).chat([
      { role: 'user', content: 'hi' },
    ])
    assert.equal(reply.content, 'recovered')
    assert.equal(calls, 3, '初始 1 次 + 重试 2 次')
  } finally {
    restore()
  }
})

test('chat: 400 参数错误不重试', async () => {
  let calls = 0
  const restore = installMockFetch(() => {
    calls++
    return { ok: false, status: 400, json: async () => ({}), text: async () => 'bad request' }
  })
  try {
    await assert.rejects(
      () => new LLMClient({ apiKey: 'k', baseURL: 'https://x/v1', model: 'm' }).chat([]),
      /400/
    )
    assert.equal(calls, 1, '4xx 不应重试')
  } finally {
    restore()
  }
})

test('chat: fetch 网络异常（TypeError）视为瞬时错误重试', async () => {
  let calls = 0
  const restore = installMockFetch(() => {
    calls++
    if (calls === 1) throw new TypeError('fetch failed')
    return okResponse({ choices: [{ message: { role: 'assistant', content: 'ok' } }] })
  })
  try {
    await new LLMClient({ apiKey: 'k', baseURL: 'https://x/v1', model: 'm' }).chat([])
    assert.equal(calls, 2)
  } finally {
    restore()
  }
})

test('isRetryable: 429/5xx/网络错误可重试，4xx/Abort 不可', () => {
  assert.equal(isRetryable({ statusCode: 429 }), true)
  assert.equal(isRetryable({ statusCode: 503 }), true)
  assert.equal(isRetryable(new TypeError('fetch failed')), true)
  assert.equal(isRetryable({ statusCode: 401 }), false)
  assert.equal(isRetryable({ statusCode: 400 }), false)
  assert.equal(isRetryable(Object.assign(new Error('x'), { name: 'AbortError' })), false)
})

test('getProvider: 未知 provider 名回落 openai-compatible', () => {
  assert.equal(getProvider('openai-compatible'), getProvider('typo-name'))
  assert.equal(typeof getProvider('openai-compatible').chat, 'function')
  assert.equal(typeof getProvider('openai-compatible').chatStream, 'function')
})

// ===== applyConfig：插件配置页下发的 tiers 可运行时更新 =====

test('applyConfig: tiers 运行时可覆盖，不影响未提及的档位', () => {
  const client = baseClient()
  client.applyConfig({ tiers: { light: { model: 'newer-lite' } } })
  assert.equal(client.resolveTierConfig('light').model, 'newer-lite')
  assert.equal(client.resolveTierConfig('remote').model, 'remote-model')
})
