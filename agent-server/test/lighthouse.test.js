const { test } = require('node:test')
const assert = require('node:assert/strict')
const { validateUrl, summarizeLhr, CATEGORY_IDS } = require('../src/tools/lighthouse.js')

// 最小可用 LHR fixture：只保留 summarizeLhr 实际读取的字段
function makeLhr() {
  return {
    finalDisplayedUrl: 'https://example.com/',
    fetchTime: '2026-09-11T12:00:00.000Z',
    categories: {
      performance: { score: 0.92 },
      accessibility: { score: 0.95 },
      'best-practices': { score: 1 },
      seo: { score: null },
    },
    audits: {
      'first-contentful-paint': { displayValue: '0.8 s', numericValue: 800 },
      'largest-contentful-paint': { displayValue: '1.2 s', numericValue: 1200 },
      'total-blocking-time': { displayValue: '20 ms', numericValue: 20 },
      'cumulative-layout-shift': { displayValue: '0.01', numericValue: 0.01 },
      'unused-css-rules': {
        title: '移除未使用的 CSS',
        score: 0.5,
        details: { type: 'opportunity', overallSavingsMs: 1500 },
      },
      'render-blocking-resources': {
        title: '移除阻塞渲染的资源',
        score: 0.3,
        details: { type: 'opportunity', overallSavingsMs: 900 },
      },
      'color-contrast': { title: '背景色和前景色对比度不足', score: 0.4 },
    },
  }
}

test('validateUrl: 只放行 http/https', () => {
  assert.equal(validateUrl('https://example.com').protocol, 'https:')
  assert.equal(validateUrl('http://localhost:3000').protocol, 'http:')
  assert.throws(() => validateUrl('file:///etc/passwd'), /Only http\/https/)
  assert.throws(() => validateUrl('chrome://version'), /Only http\/https/)
  assert.throws(() => validateUrl('not a url'), /Invalid URL/)
  assert.throws(() => validateUrl(undefined), /Invalid URL/)
})

test('summarizeLhr: 分类得分 0-1 浮点转 0-100 整数，null 保留', () => {
  const summary = summarizeLhr(makeLhr())
  assert.equal(summary.scores.performance, 92)
  assert.equal(summary.scores.accessibility, 95)
  assert.equal(summary.scores['best-practices'], 100)
  assert.equal(summary.scores.seo, null)
  assert.equal(summary.url, 'https://example.com/')
})

test('summarizeLhr: 只收集有 displayValue 的核心指标', () => {
  const summary = summarizeLhr(makeLhr())
  const ids = summary.metrics.map((m) => m.id)
  // fixture 里 SI / server-response-time 没有，不应出现在结果里
  assert.deepEqual(ids, [
    'first-contentful-paint',
    'largest-contentful-paint',
    'total-blocking-time',
    'cumulative-layout-shift',
  ])
  assert.equal(summary.metrics[0].displayValue, '0.8 s')
})

test('summarizeLhr: 优化机会按可节省毫秒数降序', () => {
  const summary = summarizeLhr(makeLhr())
  assert.deepEqual(
    summary.opportunities.map((o) => o.id),
    ['unused-css-rules', 'render-blocking-resources']
  )
  assert.equal(summary.opportunities[0].savingsMs, 1500)
})

test('summarizeLhr: 低分审计项不含优化机会（避免重复），不含 informative 项', () => {
  const summary = summarizeLhr(makeLhr())
  assert.deepEqual(
    summary.failedAudits.map((a) => a.id),
    ['color-contrast']
  )
  assert.equal(summary.failedAudits[0].score, 40)
})

test('summarizeLhr: 空类别/空审计不抛错', () => {
  const summary = summarizeLhr({ finalUrl: 'https://x.com' })
  assert.deepEqual(summary.scores, {})
  assert.deepEqual(summary.metrics, [])
  assert.deepEqual(summary.opportunities, [])
  assert.equal(summary.url, 'https://x.com')
})

test('CATEGORY_IDS: 固定四类，供 handler 校验 categories 参数', () => {
  assert.deepEqual(CATEGORY_IDS, ['performance', 'accessibility', 'best-practices', 'seo'])
})
