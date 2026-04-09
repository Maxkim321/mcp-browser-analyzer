/**
 * 服务端配置文件
 * 集中管理所有可配置参数
 */

const config = {
  server: {
    port: 9999,
  },

  llm: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    temperature: 0.7,
  },

  agent: {
    maxIterations: 5,
    parallelToolCalls: 2,
    timeout: 60000,
  },
}

module.exports = config
