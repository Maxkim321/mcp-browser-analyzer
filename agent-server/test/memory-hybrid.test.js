const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const fs = require('fs')
const os = require('os')

// 隔离：必须在 require 之前设置（store/vector-store 在 require 时固化路径）
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-'))
process.env.MEMORY_FILE = path.join(TMP_DIR, 'memory.jsonl')
process.env.MEMORY_VECTORS_FILE = path.join(TMP_DIR, 'vectors.jsonl')
// 刻意不设 EMBED_*：auto 模式必须解析为纯 BM25（回归安全的行为前提）

const store = require('../src/memory/store.js')
const vectorStore = require('../src/memory/vector-store.js')
const { rrfFuse } = require('../src/memory/rrf.js')
const { createHashingEmbedder } = require('../src/memory/embedder.js')
const hybrid = require('../src/memory/hybrid.js')
const wire = require('../src/memory/wire.js')

test.after(() => fs.rmSync(TMP_DIR, { recursive: true, force: true }))

// ===== 纯函数层 =====

test('rrf: 双路排名融合——双路命中 > 单路头部 > 单路靠后', () => {
  const scores = rrfFuse(
    [
      ['a', 'b', 'c'],
      ['b', 'd'],
    ],
    { k: 60 }
  )
  assert.ok(Math.abs(scores.get('b') - (1 / 62 + 1 / 61)) < 1e-12, 'b 两路分别 rank1/rank1')
  assert.ok(scores.get('b') > scores.get('a'), '双路命中应压过单路头部')
  assert.ok(scores.get('a') > scores.get('d'), '同通道内 rank1 > rank2')
  assert.ok(Math.abs(scores.get('a') - 1 / 61) < 1e-12)
})

test('cosine: 同向 1、正交 0、维度不符/空入参 0', () => {
  assert.ok(Math.abs(vectorStore.cosine([1, 0], [1, 0]) - 1) < 1e-9)
  assert.strictEqual(vectorStore.cosine([1, 0], [0, 1]), 0)
  assert.strictEqual(vectorStore.cosine([1], [1, 2]), 0)
  assert.strictEqual(vectorStore.cosine([], []), 0)
})

test('hashing embedder: 确定性、单位化、共享双字组更近、无共享为 0', async () => {
  const e = createHashingEmbedder()
  const [v1] = await e.embed(['前端性能优化'])
  const [v2] = await e.embed(['前端性能优化'])
  assert.deepStrictEqual(v1, v2, '同文本恒得同向量')
  const norm = Math.sqrt(v1.reduce((s, x) => s + x * x, 0))
  assert.ok(Math.abs(norm - 1) < 1e-9, 'L2 归一化')
  const [related] = await e.embed(['性能优化实践'])
  const [unrelated] = await e.embed(['红烧肉的做法'])
  assert.ok(vectorStore.cosine(v1, related) > 0, '共享双字组 → 余弦 > 0')
  assert.strictEqual(vectorStore.cosine(v1, unrelated), 0, '零词面重合 → 0（这也是它兜不住同义改写的原因）')
})

// ===== 向量库 =====

test('vector-store: upsert/get、同 key 覆盖取最新、model 命名空间隔离', () => {
  assert.ok(vectorStore.upsert('c1', 'm-a', 2, [1, 0]))
  assert.ok(vectorStore.upsert('c1', 'm-a', 2, [0, 1]))
  assert.ok(vectorStore.upsert('c1', 'm-b', 2, [0, 0.5]))
  assert.deepStrictEqual(vectorStore.get('c1', 'm-a').vec, [0, 1], '同 key 重复写入取最新')
  assert.deepStrictEqual(vectorStore.get('c1', 'm-b').vec, [0, 0.5])
  assert.strictEqual(vectorStore.get('c2', 'm-a'), null)
  assert.strictEqual(vectorStore.listByModel('m-a').length, 1)
})

// ===== hybrid 检索编排（mock embedder 注入，网络无关） =====

// 语料：target 与 query 零词面重合（BM25 必然失手），distractor 词面重合但语义无关
const TARGET = store.append({
  url: 'https://t/target',
  title: '分布式锁的三种实现',
  summary: '基于 Redis SETNX 的看门狗续期方案，RedLock 争议与 zookeeper 临时顺序节点对比。',
})
const DISTRACTOR = store.append({
  url: 'https://t/distract',
  title: '多服务并发问题排查思路',
  summary: '多个服务同时写库导致数据错乱，先查应用日志定位重复请求的来源，再上分布式协调兜底。',
})
store.append({
  url: 'https://t/noise',
  title: '红烧肉的做法',
  summary: '五花肉焯水后炒糖色，加料酒生抽小火慢炖四十分钟，最后开大火把汤汁收浓装盘。',
})
// store.append 有 40 字下限静默过滤——语料构造不过关就炸在明面上，不留隐形空转
assert.ok(TARGET && DISTRACTOR, '测试语料必须通过 store 入库下限（summary ≥ 40 字）')

