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
    // 档位可整体混布到其他厂商：baseURL/apiKey/temperature 都能按档位覆盖（resolveTierConfig 合并）
    tiers: {
      light: {
        model: process.env.LLM_LIGHT_MODEL,
        baseURL: process.env.LLM_LIGHT_BASE_URL,
        apiKey: process.env.LLM_LIGHT_API_KEY,
        // 部分模型（如 Kimi K2 code 系列）只允许 temperature=1；env 未设置则回落主配置
        temperature: process.env.LLM_LIGHT_TEMPERATURE
          ? Number(process.env.LLM_LIGHT_TEMPERATURE)
          : undefined,
      },
      reasoning: { model: process.env.LLM_REASONING_MODEL },
    },
    // 单价表（元/百万 token，input/output）——成本账本（eval/cost-report.js）用，按实际账单调整
    pricing: {
      'deepseek-chat': { input: 2, output: 8 },
      'doubao-seed-2-0-pro-260215': { input: 4, output: 16 },
      // Kimi：思考型模型，reasoning token 计入 completion 计费——TODO 单价按 Moonshot 控制台核对修正
      'kimi-k2.7-code': { input: 4, output: 16 },
      // P8 embedding：方舟 doubao-embedding-vision，按 input 计费——TODO 单价按方舟控制台核对修正
      'doubao-embedding-vision': { input: 0.7, output: 0 },
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
    // P4 分级权限：单轮任务获批写动作预算（硬上限写死代码，不信任模型自觉）
    maxWriteActions: Number(process.env.MAX_WRITE_ACTIONS || 8),
    // P4 dry-run：on 时写动作只规划不执行（演示/评测模式），审批链路照常留痕
    writeDryRun: process.env.WRITE_DRY_RUN === 'on',
    // P4 写操作审批等待时长（毫秒），超时默认拒绝——授权语义下等不到授权=没有授权
    writeApprovalTimeout: Number(process.env.WRITE_APPROVAL_TIMEOUT || 120000),
  },

  // P6 深度研究管线路由（三态）：
  // - legacy（默认）：全走旧管线（先搜后抓 + 逐页 grade），子 agent 不参与
  // - subagent：全走子 agent（兼容旧 RESEARCH_SUBAGENT_MODE=on，保留为对照臂）
  // - auto：按 plan 标注的 depth 分流（deep→worker 多跳，shallow→旧管线），
  //   shallow 主题死胡同时升级一次 worker 兜底——标错只影响成本不影响正确性
  research: {
    routing:
      process.env.RESEARCH_ROUTING ||
      (process.env.RESEARCH_SUBAGENT_MODE === 'on' ? 'subagent' : 'legacy'),
    workerMaxSteps: Number(process.env.RESEARCH_WORKER_MAX_STEPS || 6),
  },

  // P9 MCP 客户端接入：MCP_SERVERS 为 JSON 数组 [{"name","command","args","env?","shell?"}]，
  // 例（Windows 本地文件系统 server）：[{"name":"fs","command":"npx","shell":true,
  //   "args":["-y","@modelcontextprotocol/server-filesystem","D:/notes"]}]
  // 接入即纳管：注册期注入扫描（tool poisoning 防线）→ dangerLevel 自动定级（默认最危险）
  // → 走现有审批/超时/事件溯源管线。未配置 = 不启动，零开销。
  mcp: {
    servers: (() => {
      try {
        return JSON.parse(process.env.MCP_SERVERS || '[]')
      } catch {
        console.warn('[Config] MCP_SERVERS 不是合法 JSON，忽略')
        return []
      }
    })(),
  },

  // P8 记忆混合检索：
  // - retrieval：bm25（纯关键词，行为与 P3 完全一致）/ vector（纯语义，对照臂）/
  //   hybrid（BM25 + 向量 RRF 融合）/ auto（默认：配了 EMBED_* 即 hybrid，否则 bm25，
  //   未配置时行为零变化——回归安全）
  // - rrfK：RRF 融合常数（文献常用 60，越大各通道越平均）；vectorPool：每路候选池深度
  // - embed：神经向量化（OpenAI 兼容 /embeddings；方舟 doubao-embedding-vision 实测 2048 维）
  memory: {
    retrieval: process.env.MEMORY_RETRIEVAL || 'auto',
    rrfK: 60,
    vectorPool: 20,
    // P8.1 置信度门控：BM25 名次进入 RRF 融合的语义背书阈值——
    // 卡片余弦 ≥ β × 本查询最高余弦 才保留词法名次，否则名次作废（向量通道不受影响）。
    // β=0.9 来自对抗评测的实测间隙：污染卡比值 ≤0.898，双通道一致卡 =1.0（推导见技术文档 P8.1）。
    // 0 = 关闭门控（对照臂）；语义通道整体无信号（cosMax=0）时自动旁路，词法兜底不受影响。
    bm25GateRatio: Number(process.env.MEMORY_BM25_GATE ?? 0.9),
    embed: {
      baseURL: process.env.EMBED_BASE_URL,
      apiKey: process.env.EMBED_API_KEY,
      model: process.env.EMBED_MODEL,
    },
  },
}

module.exports = config
