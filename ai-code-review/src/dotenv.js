/**
 * 零依赖环境变量加载器（.env）
 * 只支持 KEY=VALUE / KEY="VALUE" / # 注释，够用即可，不为它引第三方依赖
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

export function loadDotEnv(cwd = process.cwd()) {
  const path = resolve(cwd, '.env')
  if (!existsSync(path)) return
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    let key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    // 不覆盖已经存在的环境变量
    if (key && process.env[key] === undefined) process.env[key] = value
  }
}