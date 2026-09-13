const fs = require('node:fs')
const path = require('node:path')
const usageLog = require('../core/usage-log.js')
const usageStats = require('../core/usage-stats.js')
const traceLog = require('../core/trace-log.js')
const config = require('../config/index.js')

/**
 * Agent 仪表盘（度量可视化：给"默默工作的度量"一块显示屏）
 *
 * 与 WebSocket 同端口（HTTP upgrade 共存）：GET / 或 /dashboard 返回单页，
 * 数据经 /api/* 同源读取——只读 results/ 产物与 JSONL 台账，不碰核心编排逻辑。
 *
 * 数据来源（全部是已有产物，dashboard 不生产数字只呈现数字）：
 * - /api/usage       ← data/usage-log.jsonl（成本台账：按档位/模型/日聚合）
 * - /api/compression ← bench/results/compression-bench.json（压缩保真度基准）
 * - /api/eval        ← eval/results/latest.json（黄金评测基线）
 * - /api/trace       ← data/trace-log.jsonl（运行时观测事件：压缩/重试/降级）
 * - /api/memory      ← data/memory.jsonl（浏览记忆卡片数）
 */

const ROOT = path.join(__dirname, '..', '..')
const PAGE_FILE = path.join(ROOT, 'dashboard', 'index.html')
const BENCH_FILE = path.join(ROOT, 'bench', 'results', 'compression-bench.json')
const EVAL_FILE = path.join(ROOT, 'eval', 'results', 'latest.json')
const MEMORY_FILE = path.join(ROOT, 'data', 'memory.jsonl')
const MEMORY_AB_FILE = path.join(ROOT, 'eval', 'results', 'memory-ab.json')
const GOLDEN_FILE = path.join(ROOT, 'eval', 'golden', 'cases.json')
const EVAL_RESULTS_DIR = path.join(ROOT, 'eval', 'results')
const EVENTS_DIR = path.join(ROOT, 'data', 'events')

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(payload)
}

function sendPage(res) {
  try {
    const html = fs.readFileSync(PAGE_FILE, 'utf8')
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(html)
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('dashboard page missing: agent-server/dashboard/index.html')
  }
}

/** 成本台账聚合（含单价表，前端不用重复配价） */
function usagePayload() {
  const entries = usageLog.readAll()
  const summary = usageStats.summarize(entries)
  return { ...summary, pricing: config.llm.pricing, entries: entries.length }
}

/** 压缩保真度基准 + 运行时压缩事件（离线结论与线上发生分开呈现） */
function compressionPayload() {
  const bench = readJson(BENCH_FILE)
  const runtime = traceLog
    .readAll()
    .filter((e) => e.type === 'context_compressed')
    .slice(-20)
    .reverse()
  return { bench, runtime }
}

/** 黄金评测基线 */
function evalPayload() {
  return readJson(EVAL_FILE)
}

/** 浏览记忆卡片概况 + A/B 对照数字（有/无记忆通过率与 recall@3） */
function memoryPayload() {
  let cards = 0
  let latest = null
  try {
    const lines = fs.readFileSync(MEMORY_FILE, 'utf8').split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const card = JSON.parse(line)
        cards++
        latest = { title: card.title, url: card.url, ts: card.ts || null }
      } catch {
        /* 坏行跳过 */
      }
    }
  } catch {
    /* 库不存在 → 0 张 */
  }
  return { cards, latest, ab: readJson(MEMORY_AB_FILE) }
}

/**
 * HTTP 请求入口（ws-server 把非 upgrade 请求交到这里）
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
function handleRequest(req, res) {
  const parsed = new URL(req.url || '/', 'http://localhost')
  const url = parsed.pathname
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'method not allowed' })
    return
  }
  switch (url) {
    case '/':
    case '/dashboard':
      sendPage(res)
      break
    case '/api/usage':
      sendJson(res, 200, usagePayload())
      break
    case '/api/compression':
      sendJson(res, 200, compressionPayload())
      break
    case '/api/eval':
      sendJson(res, 200, evalPayload())
      break
    case '/api/eval/cases':
      sendJson(res, 200, evalCasesPayload())
      break
    case '/api/eval/history':
      sendJson(res, 200, evalHistoryPayload())
      break
    case '/api/trace':
      sendJson(res, 200, { events: traceLog.readAll().slice(-100).reverse() })
      break
    case '/api/memory':
      sendJson(res, 200, memoryPayload())
      break
    case '/api/sessions':
      sendJson(res, 200, sessionsPayload())
      break
    case '/api/events':
      sendJson(res, 200, sessionEventsPayload(parsed.searchParams.get('session')))
      break
    default:
      sendJson(res, 404, { error: 'not found' })
  }
}

module.exports = {
  handleRequest,
  evalCasesPayload,
  evalHistoryPayload,
  sessionsPayload,
  sessionEventsPayload,
}

// ===== 评测台 + 白盒面板的数据装配（纯读文件，导出以便单测注入目录） =====

/**
 * 测试集清单：golden cases 全量展示（rubric 判分层随 case 返回，前端展开可见）
 * @param {string} [goldenFile] - cases.json 路径（测试注入用）
 * @returns {object} {count, cases:[{id,type,fixture,action,prompt,rubric}]}
 */
