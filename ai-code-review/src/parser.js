/**
 * 统一 diff 解析器：把 git diff 输出解析成「按文件 + hunk + 带新行号的行」结构，
 * 供后续定位行级评论使用。
 */

/**
 * 解析完整 diff 文本
 * @param {string} diffText
 * @returns {Array<{path:string, hunks:Array<Hunk>}>}
 * Hunk: { oldStart, oldCount, newStart, newCount, lines: Array<{type:'add'|'del'|'ctx', text:string, newLine:number|null}> }
 */
export function parseDiff(diffText) {
  const files = []
  let current = null
  let hunk = null
  let newLine = 0

  for (const raw of diffText.split('\n')) {
    const line = raw

    // 文件头：--- / +++（跳过索引信息，仅靠 +++ 定位新文件路径）
    if (line.startsWith('diff --git ')) {
      if (current) files.push(current)
      // 提取新路径
      const m = line.match(/diff --git a\/(.*?) b\/(.*?)$/) || line.match(/diff --git (.*?) (.*?)$/)
      current = { path: m?.[2] ?? '', hunks: [] }
      hunk = null
      continue
    }
    // 新文件路径锚点更可靠
    if (line.startsWith('+++ b/')) {
      if (!current) current = { path: line.slice(6), hunks: [] }
      else if (line.slice(6) && current.path !== line.slice(6)) current.path = line.slice(6)
      hunk = null
      continue
    }
    if (line.startsWith('@@')) {
      const m = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
      if (!m || !current) continue
      newLine = Number(m[3])
      hunk = {
        oldStart: Number(m[1]),
        oldCount: Number(m[2] || 1),
        newStart: Number(m[3]),
        newCount: Number(m[4] || 1),
        lines: [],
      }
      current.hunks.push(hunk)
      continue
    }
    if (!current || !hunk) continue

    if (line.startsWith('+') && !line.startsWith('+++')) {
      hunk.lines.push({ type: 'add', text: line.slice(1), newLine })
      newLine += 1
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      hunk.lines.push({ type: 'del', text: line.slice(1), newLine: null })
    } else if (line.startsWith(' ')) {
      hunk.lines.push({ type: 'ctx', text: line.slice(1), newLine })
      newLine += 1
    }
    // '\ No newline' 之类直接忽略
  }
  if (current) files.push(current)
  return files
}

/** 是否要跳过该文件（合并配置里的 ignorePaths） */
export function shouldSkip(path, patterns) {
  if (!patterns?.length) return false
  return patterns.some((p) => path === p || path.startsWith(p + '/') || (p.startsWith('*.') && path.endsWith(p.slice(1))))
}

/** 归一化 severity，向下兼容 LLM 用词（blocker/error -> error，nit/style -> nit） */
export function normalizeSeverity(sev) {
  const s = String(sev || '').trim().toLowerCase()
  if (['error', 'blocker', 'critical', 'high', 'bug', 'vulnerability'].includes(s)) return 'error'
  if (['warning', 'warn', 'medium', 'risk', 'improvement'].includes(s)) return 'warning'
  return 'nit'
}