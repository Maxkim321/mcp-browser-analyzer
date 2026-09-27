/**
 * 容错解析 LLM 输出的 JSON（自 workflow.js 提取为共享工具）
 *
 * - 可能被 ```json 代码块包裹
 * - 可能混有前后缀文字
 * 提取首个 {...} 或 [...] 并 JSON.parse，失败返回 null。
 * workflow.js / topic-agent.js 共用同一口径；workflow.js 保留 re-export 向后兼容。
 */
function parseJSON(text) {
  if (typeof text !== 'string') return null
  let t = text.trim()
  // 去掉 ```json ... ``` 代码块
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1].trim()
  // 提取首个对象/数组
  const first = t.search(/[[{]/)
  if (first === -1) return null
  const candidates = [t.slice(first)]
  for (const s of candidates) {
    try {
      return JSON.parse(s)
    } catch {
      // 尝试按括号配对截取
      const open = s[0]
      const close = open === '{' ? '}' : ']'
      let depth = 0
      for (let i = 0; i < s.length; i++) {
        if (s[i] === open) depth++
        else if (s[i] === close) {
          depth--
          if (depth === 0) {
            try {
              return JSON.parse(s.slice(0, i + 1))
            } catch {
              return null
            }
          }
        }
      }
    }
  }
  return null
}

module.exports = { parseJSON }
