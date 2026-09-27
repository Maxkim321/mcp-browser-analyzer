/**
 * 深度研究子 agent A/B 基准（P6）
 *
 * 用法：
 *   node bench/subagent-ab.bench.js --scenario=shallow              # 浅问题两臂对照（默认）
 *   node bench/subagent-ab.bench.js --scenario=deep                 # 深问题两臂对照
 *   node bench/subagent-ab.bench.js --scenario=deep --arm=router    # 单跑路由臂（auto 模式，
 *                                                                   # 若两臂结果文件存在则输出三方对比）
 *
 * 与 compression.bench.js 同一基准哲学：工具层 mock（离线可复现、消除真实网络噪声），
 * LLM 真实调用（延迟/token/产出都是真数字）。对照臂跑同一个研究问题、同一组硬约束，
 * 唯一差异是路由模式。
 *
 * 口径声明（写报告时必须带）：
 * - 工具零延迟 mock → 墙钟主要反映 LLM 串行往返数；
 *   老管线"逐页串行真实抓页"的墙钟劣势在离线基准里被低估（worker 并行批抓的优势没体现）
 * - 单次运行有模型随机性，数字是量级参考；要更稳可多跑几轮取中位数
 * - 防先验泄漏（deep）：关键事实是**编造协议的非默认数字**（gossip 间隔 47 秒），
 *   模型蒙不对，命中只能来自多跳抓取——与记忆 A/B 的 k1=1.2 同一纪律
 */
const fs = require('fs')
const path = require('path')
const os = require('os')

// TRACE_FILE 指向临时文件（必须在 require workflow 之前，trace-log 模块加载时读取）
process.env.TRACE_FILE = path.join(os.tmpdir(), `trace-subagent-bench-${Date.now()}.jsonl`)

require('dotenv').config({ path: path.join(__dirname, '..', '.env') })
const handler = require('../src/tools/handler.js')
const { setUsageSink } = require('../src/core/llm-providers.js')
const { LLMClient } = require('../src/core/llm.js')
const { ResearchWorkflow } = require('../src/core/workflow.js')

const RESULTS_DIR = path.join(__dirname, 'results')

// ===== 场景定义 =====

