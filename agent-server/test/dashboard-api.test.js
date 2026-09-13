const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
// 测试隔离：必须在 require trace-log 之前设置（模块加载时固化路径）
process.env.TRACE_FILE = path.join(os.tmpdir(), `trace-log-test-${process.pid}.jsonl`)
const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const {
  handleRequest,
  evalCasesPayload,
  evalHistoryPayload,
  sessionsPayload,
  sessionEventsPayload,
} = require('../src/communication/dashboard.js')

/**
 * 评测台 + 白盒面板的数据装配层
 * 原则与 dashboard 一致：只读文件不生产数字；这里验证装配逻辑本身（过滤/排序/坏行容错）
 */

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-${process.pid}-`))
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data))
}

// ===== evalCasesPayload =====

describe('evalCasesPayload', () => {
  test('解析 golden cases：count 与 cases 一致，rubric 原样透传', () => {
    const dir = tmpDir('golden')
    const file = path.join(dir, 'cases.json')
    writeJson(file, {
      cases: [
        {
          id: 'summary-01',
          type: 'summary',
          fixture: 'pages/a.html',
          rubric: { must_mention: ['x'] },
        },
        { id: 'chat-01', type: 'chat', prompt: '你好' },
      ],
    })
    const payload = evalCasesPayload(file)
    assert.equal(payload.count, 2)
    assert.equal(payload.cases.length, 2)
    assert.equal(payload.cases[0].rubric.must_mention[0], 'x')
    assert.equal(payload.cases[1].fixture, null)
    assert.equal(payload.cases[1].prompt, '你好')
  })

  test('文件缺失或形状不对时返回空集（不抛错，dashboard 显示空态）', () => {
    assert.deepEqual(evalCasesPayload(path.join(tmpDir('golden2'), 'missing.json')), {
      count: 0,
      cases: [],
    })
    const bad = path.join(tmpDir('golden3'), 'cases.json')
    fs.writeFileSync(bad, '{ not json')
    assert.deepEqual(evalCasesPayload(bad), { count: 0, cases: [] })
  })

  test('真实仓库 golden 文件可读（防数据形状漂移）', () => {
    const payload = evalCasesPayload()
    assert.ok(payload.count > 0, '仓库应有 golden cases')
    for (const c of payload.cases) {
      assert.ok(c.id, '每个 case 应有 id')
      assert.ok(c.type, '每个 case 应有 type')
    }
  })
})

// ===== evalHistoryPayload =====

describe('evalHistoryPayload', () => {
  test('只收运行产物（total 数字 + results 数组），按 ranAt 升序', () => {
    const dir = tmpDir('results')
    writeJson(path.join(dir, 'b-run.json'), {
      ranAt: '2026-09-12T10:00:00Z',
      total: 8,
      passed: 7,
      passRate: 0.875,
      llmJudge: true,
      results: [],
    })
    writeJson(path.join(dir, 'a-run.json'), {
      ranAt: '2026-09-11T10:00:00Z',
      total: 7,
      passed: 7,
      passRate: 1,
      results: [],
    })
    // 非运行产物：A/B 臂文件（无 total/results 形状）必须被过滤
    writeJson(path.join(dir, 'memory-ab.json'), {
      recallAt3: 1,
      withMemory: { rate: 1 },
    })
    const { runs } = evalHistoryPayload(dir)
    assert.equal(runs.length, 2)
    assert.equal(runs[0].file, 'a-run.json')
    assert.equal(runs[1].file, 'b-run.json')
    assert.equal(runs[1].passRate, 0.875)
  })

  test('目录缺失返回空 runs', () => {
    assert.deepEqual(evalHistoryPayload(path.join(tmpDir('results2'), 'nope')), { runs: [] })
  })
})

// ===== sessionsPayload / sessionEventsPayload =====

describe('sessionsPayload', () => {
  test('统计事件数与首末时间，按最近活动降序，user 首条做预览', () => {
    const dir = tmpDir('events')
    fs.writeFileSync(
      path.join(dir, 'old-session.jsonl'),
      [
        JSON.stringify({ type: 'user', content: '帮我总结这一页', ts: 1000 }),
        JSON.stringify({ type: 'assistant', content: '好的', ts: 2000 }),
      ].join('\n')
    )
    fs.writeFileSync(
      path.join(dir, 'new-session.jsonl'),
      JSON.stringify({ type: 'user', content: '新会话的第一句', ts: 9000 })
    )
    // 坏行文件：不应崩溃，事件数按行计
    fs.writeFileSync(
      path.join(dir, 'broken.jsonl'),
      [JSON.stringify({ type: 'user', content: 'ok', ts: 1 }), '{bad json'].join('\n')
    )
    const { sessions } = sessionsPayload(dir)
    assert.equal(sessions.length, 3)
    assert.equal(sessions[0].id, 'new-session')
    assert.equal(sessions[1].id, 'old-session')
    assert.equal(sessions[1].events, 2)
    assert.equal(sessions[1].firstTs, 1000)
    assert.equal(sessions[1].lastTs, 2000)
    assert.ok(sessions[1].preview.includes('帮我总结'))
    assert.equal(sessions[2].id, 'broken')
    assert.equal(sessions[2].events, 2)
  })

  test('目录缺失返回空 sessions', () => {
    assert.deepEqual(sessionsPayload(path.join(tmpDir('events2'), 'nope')), { sessions: [] })
  })
})

describe('sessionEventsPayload', () => {
  test('返回全部原始事件，坏行标注 parse_error（白盒价值：append 什么就看到什么）', () => {
    const dir = tmpDir('events3')
    fs.writeFileSync(
      path.join(dir, 's-1.jsonl'),
      [
        JSON.stringify({ type: 'user', content: '第一句', ts: 1 }),
        '{bad json',
        JSON.stringify({ type: 'assistant', content: '回复', ts: 2 }),
      ].join('\n')
    )
    const payload = sessionEventsPayload('s-1', dir)
    assert.equal(payload.session, 's-1')
    assert.equal(payload.total, 3)
    assert.equal(payload.events[0].content, '第一句')
    assert.equal(payload.events[1].type, 'parse_error')
    assert.equal(payload.events[2].type, 'assistant')
  })

  test('sessionId 安全过滤（路径穿越防御）与缺失会话空态', () => {
    const dir = tmpDir('events4')
    const payload = sessionEventsPayload('../../etc/passwd', dir)
    assert.ok(!payload.session.includes('/'))
    assert.equal(payload.total, 0)
    assert.deepEqual(sessionEventsPayload('ghost', dir), { session: 'ghost', total: 0, events: [] })
  })
})

// ===== 路由 =====

describe('dashboard 路由', () => {
  function mockRes() {
    return {
      statusCode: null,
      body: null,
      writeHead(status) {
        this.statusCode = status
      },
      end(body) {
        this.body = body
      },
    }
  }

  test('GET /api/eval/cases 返回测试集 JSON', () => {
    const res = mockRes()
    handleRequest({ method: 'GET', url: '/api/eval/cases' }, res)
    assert.equal(res.statusCode, 200)
    const body = JSON.parse(res.body)
    assert.ok(body.count >= 0)
    assert.ok(Array.isArray(body.cases))
  })

  test('GET /api/events 不带 session 参数返回空态而非 500', () => {
    const res = mockRes()
    handleRequest({ method: 'GET', url: '/api/events' }, res)
    assert.equal(res.statusCode, 200)
    assert.deepEqual(JSON.parse(res.body), { session: '', total: 0, events: [] })
  })

  test('未知路径 404，非 GET 405', () => {
    const res404 = mockRes()
    handleRequest({ method: 'GET', url: '/api/nope' }, res404)
    assert.equal(res404.statusCode, 404)

    const res405 = mockRes()
    handleRequest({ method: 'POST', url: '/api/usage' }, res405)
    assert.equal(res405.statusCode, 405)
  })
})
