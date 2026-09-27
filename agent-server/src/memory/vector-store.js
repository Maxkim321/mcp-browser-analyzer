const fs = require('fs')
const path = require('path')

/**
 * 记忆向量库（P8 混合检索存储层）
 *
 * 与 memory.jsonl 同一存储原则：**追加式、永不改写**。每行：
 * { cardId, model, dim, vec, ts } —— (model, cardId) 逻辑唯一，重复写入时
 * 加载时"最后一条生效"（与 store.js 的"检索时取最新版本"同口径）。
 *
 * 刻意用 JSON 列存而不引入向量库：个人体量（几千条）在进程内算余弦毫秒级就够，
 * 和 BM25 的"不引入向量库"是同一个规模判断。换模型不串库：key 含 model 命名空间。
 */

const DATA_DIR = path.join(__dirname, '..', '..', 'data')
// 路径可由 MEMORY_VECTORS_FILE 覆盖（测试/评测隔离用），默认 data/memory-vectors.jsonl
const FILE = process.env.MEMORY_VECTORS_FILE || path.join(DATA_DIR, 'memory-vectors.jsonl')

let cache = null

function load() {
  if (cache) return cache
  cache = new Map()
  try {
    const lines = fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const rec = JSON.parse(line)
        if (!rec?.cardId || !rec?.model || !Array.isArray(rec.vec)) continue
        cache.set(`${rec.model}:${rec.cardId}`, { dim: rec.dim, vec: rec.vec, ts: rec.ts })
      } catch {
        // 坏行跳过（与 store.js 同口径：单行损坏不炸全库）
      }
    }
  } catch {
    // 文件不存在 = 空库
  }
  return cache
}

/** 卡片身份键：id 优先，url 兜底。评测语料可直写 JSONL 绕过 store.append（无 id），
 * 全链路（upsert/get/RRF）必须统一用这个键，否则 undefined 会撞键互覆/被融合层跳过。 */
function cardKey(card) {
  return card?.id || card?.url
}

/** 写入/覆盖一条向量（追加 JSONL + 内存更新） */
function upsert(cardId, model, dim, vec) {
  const rec = { cardId, model, dim, vec, ts: new Date().toISOString() }
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.appendFileSync(FILE, JSON.stringify(rec) + '\n')
    load().set(`${model}:${cardId}`, { dim, vec, ts: rec.ts })
    return true
  } catch (error) {
    console.warn('[VectorStore] upsert failed:', error.message)
    return false
  }
}

/** 取某模型命名空间下某卡片的向量 */
function get(cardId, model) {
  return load().get(`${model}:${cardId}`) || null
}

/** 某模型命名空间下全部向量：[{ cardId, vec }]（个人体量全量遍历即可） */
function listByModel(model) {
  const out = []
  for (const [key, value] of load()) {
    if (key.startsWith(`${model}:`)) out.push({ cardId: key.slice(model.length + 1), vec: value.vec })
  }
  return out
}

/** 余弦相似度（输入应为 L2 归一化向量，此时即点积；防御性处理零向量） */
function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}

/** 清空内存态（测试隔离用，不动文件） */
function resetForTest() {
  cache = null
}

module.exports = { upsert, get, listByModel, cosine, cardKey, FILE, resetForTest }
