/**
 * Token 成本账本报告（P2）
 * 读取 data/usage-log.jsonl，按 tier/model 汇总调用次数、token 用量与估算成本。
 * 用法：pnpm -F agent-server report
 * 单价表在 config.llm.pricing（元/百万 token，input/output），可用环境变量覆盖。
 */
const fs = require('fs')
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })
const usageLog = require('../src/core/usage-log.js')
const config = require('../src/config/index.js')

const OUT_DIR = path.join(__dirname, 'results')

function costOf(entry) {
  const pricing = (config.llm.pricing || {})[entry.model] || {}
  const inPrice = Number(pricing.input ?? 0)
  const outPrice = Number(pricing.output ?? 0)
  const pt = entry.prompt_tokens || 0
  const ct = entry.completion_tokens || 0
  return (pt / 1e6) * inPrice + (ct / 1e6) * outPrice
}

function aggregate(entries, keyFn) {
  const map = new Map()
  for (const e of entries) {
    const key = keyFn(e)
    if (!key) continue
    const cur = map.get(key) || {
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      cost: 0,
      durationMs: 0,
    }
    cur.calls++
    cur.promptTokens += e.prompt_tokens || 0
    cur.completionTokens += e.completion_tokens || 0
    cur.cost += costOf(e)
    cur.durationMs += e.duration_ms || 0
    map.set(key, cur)
  }
  return [...map.entries()].map(([key, v]) => ({
    key,
    calls: v.calls,
    promptTokens: v.promptTokens,
    completionTokens: v.completionTokens,
    cost: Number(v.cost.toFixed(4)),
    avgMs: Math.round(v.durationMs / v.calls),
  }))
}

function main() {
  const entries = usageLog.readAll()
  if (entries.length === 0) {
    console.log('账本为空：还没有 LLM 调用记录（服务启动后正常使用即会记录）')
    return
  }

  const byTier = aggregate(entries, (e) => e.tier || 'main')
  const byModel = aggregate(entries, (e) => e.model)
  const total = byTier.reduce(
    (acc, t) => ({
      calls: acc.calls + t.calls,
      promptTokens: acc.promptTokens + t.promptTokens,
      completionTokens: acc.completionTokens + t.completionTokens,
      cost: Number((acc.cost + t.cost).toFixed(4)),
    }),
    { calls: 0, promptTokens: 0, completionTokens: 0, cost: 0 }
  )
  const totalCalls = total.calls || 1

  const fmt = (n) => Number(n).toLocaleString('en-US')
  const lines = [
    `# Token 成本账本`,
    ``,
    `- 时间：${new Date().toISOString()}`,
    `- 记录数：${entries.length} · 总调用 ${total.calls} · 总 cost ¥${total.cost}`,
    ``,
    `## 按档位（分级路由 ROI）`,
    ``,
    `| 档位 | 调用 | 占比 | prompt tok | completion tok | 成本¥ | 均耗时 |`,
    `|---|---|---|---|---|---|---|`,
    ...byTier.map(
      (t) =>
        `| ${t.key} | ${t.calls} | ${((t.calls / totalCalls) * 100).toFixed(1)}% | ${fmt(t.promptTokens)} | ${fmt(t.completionTokens)} | ${t.cost} | ${t.avgMs}ms |`
    ),
    ``,
    `## 按模型`,
    ``,
    `| 模型 | 调用 | prompt tok | completion tok | 成本¥ |`,
    `|---|---|---|---|---|`,
    ...byModel.map(
      (m) =>
        `| ${m.key} | ${m.calls} | ${fmt(m.promptTokens)} | ${fmt(m.completionTokens)} | ${m.cost} |`
    ),
    ``,
    `> 单价表：${JSON.stringify(config.llm.pricing)}（元/百万 token，可在 config.llm.pricing 配置）`,
  ]
  const report = lines.join('\n')

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, 'cost-report.md'), report)
  console.log(report)
  console.log(`\n→ ${path.join(OUT_DIR, 'cost-report.md')}`)
}

main()
