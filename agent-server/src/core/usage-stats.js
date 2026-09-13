const config = require('../config/index.js')

/**
 * Token 用量聚合（纯函数层，P2 成本账本共用）
 *
 * cost-report.js（CLI 报告）与 dashboard.js（可视化 API）消费同一份
 * usage-log.jsonl，成本算法必须同源——否则报告和图表对不上账。
 * 单价表：config.llm.pricing（元/百万 token，input/output）。
 */

/** 单次调用估算成本（元） */
function costOf(entry, pricing = config.llm.pricing) {
  const p = (pricing || {})[entry.model] || {}
  const pt = entry.prompt_tokens || 0
  const ct = entry.completion_tokens || 0
  return (pt / 1e6) * Number(p.input ?? 0) + (ct / 1e6) * Number(p.output ?? 0)
}

/**
 * 按 keyFn 分组聚合
 * @returns {Array<{key, calls, promptTokens, completionTokens, cost, avgMs}>}
 */
function aggregate(entries, keyFn, pricing) {
  const map = new Map()
  for (const e of entries) {
    const key = keyFn(e)
    if (!key) continue
    const cur = map.get(key) || {
      key,
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      cost: 0,
      durationMs: 0,
    }
    cur.calls++
    cur.promptTokens += e.prompt_tokens || 0
    cur.completionTokens += e.completion_tokens || 0
    cur.cost += costOf(e, pricing)
    cur.durationMs += e.duration_ms || 0
    map.set(key, cur)
  }
  return [...map.values()].map((v) => ({
    key: v.key,
    calls: v.calls,
    promptTokens: v.promptTokens,
    completionTokens: v.completionTokens,
    cost: Number(v.cost.toFixed(4)),
    avgMs: Math.round(v.durationMs / Math.max(v.calls, 1)),
  }))
}

/**
 * 全量汇总：总计 + 按档位 + 按模型 + 按日
 * @param {Array} entries - usage-log.jsonl 的解析结果
 */
function summarize(entries, pricing) {
  const byTier = aggregate(entries, (e) => e.tier || 'main', pricing)
  const byModel = aggregate(entries, (e) => e.model, pricing)
  const byDay = aggregate(entries, (e) => String(e.ts || '').slice(0, 10), pricing).sort((a, b) =>
    a.key.localeCompare(b.key)
  )
  const totals = byTier.reduce(
    (acc, t) => ({
      calls: acc.calls + t.calls,
      promptTokens: acc.promptTokens + t.promptTokens,
      completionTokens: acc.completionTokens + t.completionTokens,
      cost: Number((acc.cost + t.cost).toFixed(4)),
    }),
    { calls: 0, promptTokens: 0, completionTokens: 0, cost: 0 }
  )
  return { totals, byTier, byModel, byDay }
}

module.exports = { costOf, aggregate, summarize }
