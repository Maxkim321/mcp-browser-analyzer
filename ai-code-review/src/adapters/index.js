/**
 * Adapter 工厂
 */
import { MockAdapter } from './mock.js'
import { GitLabAdapter } from './gitlab.js'
import { GitHubAdapter } from './github.js'

export function createAdapter(platform, opts, config) {
  if (platform === 'mock') {
    return new MockAdapter({
      diffFile: opts.diff,
      filesDir: opts['files-dir'],
      base: opts.base,
      head: opts.head,
      cwd: opts.cwd,
    })
  }
  if (platform === 'gitlab') return new GitLabAdapter({ ...config.gitlab, project: opts.project, iid: opts.iid })
  if (platform === 'github') return new GitHubAdapter({ ...config.github, repo: opts.repo, pr: opts.pr })
  throw new Error(`未知 platform: ${platform}（支持 mock / gitlab / github）`)
}