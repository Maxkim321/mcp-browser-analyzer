/**
 * Mock Adapter：无 GitLab/GitHub 也能本地走通全流程
 *  - 指定一个 diff 文件 + 源码目录（--diff / --files-dir），或
 *  - 在一个 git 仓库里用 --base / --head 生成 diff
 * 不会真正回贴评论，而是把评论交给输出层打印（demo 用）。
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { parseDiff } from '../parser.js'

function runGit(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
}

function extractLines(file) {
  const changedLines = new Set()
  const addLines = new Set()
  for (const h of file.hunks) {
    for (const l of h.lines) {
      if (l.newLine != null) changedLines.add(l.newLine)
      if (l.type === 'add') addLines.add(l.newLine)
    }
  }
  return { changedLines, addLines }
}

export class MockAdapter {
  constructor({ diffFile, filesDir, base, head, cwd }) {
    this.diffFile = diffFile && resolve(cwd, diffFile)
    this.filesDir = filesDir && resolve(cwd, filesDir)
    this.base = base
    this.head = head
    this.cwd = cwd
  }

  get label() {
    return 'mock'
  }

  async load() {
    let diffText
    if (this.diffFile) {
      diffText = readFileSync(this.diffFile, 'utf8')
    } else {
      if (!this.base || !this.head) {
        throw new Error('mock 模式需要提供 --diff <文件> 或 --base/--head(repo 分支)')
      }
      diffText = runGit(['diff', `${this.base}...${this.head}`], this.cwd)
    }

    const rawFiles = parseDiff(diffText)
    const result = []
    for (const f of rawFiles) {
      const { changedLines, addLines } = extractLines(f)
      const file = { path: f.path, changedLines, addLines, hunks: f.hunks }
      // 尽量补全文内容给 LLM 作为上下文
      const local = this.filesDir ? resolve(this.filesDir, f.path) : null
      if (local && existsSync(local)) {
        file.lines = readFileSync(local, 'utf8').split('\n')
      } else if (this.head && this.base) {
        try {
          file.lines = runGit(['show', `${this.head}:${f.path}`], this.cwd).split('\n')
        } catch {
          file.lines = this.reconstruct(f)
        }
      } else {
        file.lines = this.reconstruct(f)
      }
      result.push(file)
    }
    return result
  }

  /** 退化方案：只有 diff 片段时不重构全文，直接用新增行拼一个"内容" */
  reconstruct(file) {
    const addMap = new Map()
    for (const h of file.hunks) for (const l of h.lines) if (l.newLine != null) addMap.set(l.newLine, l.text)
    const max = Math.max(0, ...addMap.keys())
    const arr = Array.from({ length: max }, (_, i) => addMap.get(i + 1) ?? '')
    return arr
  }

  /** mock 不回贴，空实现（打印交给输出层） */
  async postComments() {
    return []
  }
}