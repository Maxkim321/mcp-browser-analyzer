const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

/**
 * 浏览记忆卡片库（P3 RAG 数据层）
 *
 * 每次 AI 总结/研究成功后，把"用户真实读过的页面"沉淀为一张卡片：
 * { id, ts, url, title, summary, keywords }
 * 追加式、永不改写（与事件溯源同一原则）。文件在 data/memory.jsonl，仅存本地。
 */
const DATA_DIR = path.join(__dirname, '..', '..', 'data')
// 路径可由 MEMORY_FILE 覆盖（测试隔离用），默认 data/memory.jsonl
const FILE = process.env.MEMORY_FILE || path.join(DATA_DIR, 'memory.jsonl')

/**
 * 记录一张卡片（同 URL + 同标题会覆盖式追加新版本，检索时取最新最高分）
 * @param {object} entry - { url, title, summary }
 * @returns {object|null} 落库的卡片；无效输入返回 null
 */
function append({ url, title, summary }) {
  if (!url || !summary || String(summary).trim().length < 40) return null
  const card = {
    id:
      crypto.createHash('md5').update(String(url)).digest('hex').slice(0, 8) +
      '-' +
      Date.now().toString(36),
    ts: new Date().toISOString(),
    url: String(url).slice(0, 500),
    title: String(title || url).slice(0, 200),
    summary: String(summary).slice(0, 1500),
  }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.appendFileSync(FILE, JSON.stringify(card) + '\n')
    return card
  } catch (error) {
    console.warn('[Memory] append failed:', error.message)
    return null
  }
}

/** 读取全部卡片 */
function readAll() {
  try {
    return fs
      .readFileSync(FILE, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

module.exports = { append, readAll, FILE }