const QUERY = '怎么防止多个服务同时改一条数据'
const MOCK = {
  model: 'mock-emb',
  async embed(texts) {
    return texts.map((t) => {
      if (t === QUERY) return [1, 0]
      throw new Error(`mock embedder 未注册文本: ${String(t).slice(0, 20)}`)
    })
  },
}

test('bm25 模式：零词面重合的期望卡片必然失手（对抗构造自证）', async () => {
  const hits = await hybrid.search(QUERY, { k: 3, mode: 'bm25' })
  assert.ok(!hits.some((h) => h.card.url === 'https://t/target'), 'target 不该被 BM25 召回')
  assert.strictEqual(hits[0].card.url, 'https://t/distract', '词面重合的干扰卡排第一')
  assert.strictEqual(hits[0].channels.vector, null, 'bm25 模式无向量通道')
})

test('vector 模式：语义通道把 BM25 失手的卡片救到第一', async () => {
  vectorStore.upsert(TARGET.id, 'mock-emb', 2, [0.95, 0.05])
  vectorStore.upsert(DISTRACTOR.id, 'mock-emb', 2, [0.3, 0.95])
  const hits = await hybrid.search(QUERY, { k: 3, mode: 'vector', embedder: MOCK })
  assert.strictEqual(hits[0].card.url, 'https://t/target')
  assert.strictEqual(hits[0].channels.bm25, null)
  assert.strictEqual(hits[0].channels.vector, 1)
})

test('hybrid 模式：RRF 融合把语义救援卡带进 top-3（channels 双通道可解释）', async () => {
  const hits = await hybrid.search(QUERY, { k: 3, mode: 'hybrid', embedder: MOCK })
  const target = hits.find((h) => h.card.url === 'https://t/target')
  assert.ok(target, 'target 应被融合结果召回')
  assert.strictEqual(target.channels.bm25, null, 'bm25 通道确实没救到它')
  assert.ok(target.channels.vector > 0, '是向量通道带进来的')
  assert.ok(hits.length <= 3)
})

test('hybrid 模式：双通道都命中的卡片稳居第一', async () => {
  const Q2 = '分布式锁 redis 看门狗'
  const emb2 = { model: 'mock-emb', async embed(texts) { return texts.map(() => [1, 0]) } }
  const hits = await hybrid.search(Q2, { k: 3, mode: 'hybrid', embedder: emb2 })
  assert.strictEqual(hits[0].card.url, 'https://t/target')
  assert.strictEqual(hits[0].channels.bm25, 1)
  assert.strictEqual(hits[0].channels.vector, 1)
})

test('auto 模式未配 EMBED_*：行为与纯 BM25 逐条一致（回归安全）', async () => {
  const auto = await hybrid.search(QUERY, { k: 3 })
  const bm25 = await hybrid.search(QUERY, { k: 3, mode: 'bm25' })
  assert.deepStrictEqual(
    auto.map((h) => h.card.url),
    bm25.map((h) => h.card.url)
  )
  assert.strictEqual(auto[0].channels.vector, null, '未配神经通道时无向量排名')
})

test('降级链：embedder 抛错 → hybrid 回退 BM25 并带 degraded 标记；vector 模式如实失败', async () => {
  const bad = { model: 'bad-emb', async embed() { throw new Error('断网模拟') } }
  const hybridHits = await hybrid.search(QUERY, { k: 3, mode: 'hybrid', embedder: bad })
  assert.ok(hybridHits.length > 0, 'BM25 兜底仍有结果')
  assert.ok(hybridHits.every((h) => h.degraded === true), '降级标记逐条可见')
  const vectorHits = await hybrid.search(QUERY, { k: 3, mode: 'vector', embedder: bad })
  assert.deepStrictEqual(vectorHits, [], '纯向量模式失败就如实失败，不静默回退')
})

test('excludeUrl 在向量通道同样生效', async () => {
  const hits = await hybrid.search(QUERY, {
    k: 3,
    mode: 'vector',
    embedder: MOCK,
    excludeUrl: 'https://t/target',
  })
  assert.ok(!hits.some((h) => h.card.url === 'https://t/target'))
})

