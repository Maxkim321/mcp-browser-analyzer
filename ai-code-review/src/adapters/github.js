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
      const parsed = parseDiff(f.patch)[0]
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

  /** 把评论回贴到 PR 行内 */
  async postComments(comments) {
    const count = { posted: 0, failed: 0 }
    for (const c of comments) {
      const body = {
        body: `${severityTag(c.severity)} ${c.message}\n\n> 由 ai-code-review 的「${c.skill}」Skill 自动生成`,
        commit_id: c.file.headSha,
        path: c.file.path,
        line: c.line,
        side: 'RIGHT',
      }
      try {
        await this._api(`/repos/${this.repo}/pulls/${this.pr}/comments`, 'POST', body)
        count.posted++
      } catch (e) {
        count.failed++
        console.error(`评论失败 line=${c.line} ${c.file.path}: ${e.message}`)
      }
    }
    return count
  }
}

function severityTag(s) {
  if (s === 'error') return '🔴 [严重]'
  if (s === 'warning') return '🟡 [提示]'
  return '⚪ [细节]'
}