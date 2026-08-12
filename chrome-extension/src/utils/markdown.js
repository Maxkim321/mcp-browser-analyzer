/**
 * 极简 Markdown 渲染器（零依赖）
 * 支持：标题（#~####）、无序列表（-）、有序列表（1.）、加粗（**text**）、段落
 * 安全：先做 HTML 转义再解析，生成的 HTML 仅含 h/p/ul/ol/li/strong，可安全用于 v-html
 */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderInline(text) {
  return text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
}

export function renderMarkdown(markdown) {
  if (!markdown) return ''
  const lines = String(markdown).split('\n')
  const html = []
  let listType = null // null | 'ul' | 'ol'

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`)
      listType = null
    }
  }

  for (const rawLine of lines) {
    const line = escapeHtml(rawLine)
    const trimmed = line.trim()

    if (!trimmed) {
      closeList()
      continue
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      closeList()
      const level = heading[1].length
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`)
      continue
    }

    const ulItem = trimmed.match(/^[-*]\s+(.+)$/)
    if (ulItem) {
      if (listType !== 'ul') {
        closeList()
        html.push('<ul>')
        listType = 'ul'
      }
      html.push(`<li>${renderInline(ulItem[1])}</li>`)
      continue
    }

    const olItem = trimmed.match(/^\d+[.)]\s+(.+)$/)
    if (olItem) {
      if (listType !== 'ol') {
        closeList()
        html.push('<ol>')
        listType = 'ol'
      }
      html.push(`<li>${renderInline(olItem[1])}</li>`)
      continue
    }

    closeList()
    html.push(`<p>${renderInline(trimmed)}</p>`)
  }

  closeList()
  return html.join('\n')
}

export default renderMarkdown
