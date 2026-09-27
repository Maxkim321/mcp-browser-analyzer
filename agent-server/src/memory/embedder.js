/**
 * 记忆向量化层（P8 混合检索）
 *
 * 两级 Embedder 设计（借鉴 lifelib 项目已验证的模式）：
 * - HttpEmbedder：OpenAI 兼容 /embeddings 端点。火山方舟 doubao-embedding-vision
 *   实测：input 接受字符串与字符串数组（批量），返回 2048 维向量；EMBED_BASE_URL/
 *   EMBED_API_KEY/EMBED_MODEL 配上即启用。usage 走独立 sink 入成本台账（tier=embedding）。
 * - HashingEmbedder：本地字符 n-gram 特征哈希（fnv1a → 定长桶 → L2 归一化），
 *   零网络零依赖。它是**词面模糊**不是深度语义——但余弦、RRF、召回排序这些
 *   检索数学全是真的；作为神经 embedder 未配置时的降级通道（形近词/错别字可兜，
 *   同义改写兜不住）。
 *
 * 两个实现同接口：embed(texts: string[]) => Promise<number[][]>（L2 归一化稠密向量），
 * 并带 `model` 属性作为向量库的存储命名空间（换模型不串库）。
 */

const { tokenize } = require('./retrieve.js')

// ===== usage 上报（与 llm-providers 的 usage sink 同一横切模式） =====
let usageSink = null
function setEmbedUsageSink(fn) {
  usageSink = typeof fn === 'function' ? fn : null
}
function emitUsage(info) {
  if (!usageSink || !info?.usage) return
  try {
    usageSink(info)
  } catch (error) {
    console.warn('[Embedder] usage sink failed:', error.message)
  }
}

const RETRYABLE = { maxRetries: 1, backoffMs: 800 }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 与 llm-providers 同口径的瞬时错误判断：429/5xx/网络层错误重试，4xx 参数错误不重试 */
function isRetryable(error) {
  if (error?.statusCode === 429) return true
  if (error?.statusCode >= 500) return true
  return error instanceof TypeError
}

/**
 * 神经向量化：OpenAI 兼容 /embeddings
 * @param {object} opts - { baseURL, apiKey, model, timeoutMs?, maxRetries? }
 */
function createHttpEmbedder({ baseURL, apiKey, model, timeoutMs = 15000, maxRetries }) {
  const retries = maxRetries ?? RETRYABLE.maxRetries
  return {
    model,
    async embed(texts) {
      const list = Array.isArray(texts) ? texts : [texts]
      if (list.length === 0) return []
      let lastError
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const t0 = Date.now()
          const response = await fetch(`${baseURL}/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ model, input: list }),
            signal: AbortSignal.timeout(timeoutMs),
          })
          if (!response.ok) {
            const body = await response.text().catch(() => '(no body)')
            throw Object.assign(new Error(`embeddings API error: ${response.status} - ${body}`), {
              statusCode: response.status,
            })
          }
          const data = await response.json()
          emitUsage({
            model,
            tier: 'embedding',
            usage: { prompt_tokens: data.usage?.prompt_tokens ?? null },
            durationMs: Date.now() - t0,
          })
          const vectors = (data.data || []).map((d) => d.embedding)
          if (vectors.length !== list.length) {
            throw new Error(`embeddings 返回条数不匹配：期望 ${list.length}，实际 ${vectors.length}`)
          }
          return vectors
        } catch (error) {
          lastError = error
          if (!isRetryable(error) || attempt === retries) throw error
          const delay = RETRYABLE.backoffMs * 2 ** attempt
          console.warn(
            `[Embedder] Transient error (${error.statusCode || error.message}), retry ${attempt + 1} in ${delay}ms`
          )
          await sleep(delay)
        }
      }
      throw lastError
    },
  }
}

/** fnv1a 32 位哈希（无依赖、跨进程稳定） */
function fnv1a(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function l2normalize(vec) {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0))
  return norm > 0 ? vec.map((v) => v / norm) : vec
}

/**
 * 本地特征哈希向量化：分词（复用 BM25 的 ASCII 单词 + CJK 双字组）→ fnv1a 投桶 →
 * 词频累加 → L2 归一化。确定性输出，同文本恒得同向量（测试/离线场景可用）。
 * @param {object} opts - { dim?: 桶数（默认 256） }
 */
function createHashingEmbedder({ dim = 256 } = {}) {
  return {
    model: `hashing-ngram-${dim}`,
    async embed(texts) {
      const list = Array.isArray(texts) ? texts : [texts]
      return list.map((text) => {
        const vec = new Array(dim).fill(0)
        for (const token of tokenize(text)) {
          vec[fnv1a(token) % dim] += 1
        }
        return l2normalize(vec)
      })
    },
  }
}

module.exports = { createHttpEmbedder, createHashingEmbedder, setEmbedUsageSink }