const SCENARIOS = {
  // 浅问题：搜索结果首页就直接包含答案，旧管线 grade 首页即充分早停
  shallow: {
    question: 'MCP（Model Context Protocol）是什么？它的核心概念和生态现状如何？',
    links: [
      { title: 'MCP 入门', url: 'https://fixture.local/mcp-overview' },
      { title: 'MCP 工具与能力', url: 'https://fixture.local/mcp-tools' },
      { title: 'MCP 生态现状', url: 'https://fixture.local/mcp-ecosystem' },
    ],
    pages: {
      'https://fixture.local/mcp-overview':
        'MCP（Model Context Protocol）是 Anthropic 于 2024 年 11 月发布的开放协议，' +
        '目标是统一 LLM 应用与外部数据源、工具之间的连接方式，把 M×N 的集成问题变成 M+N。' +
        '协议基于 JSON-RPC 2.0，定义了三类原语：tools（模型可调用的工具）、resources（应用可读取的数据）、' +
        'prompts（服务端预置的提示词模板）。传输层支持 stdio（本地进程）与 Streamable HTTP（远程服务）。' +
        'MCP 的设计哲学是"一次实现、处处可用"：服务端只要实现一次 MCP，就能被所有支持 MCP 的客户端调用。',
      'https://fixture.local/mcp-tools':
        'MCP 的 tools 原语让服务端向模型暴露可执行能力，每个工具带 JSON Schema 描述输入输出。' +
        'resources 原语提供只读数据（文件、数据库记录、API 响应），客户端通过 URI 寻址。' +
        'prompts 原语是服务端预置的参数化提示词模板，用户可显式选择。' +
        '协议还有 sampling 能力：服务端可以反过来请求客户端的 LLM 完成一次推理，保持人在环审批。' +
        '安全模型上，MCP 要求用户对每个工具调用显式授权，客户端负责审批 UI 与审计日志。',
      'https://fixture.local/mcp-ecosystem':
        '生态现状：Anthropic、OpenAI、Google 在 2025 年相继宣布支持 MCP，主流 IDE（Cursor、VS Code、Claude Code）' +
        '都已内置客户端能力。社区服务端数量超过一万个，覆盖数据库、浏览器自动化、云服务等场景。' +
        '争议点：协议演进速度快、规范版本碎片化；安全审计发现部分第三方服务端存在工具投毒（tool poisoning）风险；' +
        '与 OpenAI 自有函数调用格式的兼容层仍在磨合。总体判断：MCP 已成为 LLM 工具生态事实标准，但治理仍在早期。',
    },
    judge: null, // 无单点事实可判，质量靠人工/后续 judge
  },

  // 深问题：答案只存在于搜索结果之外的"规范页"。搜索结果页只说"详见规范"并给出 URL——
  // 旧管线的抓取目标永远来自搜索结果（结构性够不到规范页）；worker 可以读页 → 发现引用 → 多跳过去。
  // 关键事实 47 秒是编造协议的非默认数字：模型蒙不对，命中只能来自多跳。
  deep: {
    question:
      'HarmonyMesh 协议 v2.3 规范中定义的默认 gossip 同步间隔是多少秒？',
    links: [
      { title: 'HarmonyMesh 协议概述', url: 'https://fixture.local/harmonymesh-intro' },
      { title: 'HarmonyMesh 与同类协议对比', url: 'https://fixture.local/harmonymesh-compare' },
      { title: 'HarmonyMesh 常见问题', url: 'https://fixture.local/harmonymesh-faq' },
    ],
    pages: {
      'https://fixture.local/harmonymesh-intro':
        'HarmonyMesh 是一个面向边缘设备的去中心化节点发现与数据同步协议，2024 年由 OpenMesh 工作组发布。' +
        '它采用 gossip（流言）传播模型做节点间状态同步，节点无需中心服务器即可收敛到一致视图。' +
        '协议的运行参数——包括 gossip 同步间隔、重试退避、分区重组阈值——全部由 v2.3 规范统一约束，' +
        '完整参数定义见规范原文：https://fixture.local/harmonymesh-spec-v23 。' +
        'HarmonyMesh 的设计目标是弱网环境下的最终一致性，适用于 IoT 网关与车载网络。',
      'https://fixture.local/harmonymesh-compare':
        '与同类协议对比：相比 SWIM，HarmonyMesh 的成员失效检测是被动推断式的，不主动探测；' +
        '相比 gossip 协议的经典实现（如 Cassandra 的祖传 gossip），HarmonyMesh 把同步节奏做成协议级可协商参数，' +
        '而不是节点本地配置——这保证了异构设备网络的收敛可预测。' +
        '三个协议的详细参数对比矩阵收录在 v2.3 规范附录 B（https://fixture.local/harmonymesh-spec-v23）。',
      'https://fixture.local/harmonymesh-faq':
        '常见问题：HarmonyMesh 支持多少节点规模？工作组公开的测试上限是 4096 节点。' +
        '是否兼容 IPv6？v2.3 起原生支持。gossip 同步间隔可以自己改吗？' +
        '不可以——间隔是规范强约束参数，各厂商实现必须一致，具体数值以规范为准：' +
        'https://fixture.local/harmonymesh-spec-v23 。如何加入 OpenMesh 工作组？通过季度提案窗口申请。',
      // 规范页：不在搜索结果里，只有多跳才能到达。47 秒是编造的非默认数字（防先验蒙对）。
      'https://fixture.local/harmonymesh-spec-v23':
        'HarmonyMesh 协议规范 v2.3（HarmonyMesh-SP-V2.3）——OpenMesh 工作组。' +
        '§4.2 同步节奏：默认 gossip 同步间隔为 47 秒；该值是规范强约束，实现不得自行调整，' +
        '设备时钟漂移超过 ±3 秒时须以规范值为准重新对齐。' +
        '§4.3 失效检测：被动推断窗口为间隔的 6 倍。' +
        '§5.1 分区重组：重组阈值 128 节点。附录 B：与 SWIM/Cassandra gossip 的参数对比矩阵。',
    },
    // 确定性判分：报告必须命中编造事实"47 秒"且提及 gossip（防先验蒙对：模型蒙不出 47）
    judge: (report) => {
      const text = String(report || '')
      const hit47 = /47\s*秒/.test(text)
      const hitGossip = /gossip/i.test(text)
      const citedSpec = /harmonymesh-spec-v23/.test(text)
      return {
        pass: hit47 && hitGossip,
        detail: `47秒命中=${hit47} gossip提及=${hitGossip} 规范页引用=${citedSpec}`,
      }
    },
  },
}