test('embedCardAsync：纯 BM25 生效模式下不写向量（保护真实数据目录）', async () => {
  const card = store.readAll()[0]
  assert.strictEqual(await hybrid.embedCardAsync(card), false)
  assert.strictEqual(vectorStore.get(card.id, 'hashing-ngram-256'), null)
})

test('回归：无 id 语料（直写 JSONL 绕过 store.append）全链路可用——cardKey 以 url 兜底', async () => {
  // 评测语料是直写文件进来的、没有 id 字段；曾因 card.id=undefined 撞键互覆 + 被 rrfFuse 跳过
  fs.appendFileSync(
    store.FILE,
    JSON.stringify({
      url: 'https://n/virtual-scroll',
      title: '虚拟滚动的实现要点',
      summary: '长列表渲染卡顿的主因是 DOM 节点过多，只渲染可视区窗口，配合动态高度测量与滚动偏移补偿。',
    }) + '\n'
  )
  const emb2 = {
    model: 'mock-emb',
    async embed(texts) {
      return texts.map((t) => {
        if (t === '长列表渲染卡顿怎么办') return [1, 0]
        throw new Error(`mock 未注册: ${String(t).slice(0, 20)}`)
      })
    },
  }
  vectorStore.upsert('https://n/virtual-scroll', 'mock-emb', 2, [1, 0])
  const vec = await hybrid.search('长列表渲染卡顿怎么办', { k: 3, mode: 'vector', embedder: emb2 })
  assert.strictEqual(vec[0].card.url, 'https://n/virtual-scroll', '向量通道按 url 键命中')
  const hyb = await hybrid.search('长列表渲染卡顿怎么办', { k: 3, mode: 'hybrid', embedder: emb2 })
  assert.strictEqual(hyb[0].card.url, 'https://n/virtual-scroll', 'RRF 不再因 undefined 键丢整路')
  assert.strictEqual(hyb[0].channels.bm25, 1)
  assert.strictEqual(hyb[0].channels.vector, 1)
})

test('P8.1 置信度门控：词面命中但语义背书不足的卡片，BM25 名次被作废', async () => {
  const config = require('../src/config/index.js')
  // 现状（mock-emb 空间）：TARGET cos 0.95（max），DISTRACTOR cos 0.3 → 比值 0.316 < 0.9
  // DISTRACTOR 对 QUERY 有 BM25 名次（词面命中"服务/多个"），但语义通道不认 → 名次作废
  const before = await hybrid.search(QUERY, { k: 3, mode: 'hybrid', embedder: MOCK })
  const distract = before.find((h) => h.card.url === 'https://t/distract')
  assert.ok(distract, 'DISTRACTOR 应在融合结果中（向量通道仍在）')
  assert.strictEqual(distract.channels.bm25, null, '词法名次应被门控作废')
  assert.ok(distract.channels.vector > 0, '向量通道不受门控影响')

  // 对照：关掉门控（β=0）后词法名次恢复，DISTRACTOR 靠叠加分反超 TARGET
  config.memory.bm25GateRatio = 0
  try {
    const off = await hybrid.search(QUERY, { k: 3, mode: 'hybrid', embedder: MOCK })
    const distractOff = off.find((h) => h.card.url === 'https://t/distract')
    assert.strictEqual(distractOff.channels.bm25, 1, '关闭门控后词法名次恢复')
    assert.strictEqual(off[0].card.url, 'https://t/distract', '叠加分让噪声卡登顶（复现失效模式）')
  } finally {
    config.memory.bm25GateRatio = 0.9
  }
})

test('P8.1 门控旁路：语义通道整体无信号（cosMax=0）时词法兜底不受影响', async () => {
  // empty-emb 没有任何存储向量 → vecList 空 → cosMax=0 → 门控旁路，BM25 全量兜底
  const emptyEmb = { model: 'empty-emb', async embed(texts) { return texts.map(() => [1, 0]) } }
  const hits = await hybrid.search(QUERY, { k: 3, mode: 'hybrid', embedder: emptyEmb })
  assert.ok(hits.length > 0, '词法兜底仍有结果')
  assert.ok(hits.every((h) => h.channels.bm25 != null), 'BM25 名次全量保留')
})

test('wire.recallForPrompt：异步签名 + refs 携带 channels（auto→bm25 环境下行为不变）', async () => {
  const recalled = await wire.recallForPrompt('分布式锁怎么实现', { url: 'https://current.page' })
  assert.ok(recalled.block.includes('浏览记忆'))
  assert.ok(recalled.refs.length >= 1)
  assert.ok(recalled.refs[0].channels, 'refs 应带双通道排名')
  assert.ok(
    recalled.refs.every((r) => r.title && r.url && typeof r.score === 'number'),
    'refs 字段向后兼容'
  )
})
