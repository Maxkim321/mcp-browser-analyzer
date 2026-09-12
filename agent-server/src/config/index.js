/**
 * 服务端配置文件
 * 集中管理所有可配置参数
 */

const config = {
  server: {
    // 支持通过环境变量覆盖端口，便于本地多实例或部署场景
    port: Number(process.env.AGENT_SERVER_PORT || 9999),
  },

  llm: {
    apiKey: process.env.ARK_API_KEY,
    baseURL: process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3',
    model: process.env.ARK_MODEL || 'doubao-seed-2-0-pro-260215',
    temperature: 0.7,
    // 分级路由档位：缺省字段回落主配置，档位完全未配置（env 未设置）时该次调用就是主模型
    // light：高频窄任务（grade 打分/查询改写/上下文压缩摘要），便宜快
    // reasoning：重规划任务（深度研究 plan 等），主模型本身就是强模型，故默认不单独配
    tiers: {
      light: { model: process.env.LLM_LIGHT_MODEL },
      reasoning: { model: process.env.LLM_REASONING_MODEL },
    },
    // 单价表（元/百万 token，input/output）——成本账本（eval/cost-report.js）用，按实际账单调整
    pricing: {
      'deepseek-chat': { input: 2, output: 8 },
      'doubao-seed-2-0-pro-260215': { input: 4, output: 16 },
    },
  },

  agent: {
    maxIterations: 10,
    parallelToolCalls: 2,
    timeout: 60000,
    // 对话历史上限，避免长会话导致内存持续增长
    historyLimit: 40,
    // dph-C 派生视图：raw 只追加不改写（history-store.js），raw 的内存上限（条数）
    rawLimit: 200,
    // 压缩策略：rolling-summary（滚动摘要，默认）/ truncate（对照基线）/ no-compress
    compressStrategy: process.env.COMPRESS_STRATEGY || 'rolling-summary',
    // dph-C token 预算：历史估算 token 超过该值触发滚动摘要压缩
    tokenBudget: 16000,
    // dph-D 单工具执行超时（毫秒），防止网络卡死拖垮整个 Turn
    toolTimeout: 60000,
  },
}

module.exports = config