function setupToolOverrides(scenario) {
  const counts = {
    web_search: 0,
    fetch_url: 0,
    fetchUrls: [], // 逐条记录抓了哪些 URL（多跳证据：规范页是否被到达）
  }
  handler.init({ manager: { send: () => {} } })
  handler.setToolOverrides({
    web_search: async (args) => {
      counts.web_search++
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              query: args.query,
              engine: 'bing',
              results: scenario.links,
            }),
          },
        ],
      }
    },
    fetch_url: async (args) => {
      counts.fetch_url++
      counts.fetchUrls.push(args.url)
      const content = scenario.pages[args.url] || '（fixture 无此页面正文）'
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              url: args.url,
              title: scenario.links.find((l) => l.url === args.url)?.title || args.url,
              content,
              charCount: content.length,
            }),
          },
        ],
      }
    },
  })
  return counts
}

// ===== 单臂执行 =====

async function runArm(mode, scenario) {
  const usage = []
  setUsageSink((info) => usage.push(info))
  const counts = setupToolOverrides(scenario)
  const nodes = []
  const t0 = Date.now()

  // mode: false=旧管线 | true=全子 agent | 'auto'=按 depth 路由 + 升级兜底
  const workflowOptions =
    mode === 'auto'
      ? { routingMode: 'auto', maxTopics: 2, maxPagesPerTopic: 3, maxAttempts: 2, checkpoint: false }
      : { subagentMode: mode, maxTopics: 2, maxPagesPerTopic: 3, maxAttempts: 2, checkpoint: false }
  const workflow = new ResearchWorkflow(new LLMClient(), workflowOptions)
  const result = await workflow.start(scenario.question, {
    connectionId: 1,
    onProgress: (p) => {
      if (p.node) nodes.push(p.node)
    },
  })
  const wallMs = Date.now() - t0

  // 路由决策回读（trace 落痕）：每主题走了哪条管线、升级是否发生/救回
  let routing = []
  try {
    routing = fs
      .readFileSync(process.env.TRACE_FILE, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l)
        } catch {
          return null
        }
      })
      .filter(
        (e) =>
          e &&
          (e.type === 'research_routed' ||
            e.type === 'research_escalated' ||
            e.type === 'research_escalated_result')
      )
      .map((e) => ({
        type: e.type,
        topicIndex: e.topicIndex,
        depth: e.depth,
        pipeline: e.pipeline,
        rescued: e.rescued,
      }))
  } catch {
    routing = []
  }

  const promptTokens = usage.reduce((a, u) => a + (u.prompt_tokens || 0), 0)
  const completionTokens = usage.reduce((a, u) => a + (u.completion_tokens || 0), 0)
  const report = result.state?.report || ''
  const judge = scenario.judge ? scenario.judge(report) : null
  return {
    mode: mode === 'auto' ? 'router' : mode ? 'subagent' : 'legacy',
    success: result.success === true,
    wallMs,
    llmCalls: usage.length,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    toolCalls: { web_search: counts.web_search, fetch_url: counts.fetch_url },
    fetchedUrls: counts.fetchUrls,
    topics: (result.state?.plan || []).map((t) => ({
      question: t.question,
      sufficient: t.sufficient,
      points: t.points.length,
    })),
    evidence: (result.state?.evidence || []).length,
    sources: (result.state?.sources || []).length,
    reportChars: report.length,
    reportSnippet: report.slice(0, 600),
    judge,
    routing,
  }
}

// ===== 主流程 =====

function parseArgs() {
  let scenario = 'shallow'
  let arm = 'ab' // 'ab'=两臂对照（默认）| 'router'=单跑路由臂（auto）
  process.argv.slice(2).forEach((a) => {
    if (a.startsWith('--scenario=')) scenario = a.split('=')[1]
    if (a.startsWith('--arm=')) arm = a.split('=')[1]
  })
  if (!SCENARIOS[scenario]) {
    console.error(`未知场景：${scenario}（可选：${Object.keys(SCENARIOS).join(' / ')}）`)
    process.exit(1)
  }
  return { scenario, arm }
}

