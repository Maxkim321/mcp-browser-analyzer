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
  const url = (req.url || '/').split('?')[0]
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
    case '/api/trace':
      sendJson(res, 200, { events: traceLog.readAll().slice(-100).reverse() })
      break
    case '/api/memory':
      sendJson(res, 200, memoryPayload())
      break
    default:
      sendJson(res, 404, { error: 'not found' })
  }
}

module.exports = { handleRequest }
