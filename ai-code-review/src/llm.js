/**
 * LLM 调用：OpenAI 兼容 / DeepSeek
 * 用「系统提示要求输出 JSON + 宽松解析」做结构化输出（DeepSeek 无原生 JSON mode 兜底也稳）
 */
import { getConfig } from './config.js'

export class LLMClient {
  constructor(cfg = getConfig()) {
    this.cfg = cfg.llm
  }

  /** 单次审查某一行块的文本，返回 string（由调用方做 JSON 解析） */
  async review(systemPrompt, userMessage) {
    const res = await fetch(`${this.cfg.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: this.cfg.model,
        temperature: this.cfg.temperature,
        max_tokens: this.cfg.maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`LLM API ${res.status}: ${err}`)
    }
    const data = await res.json()
    return data.choices?.[0]?.message?.content ?? ''
  }
}

/** 从 LLM 原始输出里尽量稳健地取出 JSON 数组 */
export function parseJsonArray(text) {
  if (!text) return []
  // 优先剥离 markdown 代码块
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('[')
  const end = candidate.lastIndexOf(']')
  if (start === -1 || end === -1) return []
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return []
  }
}