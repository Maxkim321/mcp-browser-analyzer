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
  },

  agent: {
    maxIterations: 10,
    parallelToolCalls: 2,
    timeout: 60000,
    // 对话历史上限，避免长会话导致内存持续增长
    historyLimit: 40,
  },
}

module.exports = config
