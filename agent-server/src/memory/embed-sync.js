require('dotenv').config() // 必须先于 config/hybrid 的 require：config 在 require 时固化 EMBED_*

const store = require('./store.js')
const vectorStore = require('./vector-store.js')
const hybrid = require('./hybrid.js')

/**
 * 存量卡片向量回填（P8 混合检索的幂等工具）
 *
 * 已有向量的卡片自动跳过（key = model:cardId），可重复执行。
 * 用法：pnpm -F agent-server embed:sync  （需 EMBED_BASE_URL/_KEY/_MODEL 已配置）
 */

async function syncEmbeddings({ batchSize = 8 } = {}) {
  const emb = hybrid.resolveNeural()
  if (!emb) {
    throw new Error('未配置神经 embedder（EMBED_BASE_URL / EMBED_API_KEY / EMBED_MODEL）')
  }
  const cards = store.readAll()
  const pending = cards.filter((c) => !vectorStore.get(vectorStore.cardKey(c), emb.model))
  let embedded = 0
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize)
    const texts = batch.map((c) => `${c.title}\n${c.summary}`)
    const vectors = await emb.embed(texts)
    batch.forEach((card, j) =>
      vectorStore.upsert(vectorStore.cardKey(card), emb.model, vectors[j].length, vectors[j])
    )
    embedded += batch.length
    console.log(`[EmbedSync] ${embedded}/${pending.length}`)
  }
  return { total: cards.length, embedded, skipped: cards.length - pending.length, model: emb.model }
}

if (require.main === module) {
  syncEmbeddings()
    .then((r) => {
      console.log(`[EmbedSync] 完成：共 ${r.total} 张，回填 ${r.embedded}，已存在 ${r.skipped}（model=${r.model}）`)
      process.exit(0)
    })
    .catch((e) => {
      console.error('[EmbedSync] 失败:', e.message)
      process.exit(1)
    })
}

module.exports = { syncEmbeddings }
