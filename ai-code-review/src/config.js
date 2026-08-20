/**
 * 统一配置
 * 沿用项目既有 ARK_ 前缀环境变量（OpenAI 兼容 / DeepSeek）
 */
export function getConfig(env = process.env) {
  return {
    llm: {
      apiKey: env.ARK_API_KEY,
      baseURL: env.ARK_BASE_URL || 'https://api.deepseek.com',
      model: env.ARK_MODEL || 'deepseek-chat',
      temperature: 0.2,
      maxTokens: 2048,
    },
    gitlab: {
      host: env.GITLAB_HOST || 'https://gitlab.com',
      token: env.GITLAB_TOKEN,
    },
    github: {
      token: env.GITHUB_TOKEN,
    },
  }
}