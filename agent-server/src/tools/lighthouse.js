const { launch } = require('chrome-launcher')

/**
 * Lighthouse 性能审计工具
 *
 * 与依赖浏览器插件转发的工具（get_browser_performance 等）不同，
 * 这里在服务端直接启动 headless Chrome 跑完整的 Lighthouse 审计，
 * 不占用用户当前页面，也不需要插件在线。
 *
 * 模块拆分：summarizeLhr 是纯函数，单测不需要真的跑 Lighthouse。
 */

// 关注的核心指标（audits id → 展示名）
const METRIC_IDS = [
  { id: 'first-contentful-paint', title: 'FCP 首次内容绘制' },
  { id: 'largest-contentful-paint', title: 'LCP 最大内容绘制' },
  { id: 'total-blocking-time', title: 'TBT 总阻塞时间' },
  { id: 'cumulative-layout-shift', title: 'CLS 累积布局偏移' },
  { id: 'speed-index', title: 'SI 速度指数' },
  { id: 'server-response-time', title: '服务器响应时间' },
]

const CATEGORY_IDS = ['performance', 'accessibility', 'best-practices', 'seo']

/**
 * 校验审计目标 URL
 * 只允许 http/https，防止 file://、chrome:// 等协议打崩 Lighthouse
 * @param {string} url
 * @returns {URL}
 */
function validateUrl(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid URL: ${url}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Only http/https URLs are supported, got: ${parsed.protocol}`)
  }
  return parsed
}

/**
 * 从 Lighthouse 结果 JSON 中提取精简摘要（纯函数，便于单测）
 * @param {object} lhr - Lighthouse Result 对象
 * @param {number} [topN=5] - 优化建议条数上限
 * @returns {object} 摘要
 */
function summarizeLhr(lhr, topN = 5) {
  // 分类得分：0-1 浮点 → 0-100 整数，null（错误/未跑）保持 null
  const scores = {}
  for (const [id, category] of Object.entries(lhr.categories || {})) {
    scores[id] = category.score === null ? null : Math.round(category.score * 100)
  }

  const audits = lhr.audits || {}
  const metrics = []
  for (const { id, title } of METRIC_IDS) {
    const audit = audits[id]
    if (audit && audit.displayValue !== undefined) {
      metrics.push({ id, title, displayValue: audit.displayValue, value: audit.numericValue })
    }
  }

  // 优化机会：按可节省毫秒数降序取前 N 条
  const opportunities = Object.entries(audits)
    .filter(([, a]) => a.details?.type === 'opportunity' && a.details.overallSavingsMs > 0)
    .sort(([, a], [, b]) => b.details.overallSavingsMs - a.details.overallSavingsMs)
    .slice(0, topN)
    .map(([id, a]) => ({
      id,
      title: a.title,
      savingsMs: Math.round(a.details.overallSavingsMs),
    }))

  // 低分审计项：帮 LLM 定位"除了分数之外具体差在哪"
  const failedAudits = Object.entries(audits)
    .filter(([, a]) => a.score !== null && a.score < 0.9 && !a.details?.overallSavingsMs && a.scoreDisplayMode !== 'informative')
    .sort(([, a], [, b]) => a.score - b.score)
    .slice(0, topN)
    .map(([id, a]) => ({ id, title: a.title, score: Math.round(a.score * 100) }))

  return {
    url: lhr.finalDisplayedUrl || lhr.finalUrl || lhr.requestedUrl,
    fetchTime: lhr.fetchTime,
    runtimeError: lhr.runtimeError?.message || null,
    scores,
    metrics,
    opportunities,
    failedAudits,
  }
}

/**
 * 对指定 URL 运行 Lighthouse 审计
 * @param {string} url - 目标页面
 * @param {object} [options]
 * @param {string[]} [options.categories] - 要跑的分类，默认全部四类
 * @param {number} [options.timeoutMs=90000] - 整体超时（Lighthouse 一次全分类通常 30-60s）
 * @param {string} [options.chromePath] - 自定义 Chrome 路径（找不到系统 Chrome 时用）
 * @returns {Promise<object>} summarizeLhr 的摘要结果
 */
async function runLighthouseAudit(url, options = {}) {
  validateUrl(url)
  const categories = (options.categories || CATEGORY_IDS).filter((c) => CATEGORY_IDS.includes(c))
  if (categories.length === 0) {
    throw new Error(`categories must be a subset of: ${CATEGORY_IDS.join(', ')}`)
  }

  // 延迟 require：lighthouse 模块加载较重，只在真正执行审计时加载
  const lighthouse = require('lighthouse').default

  const { timeoutMs = 90000, chromePath } = options
  let chrome
  try {
    chrome = await launch({
      chromeFlags: ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'],
      ...(chromePath ? { chromePath } : {}),
    })
  } catch (error) {
    throw new Error(`Failed to launch Chrome for Lighthouse: ${error.message}`)
  }

  // 超时用 Promise.race 而不是 setTimeout 里 throw：
  // 定时器回调里抛错会变成未捕获异常，调用方永远收不到 reject
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Lighthouse audit timed out after ${timeoutMs}ms`)), timeoutMs)
  })

  const audit = lighthouse(url, {
    port: chrome.port,
    output: 'json',
    onlyCategories: categories,
    maxWaitForLoad: 45000,
    logLevel: 'error',
  })

  try {
    const result = await Promise.race([audit, timeout])
    if (!result || !result.lhr) {
      throw new Error('Lighthouse returned no result')
    }
    return summarizeLhr(result.lhr)
  } finally {
    // 正常结束、报错、超时都要杀掉 Chrome，否则僵尸进程占住端口
    try {
      await chrome.kill()
    } catch {
      // Chrome 已退出时 kill 会报错，忽略即可
    }
  }
}

module.exports = {
  CATEGORY_IDS,
  validateUrl,
  summarizeLhr,
  runLighthouseAudit,
}