function evalCasesPayload(goldenFile = GOLDEN_FILE) {
  const raw = readJson(goldenFile)
  if (!raw || !Array.isArray(raw.cases)) return { count: 0, cases: [] }
  const cases = raw.cases.map((c) => ({
    id: c.id,
    type: c.type,
    fixture: c.fixture || null,
    action: c.action || null,
    prompt: c.prompt || null,
    rubric: c.rubric || null,
  }))
  return { count: cases.length, cases }
}

/**
 * 评测历史：eval/results 下所有「运行产物」按时间排序（passRate 趋势的数据源）
 * 目录里混有非运行产物（A/B 臂文件等），按产物形状过滤：必须有 total 数字 + results 数组
 * @param {string} [resultsDir] - results 目录（测试注入用）
 * @returns {object} {runs:[{file,ranAt,total,passed,passRate,llmJudge}]}
 */
function evalHistoryPayload(resultsDir = EVAL_RESULTS_DIR) {
  let files = []
  try {
    files = fs.readdirSync(resultsDir).filter((f) => f.endsWith('.json'))
  } catch {
    return { runs: [] }
  }
  const runs = []
  for (const file of files) {
    const data = readJson(path.join(resultsDir, file))
    if (!data || typeof data.total !== 'number' || !Array.isArray(data.results)) continue
    runs.push({
      file,
      ranAt: data.ranAt || null,
      total: data.total,
      passed: data.passed,
      passRate: data.passRate,
      llmJudge: data.llmJudge ?? null,
    })
  }
  runs.sort((a, b) => String(a.ranAt).localeCompare(String(b.ranAt)))
  return { runs }
}

const MAX_SESSIONS = 50

/**
 * 会话列表：data/events/*.jsonl 逐个统计（白盒「会话溯源」的选择器数据源）
 * @param {string} [eventsDir] - 事件目录（测试注入用）
 * @returns {object} {sessions:[{id,events,firstTs,lastTs,preview}]} 按 lastTs 降序
 */
function sessionsPayload(eventsDir = EVENTS_DIR) {
  let files = []
  try {
    files = fs.readdirSync(eventsDir).filter((f) => f.endsWith('.jsonl'))
  } catch {
    return { sessions: [] }
  }
  const sessions = []
  for (const file of files) {
    let lines = []
    try {
      lines = fs.readFileSync(path.join(eventsDir, file), 'utf8').split('\n').filter(Boolean)
    } catch {
      continue
    }
    const events = lines.length
    let firstTs = null
    let lastTs = null
    let preview = ''
    for (const line of lines) {
      try {
        const e = JSON.parse(line)
        if (typeof e.ts === 'number') {
          if (!firstTs || e.ts < firstTs) firstTs = e.ts
          if (!lastTs || e.ts > lastTs) lastTs = e.ts
        }
        if (!preview && e.type === 'user' && typeof e.content === 'string') {
          preview = e.content.slice(0, 60)
        }
      } catch {
        /* 坏行跳过 */
      }
    }
    sessions.push({ id: file.replace(/\.jsonl$/, ''), events, firstTs, lastTs, preview })
  }
  sessions.sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0))
  return { sessions: sessions.slice(0, MAX_SESSIONS) }
}

/**
 * 会话事件流：单会话全部原始事件（白盒时间线，逐条可展开原始 JSON）
 * 有意不过滤字段：白盒的价值就是看到 append 了什么，坏行标注 parse_error
 * @param {string} sessionId - 会话 ID（不含扩展名）
 * @param {string} [eventsDir] - 事件目录（测试注入用）
 * @returns {object} {session,total,events:[...]}
 */
function sessionEventsPayload(sessionId, eventsDir = EVENTS_DIR) {
  const safe = String(sessionId || '').replace(/[^a-zA-Z0-9_-]/g, '_')
  if (!safe) return { session: '', total: 0, events: [] }
  let lines = []
  try {
    lines = fs
      .readFileSync(path.join(eventsDir, `${safe}.jsonl`), 'utf8')
      .split('\n')
      .filter(Boolean)
  } catch {
    return { session: safe, total: 0, events: [] }
  }
  const events = []
  lines.forEach((line, i) => {
    try {
      events.push(JSON.parse(line))
    } catch {
      events.push({ type: 'parse_error', line: i + 1, raw: line.slice(0, 200) })
    }
  })
  return { session: safe, total: events.length, events }
}
