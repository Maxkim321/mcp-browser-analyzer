<template>
  <div class="usage-bar" :title="tooltip">
    <span class="usage-label">本会话</span>
    <span class="usage-value"
      >{{ fmtTokens(session.promptTokens + session.completionTokens) }} tok</span
    >
    <span class="usage-value">≈ {{ fmtCost(session.cost) }}</span>
    <template v-if="session.calls > 0">
      <span class="usage-sep">·</span>
      <span class="usage-value" :class="{ highlight: lightCalls > 0 }"
        >⚡ light {{ lightPct }}%</span
      >
    </template>
    <span class="usage-total"
      >{{ fmtTokens(total.promptTokens + total.completionTokens) }} tok · ≈
      {{ fmtCost(total.cost) }}</span
    >
  </div>
</template>

<script>
/**
 * 会话用量条（输入区上方的常驻一行）：token/成本/light 占比实时可见
 *
 * 数据来自服务端 usage_summary 推送（usage-tracker 聚合，账本 usage-log.jsonl 是真相源）。
 * 成本是按单价表估算值，标"≈"；分级路由的 ROI 从此用户可见，不再只是台账里的数字。
 */
export default {
  name: 'UsageBar',
  props: {
    /** 本连接会话用量：{ calls, promptTokens, completionTokens, cost, byTier, lightShare } */
    session: { type: Object, required: true },
    /** 服务进程自启动以来的累计 */
    total: { type: Object, default: null },
  },
  computed: {
    lightCalls() {
      return this.session.byTier?.light?.calls || 0
    },
    lightPct() {
      if (this.session.calls <= 0) return 0
      return Math.round((this.lightCalls / this.session.calls) * 100)
    },
    tooltip() {
      const tiers = Object.entries(this.session.byTier || {})
        .map(([tier, b]) => `${tier}: ${b.calls} 次 / ${b.promptTokens + b.completionTokens} tok`)
        .join('，')
      const totalText = this.total
        ? `；服务累计 ${this.total.calls} 次调用，成本 ≈ ¥${Number(this.total.cost || 0).toFixed(4)}`
        : ''
      return `分级路由用量（本会话）${tiers ? '——' + tiers : ''}${totalText}。成本为按单价表估算值。`
    },
  },
  methods: {
    fmtTokens(n) {
      const v = Number(n || 0)
      return v >= 10000 ? `${(v / 1000).toFixed(1)}k` : String(v)
    },
    fmtCost(n) {
      return '¥' + Number(n || 0).toFixed(4)
    },
  },
}
</script>

<style scoped>
.usage-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  margin: 0 2px 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2);
  font-size: 11px;
  color: var(--text-3);
  line-height: 1.4;
  user-select: none;
}
.usage-label {
  color: var(--text-2);
  font-weight: 600;
}
.usage-value {
  font-variant-numeric: tabular-nums;
}
.usage-value.highlight {
  color: var(--accent-bright);
}
.usage-sep {
  color: var(--text-muted);
}
.usage-total {
  margin-left: auto;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
</style>
