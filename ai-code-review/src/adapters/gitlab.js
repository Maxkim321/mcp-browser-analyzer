/**
 * GitLab Adapter：真实对接 GitLab（对应简历里 GitLab CI 场景）
 *  - 拉 MR 变更：GET  /api/v4/projects/:pid/merge_requests/:iid/changes
 *  - 回贴行级评论：POST /api/v4/projects/:pid/merge_requests/:iid/discussions（position 定位到具体行）
 * 关键坑：行级注需要 position 里的 base_sha/start_sha/head_sha 取自 MR 的 diff_refs。
 */
import { parseDiff } from '../parser.js'

export class GitLabAdapter {
  constructor({ host, token, project, iid, ref }) {
    this.host = host.replace(/\/$/, '')
    this.token = token
    this.project = project // 使用 URL 编码的 project path
    this.iid = iid
    this.ref = ref || 'HEAD'
  }

  get label() {
    return 'gitlab'
  }

  async _api(path) {
    const res = await fetch(`${this.host}/api/v4${path}`, {
      headers: { 'PRIVATE-TOKEN': this.token },
    })
    if (!res.ok) throw new Error(`GitLab API ${res.status}: ${await res.text()}`)
    return res.json()
  }

  async load() {
    const { changes, diff_refs } = await this._api(
      `/projects/${this.project}/merge_requests/${this.iid}/changes`,
    )
    const result = []
    for (const c of changes) {
      const rawFiles = parseDiff(c.diff)
      const file = rawFiles[0]
      if (!file) continue
      const changedLines = new Set()
      const addLines = new Set()
      for (const h of file.hunks) {
        for (const l of h.lines) {
          if (l.newLine != null) changedLines.add(l.newLine)
          if (l.type === 'add') addLines.add(l.newLine)
        }
      }
      const path = c.new_path || c.old_path || file.path
      let lines = null
      try {
        const encoded = encodeURIComponent(c.new_path)
        const raw = await this._api(
          `/projects/${this.project}/repository/files/${encoded}/raw?ref=${encodeURIComponent(this.ref)}`,
        )
        lines = typeof raw === 'string' ? raw.split('\n') : null
      } catch {
        lines = null
      }
      result.push({ path, changedLines, addLines, hunks: file.hunks, lines, diffRefs: diff_refs })
    }
    return result
  }

  /** 在 MR 对应行上发评论（虚拟 Reviewer） */
  async postComments(comments) {
    const diffRefs = comments[0]?.file?.diffRefs
    if (!diffRefs) throw new Error('缺少 diff_refs，无法定位行级评论')
    const count = { posted: 0, failed: 0 }
    for (const c of comments) {
      const body = {
        body: `${severityTag(c.severity)} ${c.message}\n\n> 由 ai-code-review 的「${c.skill}」Skill 自动生成`,
        position: {
          base_sha: diffRefs.base_sha,
          start_sha: diffRefs.start_sha ?? diffRefs.base_sha,
          head_sha: diffRefs.head_sha,
          new_path: c.file.path,
          new_line: c.line,
        },
      }
      try {
        await this._postDiscussion(c.file, body)
        count.posted++
      } catch (e) {
        count.failed++
        console.error(`评论失败 line=${c.line}: ${e.message}`)
      }
    }
    return count
  }

  async _postDiscussion(file, body) {
    const res = await fetch(
      `${this.host}/api/v4/projects/${this.project}/merge_requests/${this.iid}/discussions`,
      {
        method: 'POST',
        headers: { 'PRIVATE-TOKEN': this.token, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    )
    if (!res.ok) throw new Error(`GitLab POST ${res.status}: ${await res.text()}`)
    return res.json()
  }
}

function severityTag(s) {
  if (s === 'error') return ':red_circle: [严重]'
  if (s === 'warning') return ':warning: [提示]'
  return ':white_check_mark: [细节]'
}