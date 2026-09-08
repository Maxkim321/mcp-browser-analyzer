/**
 * 极简 Markdown 渲染器（零依赖）
 * 支持：围栏代码块（```lang）、行内代码、标题（#~####）、无序/有序列表、表格、
 *       引用（>）、分割线（---）、链接、加粗、斜体、删除线、段落
 * 安全：所有文本先做 HTML 转义再拼标签；链接仅放行 http/https/mailto/锚点，
 *       生成的 HTML 标签白名单可控，可安全用于 v-html
 * 流式：未闭合的代码块（打字机中途）也会渲染成 pre，避免内容以纯文本闪烁
 */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 链接协议白名单，拦截 javascript: / data: 等 */
function safeUrl(url) {
  return /^(https?:\/\/|mailto:|#|\/)/i.test(url.trim()) ? url.trim() : '#'
}

/**
 * 行内元素渲染（入参必须是已转义的文本）
 * 行内代码先抽出占位，避免代码里的 * _ [ ] 被当成 Markdown 语法
 */
function renderInline(text) {
  const codes = []
  let out = text.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code)
    return `\u0000C${codes.length - 1}\u0000`
  })

  out = out.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_, label, url) =>
      `<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`,
  )
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  out = out.replace(/~~(.+?)~~/g, '<del>$1</del>')

  return out.replace(/\u0000C(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`)
}

/** 是否表格分隔行：| --- | :---: | */
function isTableDivider(line) {
  return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line.trim())
}

/** 拆一行表格单元格，去掉首尾空管道 */
function splitRow(line) {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim())
}

export function renderMarkdown(markdown) {
  if (!markdown) return ''
  const lines = String(markdown).split('\n')
  const html = []
  let listType = null // null | 'ul' | 'ol'
  let i = 0

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`)
      listType = null
    }
  }

  while (i < lines.length) {
    const rawLine = lines[i]
    const rawTrimmed = rawLine.trim()

    // 围栏代码块：收集到下一个 ``` 为止；流式未闭合时收集到结尾
    const fence = rawTrimmed.match(/^```+\s*([\w+-]*)\s*$/)
    if (fence) {
      closeList()
      const lang = fence[1]
      const buffer = []
      i++
      while (i < lines.length && !/^```+\s*$/.test(lines[i].trim())) {
        buffer.push(lines[i])
        i++
      }
      i++ // 跳过结束围栏（未闭合时越界，while 自然结束）
      const langLabel = lang ? escapeHtml(lang) : 'code'
      const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : ''
      // 复制按钮不携带代码内容，点击时由宿主从同块 pre 的 textContent 取原文，避免大段代码重复写入 DOM
      html.push(
        `<div class="code-block"><div class="code-block-bar"><span class="code-lang">${langLabel}</span>` +
          `<button class="code-copy-btn" type="button" data-copy-code="1">复制</button></div>` +
          `<pre><code${langAttr}>${escapeHtml(buffer.join('\n'))}</code></pre></div>`,
      )
      continue
    }

    // 表格：当前行含 | 且下一行是分隔行
    if (rawTrimmed.includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      closeList()
      const headers = splitRow(rawTrimmed)
      i += 2
      const bodyRows = []
      while (i < lines.length && lines[i].trim().includes('|')) {
        bodyRows.push(splitRow(lines[i]))
        i++
      }
      const th = headers.map((h) => `<th>${renderInline(escapeHtml(h))}</th>`).join('')
      const tb = bodyRows
        .map(
          (row) =>
            `<tr>${row.map((cell) => `<td>${renderInline(escapeHtml(cell))}</td>`).join('')}</tr>`,
        )
        .join('')
      html.push(`<table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>`)
      continue
    }

    i++
    const line = escapeHtml(rawLine)
    const trimmed = line.trim()

    if (!trimmed) {
      closeList()
      continue
    }

    // 分割线（放在列表判断之前，否则 --- 会被当成无序列表项）
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(rawTrimmed)) {
      closeList()
      html.push('<hr />')
      continue
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      closeList()
      const level = heading[1].length
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`)
      continue
    }

    // 引用：> 开头（转义后为 &gt;）
    const quote = trimmed.match(/^&gt;\s?(.*)$/)
    if (quote) {
      closeList()
      html.push(`<blockquote>${renderInline(quote[1])}</blockquote>`)
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
