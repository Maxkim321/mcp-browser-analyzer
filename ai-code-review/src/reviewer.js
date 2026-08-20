/**
 * Reviewer：编排审查主流程
 * 1. adapter.load() 拿到本次 diff 里的文件（含变更行 + 全文）
 * 2. 对每个文件：
 *    a. 先用各 Skill 的 precheck 跑确定性规则
 *    b. 再组装 prompt 交给 LLM 做语义审查
 * 3. 汇总评论（行级，只落在本次变更行上）
 */
import { normalizeSeverity } from './parser.js'
import { parseJsonArray } from './llm.js'
import * as skills from './skills/index.js'

export class Reviewer {
  constructor(adapter, { llm, minSeverity = 'nit', skillIds }) {
    this.adapter = adapter
    this.llm = llm
    this.minSeverity = minSeverity
    const all = Object.values(skills)
    this.skills = skillIds ? all.filter((s) => skillIds.includes(s.id)) : all
  }

  async run() {
    const files = await this.adapter.load()
    const comments = []
    for (const file of files) {
      for (const skill of this.skills) {
        comments.push(...this.runRuleCheck(file, skill))
        comments.push(...(await this.runLLMCheck(file, skill)))
      }
    }
    return this.filter(comments)
  }

  runRuleCheck(file, skill) {
    if (!skill.precheck || !file.lines) return []
    return (skill.precheck({ lines: file.lines, changedLines: file.changedLines }) || []).map((c) => ({
      ...c,
      file,
      skill: skill.name,
      source: 'rule',
    }))
  }

  async runLLMCheck(file, skill) {
    const userMessage = this.buildUserMessage(file, skill)
    const raw = await this.llm.review(skill.systemRule, userMessage)
    const list = parseJsonArray(raw)
    if (!Array.isArray(list)) return []

    const seen = new Set()
    return list
      .map((c) => ({
        line: Number(c.line || c.ln || c.line_number),
        severity: normalizeSeverity(c.severity),
        message: String(c.message || c.reason || '').trim(),
      }))
      .filter((c) => c.line && c.message)
      .filter((c) => !seen.has(`${c.line}:${c.message}`) && !!seen.add(`${c.line}:${c.message}`))
      .map((c) => ({ ...c, file, skill: skill.name, source: 'llm' }))
  }

  /** 只保留落在本次「变更行」上的评论，避免锚到无关代码 */
  buildUserMessage(file, skill) {
    const lines = file.lines || this.syntheticLines(file)
    const matrix = lines.map((text, i) => {
      const no = i + 1
      const mark = file.addLines.has(no) ? '+' : file.changedLines.has(no) ? '~' : ' '
      return `${String(no).padStart(4)}|${mark}| ${text}`
    })
    return [
      `请审查这个文件「${file.path}」。`,
      `行号前缀里的标记：+ = 本次新增行（重点），~ = 变更附近上下文，空格 = 未变更。`,
      `你的意见必须能定位到具体行号（新增行优先），只回复 [ { "line": 行号, "severity": "error|warning|nit", "message": "中文意见" } ] 形式的 JSON 数组，不要输出其他内容。`,
      ``,
      matrix.join('\n'),
    ].join('\n')
  }

  syntheticLines(file) {
    const out = {}
    for (const h of file.hunks) for (const l of h.lines) if (l.newLine != null) out[l.newLine] = l.text
    const max = Math.max(0, ...Object.keys(out).map(Number))
    return Array.from({ length: max }, (_, i) => out[i + 1] ?? '')
  }

  filter(comments) {
    const rank = { error: 3, warning: 2, nit: 1 }
    const min = rank[this.minSeverity] ?? 1
    // 先按 severity(降) + source(规则优先) 排序，再做跨 Skill 去重，
    // 让同一处问题只显示一条（规则硬查优先，LLM 语义结果兜底）
    const seen = new Set()
    return comments
      .filter((c) => rank[c.severity] >= min)
      .sort((a, b) => rank[b.severity] - rank[a.severity] || (a.source === 'rule' ? -1 : 1))
      .filter((c) => {
        const key = `${c.file.path}|${c.line}|${c.message.replace(/\s+/g, '')}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
  }
}