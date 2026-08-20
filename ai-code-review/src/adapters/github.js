/**
 * GitHub Adapter：在 GitHub PR 上行内回贴 AI 评论
 *  - 拉 PR 头部拿 head SHA：GET /repos/:owner/:repo/pulls/:number
 *  - 拉 PR 各文件 patch：GET /repos/:owner/:repo/pulls/:number/files（喂给本项目的 parser）
 *  - 回贴行级评论：POST /repos/:owner/:repo/pulls/:number/comments
 *       body / commit_id(head.sha) / path / line / side:'RIGHT'
 * 关键坑：GitHub 要求 line 必须落在该文件 diff 的 hunk 里，否则返回 422。
 *  我们的 changedLines 取自 patch，天然满足；只在新增行(RIGHT)上回贴最稳。
 */
import { parseDiff } from '../parser.js'

const API = 'https://api.github.com'

export class GitHubAdapter {
  constructor({ token, repo, pr }) {
    this.token = token
    this.repo = repo // "owner/repo"
    this.pr = pr
  }

  get label() {
    return 'github'
  }

  async _api(path, method = 'GET', body) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`)
    return res.json()
  }

  async load() {
    const { head } = await this._api(`/repos/${this.repo}/pulls/${this.pr}`)
    const headSha = head.sha

    const files = await this._api(`/repos/${this.repo}/pulls/${this.pr}/files`)
    const result = []
    for (const f of files) {
      if (!f.patch) continue // 二进制/超大文件无 patch，跳过
      // GitHub 的 patch 不带文件头（直接以 @@ 开头），需补标准头让 parser 能定位路径/Hunk
      const fullDiff = `diff --git a/${f.filename} b/${f.filename}\n--- a/${f.filename}\n+++ b/${f.filename}\n${f.patch}`
      const parsed = parseDiff(fullDiff)[0]
      if (!parsed) continue
      const changedLines = new Set()
      const addLines = new Set()
      for (const h of parsed.hunks) {
        for (const l of h.lines) {
          if (l.newLine != null) changedLines.add(l.newLine)
          if (l.type === 'add') addLines.add(l.newLine)
        }
      }
      result.push({
        path: f.filename,
        changedLines,
        addLines,
        hunks: parsed.hunks,
        lines: await this.fetchFileContent(f.filename, headSha),
        headSha,
      })
    }
    return result
  }

  /** 拉 head 版本的完整文件内容做 LLM 上下文（失败则退化） */
  async fetchFileContent(path, ref) {
    try {
      const encoded = path.split('/').map(encodeURIComponent).join('/')
      const data = await this._api(`/repos/${this.repo}/contents/${encoded}?ref=${encodeURIComponent(ref)}`)
      if (data.encoding === 'base64') return Buffer.from(data.content, 'base64').toString('utf8').split('\n')
      return String(data).split('\n')
    } catch {
      return null
    }
  }

  /** 把评论回贴到 PR 行内（带延时和重试，规避 GitHub 422 限流） */
  async postComments(comments) {
    const count = { posted: 0, failed: 0 }
    // 按文件分组，同一文件的评论连续提交最易触发 "was submitted too quickly"
    // 策略：每文件之间加 800ms 延时，每条评论之间加 100ms 延时
    const byFile = new Map()
    for (const c of comments) {
      const key = c.file.path
      if (!byFile.has(key)) byFile.set(key, [])
      byFile.get(key).push(c)
    }

    const fileDelays = []
    for (const [, fileComments] of byFile) {
      for (let i = 0; i < fileComments.length; i++) {
        const c = fileComments[i]
        const body = {
          body: `${severityTag(c.severity)} ${c.message}\n\n> 由 ai-code-review 的「${c.skill}」Skill 自动生成`,
          commit_id: c.file.headSha,
          path: c.file.path,
          line: c.line,
          side: 'RIGHT',
        }
        let ok = false
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await this._api(`/repos/${this.repo}/pulls/${this.pr}/comments`, 'POST', body)
            count.posted++
            ok = true
            break
          } catch (e) {
            if (e.message.includes('was submitted too quickly') && attempt < 2) {
              await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
            } else {
              count.failed++
              console.error(`评论失败 line=${c.line} ${c.file.path}: ${e.message}`)
              break
            }
          }
        }
        // 同一文件内评论间延时
        if (i < fileComments.length - 1) await new Promise((r) => setTimeout(r, 100))
      }
      // 文件间延时
      fileDelays.push(new Promise((r) => setTimeout(r, 800)))
      if (byFile.size > 1) await Promise.all(fileDelays.splice(-1))
    }
    return count
  }
}

function severityTag(s) {
  if (s === 'error') return '🔴 [严重]'
  if (s === 'warning') return '🟡 [提示]'
  return '⚪ [细节]'
}