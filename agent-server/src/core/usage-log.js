const fs = require('fs')
const path = require('path')

/**
 * Token 用量台账（P2 成本账本的数据层）
 * LLM 每次调用（含 tier）追加一行 JSONL 到 data/usage-log.jsonl。
 * 追加式、永不改写——和事件溯源同一个原则，账要可审计。
 */
const DATA_DIR = path.join(__dirname, '..', '..', 'data')
const LOG_FILE = path.join(DATA_DIR, 'usage-log.jsonl')

function record(entry) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.appendFileSync(LOG_FILE, JSON.stringify({ ...entry, ts: new Date().toISOString() }) + '\n')
  } catch (error) {
    // 账本失败绝不影响主流程
    console.warn('[UsageLog] write failed:', error.message)
  }
}

/** 读取全部台账（cost-report 用） */
function readAll() {
  try {
    return fs
      .readFileSync(LOG_FILE, 'utf8')
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

module.exports = { record, readAll, LOG_FILE }
