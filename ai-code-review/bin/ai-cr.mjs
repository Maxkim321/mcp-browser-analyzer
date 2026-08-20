#!/usr/bin/env node
/**
 * ai-cr —— AI 代码审查 CLI
 *
 * 用法示例：
 *   # Mock 演示（无需任何平台账号，直接本地跑）
 *   node bin/ai-cr.mjs --platform mock --diff samples/sample.diff --files-dir samples/files
 *   # 任意 git 仓库里，审查 main..当前分支 的变更
 *   node bin/ai-cr.mjs --base main --head $(git branch --show-current)
 *   # 真实 GitLab MR
 *   node bin/ai-cr.mjs --platform gitlab --project <group/repo> --iid 42 --post
 */
import { argv, cwd, env } from 'node:process'
import { loadDotEnv } from '../src/dotenv.js'
import { getConfig } from '../src/config.js'
import { LLMClient } from '../src/llm.js'
import { createAdapter } from '../src/adapters/index.js'
import { Reviewer } from '../src/reviewer.js'
import { formatText, formatMarkdown, formatJson } from '../src/output.js'

function parseArgs(args) {
  const opts = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = args[i + 1]
    if (next && !next.startsWith('--')) {
      opts[key] = next
      i++
    } else {
      opts[key] = true
    }
  }
  return opts
}

const HELP = `用法: ai-cr [options]
平台/输入：
  --platform mock|gitlab|github  默认 mock
  --diff <path>                 指定 diff 文件（mock）
  --files-dir <dir>             源码目录，用于补全文内容（mock）
  --base <ref> --head <ref>     在 git 仓库里用分支生成 diff（mock）
  --project <path> --iid <n>    GitLab 项目路径 与 MR iid
  --repo <owner/name> --pr <n>  GitHub 仓库 与 PR 编号
审查配置：
  --skills a,b,c              security,naming,complexity（默认全部）
  --min-severity error|warning|nit   过滤最低级别
输出：
  --output text|md|json       默认 text
  --post                      把评论回贴到 GitLab/GitHub
  --help                      显示帮助
环境变量：ARK_API_KEY 必填；可配 ARK_BASE_URL / ARK_MODEL
（GitHub 需 GITHUB_TOKEN；GitLab 需 GITLAB_HOST / GITLAB_TOKEN）`

async function main() {
  const opts = parseArgs(argv.slice(2))
  if (opts.help) return console.log(HELP)

  loadDotEnv(cwd())
  const config = getConfig(env)
  if (!config.llm.apiKey) {
    console.error('缺少 ARK_API_KEY，请在 ai-code-review/.env 或环境变量里配置')
    process.exitCode = 1
    return
  }

  const platform = opts.platform || 'mock'
  opts.cwd = cwd()
  const adapter = createAdapter(platform, opts, config)
  const reviewer = new Reviewer(adapter, {
    llm: new LLMClient(config),
    minSeverity: opts['min-severity'],
    skillIds: opts.skills?.split(',').map((s) => s.trim()).filter(Boolean),
  })

  console.log(`[ai-cr] platform=${platform} 正在分析变更文件...`)
  const comments = await reviewer.run()

  const output = opts.output || 'text'
  const text =
    output === 'json'
      ? JSON.stringify(formatJson(comments), null, 2)
      : output === 'md'
        ? formatMarkdown(comments)
        : formatText(comments)
  console.log('--------------------------------------------------')
  console.log(text)

  if (opts.post && (platform === 'gitlab' || platform === 'github')) {
    if (platform === 'github' && (!config.github.token || !opts.repo || !opts.pr)) {
      throw new Error('github 回贴需要 GITHUB_TOKEN，并传入 --repo owner/name 与 --pr <编号>')
    }
    if (platform === 'gitlab' && !config.gitlab.token) {
      throw new Error('gitlab 回贴需要 GITLAB_TOKEN')
    }
    console.log('\n[ai-cr] 正在回贴评论到平台...')
    const posted = await adapter.postComments(comments)
    console.log(`[ai-cr] 回贴完成，成功 ${posted.posted} / 失败 ${posted.failed}`)
  }
}

main().catch((e) => {
  console.error('[ai-cr] 执行失败:', e.message)
  process.exitCode = 1
})