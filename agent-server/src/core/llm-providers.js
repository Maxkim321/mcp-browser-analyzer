/**
 * LLM Provider 适配层
 *
 * 职责：把"某个协议怎么调"（请求/流式解析/重试）从"选哪个模型"（LLMClient 的路由）中剥离。
 * 当前所有国产/主流模型（DeepSeek、ARK/豆包、Moonshot、Ollama 等）都兼容 OpenAI 的
 * /chat/completions 协议，故先只实现一个适配器；接入 Claude/Gemini 这类原生协议时
 * 新增一个同接口的 adapter 即可，LLMClient 与上层编排代码零改动。
 *
 * 适配器接口约定：
 * - chat(cfg, body, signal) => { role, content, tool_calls? }
 * - chatStream(cfg, body, onToken, signal) => 同 chat 的返回（流式增量拼装后）
 * cfg 是"该次请求实际生效的模型配置"（含 apiKey/baseURL/model/temperature），由 LLMClient 按分级路由解析后传入。
 */

const TRANSIENT_RETRYABLE = { maxRetries: 2, backoffMs: 800 }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 是否为值得重试的瞬时错误：
 * - HTTP 429（限流）/ 5xx（服务端抖动）
 * - 网络层错误（fetch TypeError）
 * 不重试：4xx 参数/鉴权错误（重试也不会好）、AbortError（用户主动取消）
 */
function isRetryable(error) {
  if (error?.name === 'AbortError') return false
  if (error?.statusCode === 429) return true
  if (error?.statusCode >= 500) return true
  // fetch 网络失败在 Node 里表现为 TypeError（fetch failed）
  return error instanceof TypeError
}

/**
 * 带退避的重试包装：只对瞬时错误生效，指数退避（800ms → 1600ms）
 * @param {Function} fn - 每次尝试执行的函数
 * @param {AbortSignal} [signal] - 取消信号：abort 期间不再发起下一次重试
 */
async function withRetry(fn, signal) {
  let lastError
  for (let attempt = 0; attempt <= TRANSIENT_RETRYABLE.maxRetries; attempt++) {
    if (signal?.aborted) {
      throw Object.assign(new Error('LLM request aborted'), { name: 'AbortError' })
    }
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (!isRetryable(error) || attempt === TRANSIENT_RETRYABLE.maxRetries) throw error
      const delay = TRANSIENT_RETRYABLE.backoffMs * 2 ** attempt
      console.warn(`[LLM] Transient error (${error.statusCode || error.message}), retry ${attempt + 1} in ${delay}ms`)
      await sleep(delay)
    }
  }
  throw lastError
}

async function readErrorBody(response) {
  try {
    return await response.text()
  } catch {
    return '(no body)'
  }
}

// ===== OpenAI 兼容协议适配器 =====

const openaiCompatible = {
  /**
   * 非流式对话。自动重试瞬时错误（限流/5xx/网络抖动）
   */
  async chat(cfg, body, signal) {
    return withRetry(async () => {
      const response = await fetch(`${cfg.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      })
      if (!response.ok) {
        const error = await readErrorBody(response)
        throw Object.assign(new Error(`LLM API error: ${response.status} - ${error}`), {
          statusCode: response.status,
        })
      }
      const data = await response.json()
      return data.choices[0].message
    }, signal)
  },

  /**
   * 流式对话：SSE 增量接收，tool_calls delta 按 index 拼装。
   * 重试策略与 chat 不同：只有在收到响应头之前（还没吐出第一个 token）才允许重试，
   * 一旦开始读取 body，重试会导致 onToken 重复推送，只能向上抛错。
   */
  async chatStream(cfg, body, onToken, signal) {
    const response = await withRetry(async () => {
      const res = await fetch(`${cfg.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      })
      if (!res.ok) {
        const error = await readErrorBody(res)
        throw Object.assign(new Error(`LLM API error: ${res.status} - ${error}`), {
          statusCode: res.status,
        })
      }
      return res
    }, signal)

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    // tool_calls 按 index 累积：流式接口会分多次返回同一 index 的增量
    const toolCalls = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE 按行分割，最后一行可能不完整，保留到下一轮
      const lines = buffer.split('\n')
      buffer = lines.pop()

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (!data || data === '[DONE]') continue

        try {
          const chunk = JSON.parse(data)
          const delta = chunk.choices?.[0]?.delta || {}
          if (delta.content) {
            content += delta.content
            onToken?.(delta.content)
          }
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const index = tc.index ?? 0
              toolCalls[index] = toolCalls[index] || {
                index,
                id: '',
                type: 'function',
                function: { name: '', arguments: '' },
              }
              if (tc.id) toolCalls[index].id = tc.id
              if (tc.type) toolCalls[index].type = tc.type
              if (tc.function?.name) toolCalls[index].function.name += tc.function.name
              if (tc.function?.arguments)
                toolCalls[index].function.arguments += tc.function.arguments
            }
          }
        } catch (error) {
          console.warn('[LLM] SSE parse chunk failed:', error.message)
        }
      }
    }

    const message = { role: 'assistant', content }
    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.function.name, arguments: tc.function.arguments },
      }))
    }
    return message
  },
}

const providers = {
  'openai-compatible': openaiCompatible,
}

/**
 * 按名称取适配器；未知名称回落到 openai-compatible（配置笔误不至于让服务起不来）
 */
function getProvider(name) {
  return providers[name] || openaiCompatible
}

module.exports = { providers, getProvider, withRetry, isRetryable }