async function main() {
  if (!process.env.ARK_API_KEY) {
    console.error('缺少 ARK_API_KEY（bench 需要 LLM 真实调用）')
    process.exit(1)
  }
  const { scenario: scenarioName, arm } = parseArgs()
  const scenario = SCENARIOS[scenarioName]
  const suffix = scenarioName === 'shallow' ? '' : `-${scenarioName}`

  // ===== router 臂：单跑 auto 路由，与已存两臂数字拼三方对比 =====
  if (arm === 'router') {
    console.log(`[router/${scenarioName}] 问题：${scenario.question}`)
    console.log(`[router/${scenarioName}] 跑路由臂（RESEARCH_ROUTING=auto 语义）...`)
    const router = await runArm('auto', scenario)
    console.log(
      `[router/${scenarioName}] 完成：${router.wallMs}ms, ${router.llmCalls} 次 LLM 调用, ${router.totalTokens} tokens`
    )
    console.log(`[router/${scenarioName}] 路由决策：`, JSON.stringify(router.routing))

    const prevPath = path.join(RESULTS_DIR, `subagent-ab${suffix}.json`)
    const prev = fs.existsSync(prevPath) ? JSON.parse(fs.readFileSync(prevPath, 'utf8')) : null
    const arms = [prev?.legacy, prev?.subagent, router].filter(Boolean)
    const withJudge = Boolean(scenario.judge)

    fs.mkdirSync(RESULTS_DIR, { recursive: true })
    fs.writeFileSync(
      path.join(RESULTS_DIR, `subagent-ab-router${suffix}.json`),
      JSON.stringify(
        {
          date: new Date().toISOString(),
          scenario: scenarioName,
          router,
          prevFixed: prev ? { legacy: prev.legacy, subagent: prev.subagent } : null,
        },
        null,
        2
      )
    )
    const md = `# 研究管线路由三方对比——${scenarioName} 场景（P6 auto）

> ${new Date().toISOString()} · 问题：${scenario.question}
> router 臂 = RESEARCH_ROUTING=auto（plan 标注 depth 分流 + 死胡同升级兜底），单次运行。
> 路由决策：${JSON.stringify(router.routing)}

| 臂 | 墙钟(ms) | LLM调用 | 总tokens | 充分主题${withJudge ? ' | 事实命中' : ''} |
|---|---|---|---|---|${withJudge ? '---|' : ''}${arms
      .map(
        (a) =>
          `\n| ${a.mode} | ${a.wallMs} | ${a.llmCalls} | ${a.totalTokens} | ${a.topics.filter((t) => t.sufficient).length}/${a.topics.length}${withJudge ? ` | ${a.judge?.pass === true ? '✓' : '✗'}` : ''} |`
      )
      .join('')}
`
    fs.writeFileSync(path.join(RESULTS_DIR, `subagent-ab-router${suffix}-report.md`), md)
    console.table(
      arms.map((a) => ({
        臂: a.mode,
        墙钟ms: a.wallMs,
        LLM调用: a.llmCalls,
        总tokens: a.totalTokens,
        充分主题: `${a.topics.filter((t) => t.sufficient).length}/${a.topics.length}`,
        ...(withJudge ? { 事实命中: a.judge?.pass === true } : {}),
      }))
    )
    console.log(`报告已写入 bench/results/subagent-ab-router${suffix}-report.md`)
    return
  }

  console.log(`[A/B/${scenarioName}] 问题：${scenario.question}`)
  console.log(`[A/B/${scenarioName}] 第一臂：旧管线（subagentMode=off）...`)
  const legacy = await runArm(false, scenario)
  console.log(
    `[A/B/${scenarioName}] 旧管线完成：${legacy.wallMs}ms, ${legacy.llmCalls} 次 LLM 调用, ${legacy.totalTokens} tokens`
  )
  console.log(`[A/B/${scenarioName}] 第二臂：子 agent 模式（subagentMode=on）...`)
  const sub = await runArm(true, scenario)
  console.log(
    `[A/B/${scenarioName}] 子 agent 完成：${sub.wallMs}ms, ${sub.llmCalls} 次 LLM 调用, ${sub.totalTokens} tokens`
  )

  const report = {
    date: new Date().toISOString(),
    scenario: scenarioName,
    question: scenario.question,
    caveat:
      '工具零延迟 mock（离线可复现）：墙钟主要反映 LLM 串行往返；老管线真实抓页的串行延迟未计入，worker 并行批抓优势被低估。单次运行，模型随机性存在。deep 场景关键事实为编造协议的非默认数字（防先验蒙对）。',
    legacy,
    subagent: sub,
    delta: {
      wallMsPct: Math.round(((sub.wallMs - legacy.wallMs) / legacy.wallMs) * 100),
      llmCallsDelta: sub.llmCalls - legacy.llmCalls,
      tokensPct: Math.round(((sub.totalTokens - legacy.totalTokens) / legacy.totalTokens) * 100),
      promptTokensPct: Math.round(
        ((sub.promptTokens - legacy.promptTokens) / legacy.promptTokens) * 100
      ),
      completionTokensPct: Math.round(
        ((sub.completionTokens - legacy.completionTokens) / legacy.completionTokens) * 100
      ),
    },
  }

  fs.mkdirSync(RESULTS_DIR, { recursive: true })
  fs.writeFileSync(
    path.join(RESULTS_DIR, `subagent-ab${suffix}.json`),
    JSON.stringify(report, null, 2)
  )

  const judgeRow = scenario.judge
    ? `| 关键事实命中 | ${legacy.judge.pass ? '✓' : '✗'}（${legacy.judge.detail}） | ${sub.judge.pass ? '✓' : '✗'}（${sub.judge.detail}） | — |\n| 规范页到达 | ${legacy.fetchedUrls.includes('https://fixture.local/harmonymesh-spec-v23') ? '✓' : '✗'}（结构上不可达） | ${sub.fetchedUrls.includes('https://fixture.local/harmonymesh-spec-v23') ? '✓' : '✗'}（多跳） | — |\n`
    : ''
  const md = `# 子 agent A/B 基准——${scenarioName} 场景（P6）

> ${report.date} · 问题：${scenario.question}
> 口径：工具零延迟 mock（离线可复现），LLM 真实调用；墙钟主要反映 LLM 串行往返数，
> 老管线真实抓页的串行墙钟劣势未计入。单次运行，存在模型随机性。

| 指标 | 旧管线 | 子 agent | 差异 |
|---|---|---|---|
| 墙钟（ms） | ${legacy.wallMs} | ${sub.wallMs} | ${report.delta.wallMsPct > 0 ? '+' : ''}${report.delta.wallMsPct}% |
| LLM 调用次数 | ${legacy.llmCalls} | ${sub.llmCalls} | ${report.delta.llmCallsDelta > 0 ? '+' : ''}${report.delta.llmCallsDelta} |
| prompt tokens | ${legacy.promptTokens} | ${sub.promptTokens} | ${report.delta.promptTokensPct > 0 ? '+' : ''}${report.delta.promptTokensPct}% |
| completion tokens | ${legacy.completionTokens} | ${sub.completionTokens} | ${report.delta.completionTokensPct > 0 ? '+' : ''}${report.delta.completionTokensPct}% |
| 总 tokens | ${legacy.totalTokens} | ${sub.totalTokens} | ${report.delta.tokensPct > 0 ? '+' : ''}${report.delta.tokensPct}% |
| 工具调用（search/fetch） | ${legacy.toolCalls.web_search}/${legacy.toolCalls.fetch_url} | ${sub.toolCalls.web_search}/${sub.toolCalls.fetch_url} | — |
| 主题充分度 | ${legacy.topics.map((t) => (t.sufficient ? '✓' : '✗')).join(' ')} | ${sub.topics.map((t) => (t.sufficient ? '✓' : '✗')).join(' ')} | — |
| 要点/证据/来源 | ${legacy.topics.reduce((a, t) => a + t.points, 0)} / ${legacy.evidence} / ${legacy.sources} | ${sub.topics.reduce((a, t) => a + t.points, 0)} / ${sub.evidence} / ${sub.sources} | — |
${judgeRow}
## 主题明细

| 臂 | 子问题 | 充分 | 要点数 |
|---|---|---|---|
${legacy.topics.map((t) => `| 旧管线 | ${t.question} | ${t.sufficient ? '✓' : '✗'} | ${t.points} |`).join('\n')}
${sub.topics.map((t) => `| 子 agent | ${t.question} | ${t.sufficient ? '✓' : '✗'} | ${t.points} |`).join('\n')}
`
  fs.writeFileSync(path.join(RESULTS_DIR, `subagent-ab${suffix}-report.md`), md)

  console.log(`\n===== A/${scenarioName === 'shallow' ? 'B' : 'B'}/${scenarioName} 结果 =====`)
  console.table({
    墙钟ms: { 旧管线: legacy.wallMs, 子agent: sub.wallMs },
    LLM调用: { 旧管线: legacy.llmCalls, 子agent: sub.llmCalls },
    总tokens: { 旧管线: legacy.totalTokens, 子agent: sub.totalTokens },
    充分主题数: {
      旧管线: legacy.topics.filter((t) => t.sufficient).length,
      子agent: sub.topics.filter((t) => t.sufficient).length,
    },
    ...(scenario.judge
      ? {
          关键事实命中: { 旧管线: legacy.judge.pass, 子agent: sub.judge.pass },
        }
      : {}),
  })
  console.log(`报告已写入 bench/results/subagent-ab${suffix}-report.md`)
}

main().catch((e) => {
  console.error('[A/B] 失败：', e)
  process.exit(1)
})
