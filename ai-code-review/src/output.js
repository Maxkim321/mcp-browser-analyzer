/**
 * 输出格式化：把评论按文件组织成 text / markdown / json
 */

function groupByFile(comments) {
  const map = new Map()
  for (const c of comments) {
    if (!map.has(c.file.path)) map.set(c.file.path, [])
    map.get(c.file.path).push(c)
  }
  return map
}

const TAG = { error: '[严重]', warning: '[提示]', nit: '[细节]' }

export function formatText(comments) {
  const files = groupByFile(comments)
  const lines = []
  let total = 0
  for (const [path, list] of files) {
    total += list.length
    lines.push(`\n📄 ${path}`)
    for (const c of list) {
      lines.push(`  L${String(c.line).padStart(4)} ${TAG[c.severity]}(${c.skill}) ${c.message}`)
    }
  }
  lines.unshift(`审查完成：共 ${comments.length} 条意见（${files.size} 个文件）`)
  return lines.join('\n')
}

export function formatMarkdown(comments) {
  const files = groupByFile(comments)
  const out = [`# AI 代码审查报告`, ``]
  for (const [path, list] of files) {
    out.push(`## ${path}`, ``)
    for (const c of list) {
      const sym = c.severity === 'error' ? '🔴' : c.severity === 'warning' ? '🟡' : '⚪'
      out.push(`- L${c.line} ${sym} **${c.skill}**：${c.message}`)
    }
    out.push(``)
  }
  return out.join('\n')
}

export function formatJson(comments) {
  return comments.map((c) => ({
    file: c.file.path,
    line: c.line,
    severity: c.severity,
    skill: c.skill,
    message: c.message,
    source: c.source,
  }))
}