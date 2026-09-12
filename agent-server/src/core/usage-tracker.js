const config = require('../config/index.js')

/**
 * 会话/进程两级 token 用量聚合（内存态）
 *
 * 持久真相源是 usage-log.jsonl（追加式台账）；本模块是它的实时聚合视图，
 * 供 ws-server 每次回答后向前端推送 usage_summary（用量条的数据源）。
 * 不落盘、重启归零——账本管审计，这里管"此刻"。
 *
 * 归因口径：ws-server 在处理某连接的消息前 bindConnection(id)，期间产生的
 * LLM 调用都归到该连接。多连接并发时 await 间隙可能互相串号——本服务是
 * 单用户本地部署，接受这个近似；全局累计（totals）不受影响。
 */

const totals = {
  calls: 0,
  promptTokens: 0,
  completionTokens: 0,
  cost: 0,
  byTier: {},
}

const byConnection = new Map()
let boundConnectionId = null

/** 单次调用的估算成本（元），单价表同 cost-report.js：config.llm.pricing */
function costOf(info) {
  const pricing = (config.llm.pricing || {})[info.model] || {}
  const pt = info.prompt_tokens || 0
  const ct = info.completion_tokens || 0
  return (pt / 1e6) * Number(pricing.input ?? 0) + (ct / 1e6) * Number(pricing.output ?? 0)
}

function accumulate(bucket, info, cost) {
  bucket.calls++
  bucket.promptTokens += info.prompt_tokens || 0
  bucket.completionTokens += info.completion_tokens || 0
  bucket.cost += cost
}

/**
 * 记录一次 LLM 调用（由 index.js 的 usage sink 转发）
 * @param {object} info - { model, tier, prompt_tokens, completion_tokens }
 */
function record(info) {
  const cost = costOf(info)
  const tier = info.tier || 'main'
  accumulate(totals, info, cost)
  totals.byTier[tier] = totals.byTier[tier] || {
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    cost: 0,
  }
  accumulate(totals.byTier[tier], info, cost)

  const key = boundConnectionId ?? 'unattributed'
  byConnection.set(
    key,
    byConnection.get(key) || { calls: 0, promptTokens: 0, completionTokens: 0, cost: 0, byTier: {} }
  )
  const bucket = byConnection.get(key)
  accumulate(bucket, info, cost)
  bucket.byTier[tier] = bucket.byTier[tier] || {
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    cost: 0,
  }
  accumulate(bucket.byTier[tier], info, cost)
}

/** 处理某连接消息前绑定归因（见模块注释的并发近似说明） */
function bindConnection(id) {
  boundConnectionId = id
}

function round(bucket) {
  return {
    calls: bucket.calls,
    promptTokens: bucket.promptTokens,
    completionTokens: bucket.completionTokens,
    cost: Number(bucket.cost.toFixed(4)),
    byTier: Object.fromEntries(
      Object.entries(bucket.byTier || {}).map(([tier, b]) => [
        tier,
        { ...b, cost: Number(b.cost.toFixed(4)) },
      ])
    ),
  }
}

/** 某连接（本会话）的用量汇总 */
function summaryFor(connectionId) {
  const bucket = byConnection.get(connectionId)
  return bucket
    ? round(bucket)
    : { calls: 0, promptTokens: 0, completionTokens: 0, cost: 0, byTier: {} }
}

/** 服务进程自启动以来的全局用量 */
function totalsSnapshot() {
  return round(totals)
}

/** light 档调用占比（分级路由可见性：badge/用量条用） */
function lightShare(bucket) {
  const light = bucket.byTier?.light?.calls || 0
  return bucket.calls > 0 ? Number(((light / bucket.calls) * 100).toFixed(1)) : 0
}

/** 测试用：清空内存态 */
function reset() {
  byConnection.clear()
  boundConnectionId = null
  totals.calls = 0
  totals.promptTokens = 0
  totals.completionTokens = 0
  totals.cost = 0
  totals.byTier = {}
}

module.exports = { record, bindConnection, summaryFor, totalsSnapshot, lightShare, reset }
