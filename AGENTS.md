# AGENTS.md — mcp-browser-analyzer 项目交接文档（给 AI 代理的项目入口）

> 本文件是 AI 代理（ZCode/Cursor/Trae/Codex 等）进入本项目的统一上下文。改代码前先读完。
> 最后更新：2026-09-27（P8 混合检索 + P9 MCP 真接入交付后）。

## 1. 项目定位

独立开源的**浏览器 AI Agent 插件**：Vue3 MV3 扩展 + Node.js 服务端。支持总结/划词问答/深度研究/性能审计/跨页面记忆/外部工具接入（MCP）。差异化不在"又一个总结插件"，而在 **Agent 可靠性工程**（三层编排、分级 HITL、事件溯源、上下文压缩、注入防护、成本台账）+ **MCP 宿主治理**。

## 2. 仓库结构（pnpm monorepo）

```
mcp-browser-analyzer/
├── chrome-extension/          # MV3 扩展（Vue3 + vite）
│   ├── src/ui/sidepanel/      # 侧边栏主 UI（SidePanel.vue：聊天/审批卡/引用标签/用量条）
│   ├── src/background/        # service worker（消息路由；注意：WS 连接由侧边栏持有，不由 SW）
│   ├── src/content-script/    # Readability 正文提取 + 划词工具条（Shadow DOM closed）
│   └── extension/             # ⚠️ 构建产物+manifest（vite 插件生成）——这是 --load-extension 的加载根目录
├── agent-server/              # Node.js 服务端（CommonJS，端口 9999，WS+Dashboard 同端口）
│   ├── src/core/              # agent.js(ReAct循环) workflow.js(研究状态机) context-manager(压缩)
│   │                          # approval.js(分级审批) event-log.js(事件溯源+seq) injection-guard.js(注入防护)
│   │                          # llm.js+llm-providers.js(分级路由+Provider适配) usage-*(成本台账) trace-log.js
│   ├── src/tools/             # index.js(15个内置工具+registerDynamicTool) handler.js(分发)
│   │                          # mcp-registry.js(MCP纳管三道闸) lighthouse.js
│   ├── src/memory/            # store.js(卡片JSONL) retrieve.js(BM25) embedder.js(两级Embedder)
│   │                          # vector-store.js(向量JSONL+cardKey) rrf.js(RRF融合) hybrid.js(编排4模式)
│   │                          # embed-sync.js(回填CLI) wire.js(读写接线，recallForPrompt 为 async)
│   ├── src/mcp/client.js      # MCP Client（stdio+JSON-RPC 2.0，两代规范兼容）
│   ├── src/communication/     # ws-server.js（WS 消息主循环）
│   ├── eval/                  # run-eval.js(黄金评测) run-memory-ab.js(记忆A/B) run-hybrid-ab.js(三路对照)
│   │                          # fixtures/ results/（所有数字必须来自 results/ 真实产物）
│   ├── test/                  # node:test 单测 158 个（零网络；LLM/工具走 mock/override）
│   ├── mcp-demo.js / mcp-e2e.js / mcp-e2e 全真验证脚本（见 §5）
├── ai-code-review/            # 零依赖 AI 代码审查 CLI（github/gitlab/mock adapters）
└── docs/                      # PRD/TECHNICAL/RETROSPECT 等早期文档
```

**仓库外文档**（不在本仓库，勿找不到）：`Desktop/mcp/面试总集-唯一必读.md`（面试总文档，唯一背诵对象）、`Desktop/mcp/项目技术文档-进展与升级计划.md`（P0-P9 逐功能设计文档）、`Desktop/mcp/简历改版-2026-09-27.md`。

## 3. 功能清单与关键数字（全部有 results/ 真实产物支撑）

| 编号 | 功能 | 关键文件 | 核心数字 |
|---|---|---|---|
| P0 | 黄金评测集（规则+LLM-as-judge 两层判分） | eval/run-eval.js, golden/ | 10 case 基线（复跑存在 ±1 的 LLM 噪声带，失败 case 不固定） |
| P1 | 上下文压缩「raw 只追加+派生视图」 | core/context-manager.js | 保留率 100% vs 截断 23.3%；视图 token -68.6% |
| P2 | 分级模型路由 + 成本台账 | core/llm.js, llm-providers.js, usage-* | 总成本降至全强模型 20-30%；embedding 调用入账 tier=embedding |
| P3 | 浏览记忆 RAG（读写闭环） | memory/store.js, retrieve.js, wire.js | 卡片 ≥200 字入库；JSONL 追加式 |
| P4 | 分级权限写操作（HITL 审批卡） | core/approval.js, tool-pipeline.js | 读零打断/写逐次审批/单轮预算 8/超时=拒绝 |
| P5 | 白盒 Dashboard（评测台+飞行记录仪） | src/dashboard/, trace-log.js | 只读产物文件，不生产数字 |
| P6 | 深度研究子 agent + 事件 seq 主键 + auto 路由 | core/workflow.js, topic-agent.js, event-log.js | 浅题 legacy 优（×4.1/×8）、深题 worker 结构性胜出；auto 两场景路由全对 |
| P7 | Prompt injection 五层纵深 | core/injection-guard.js | 8 中英模式；检测不阻断（人审是决策点） |
| **P8** | **记忆混合检索（BM25+embedding RRF）** | memory/{embedder,vector-store,rrf,hybrid,embed-sync}.js | regression 三路 recall@3 全 100%；semantic 对抗集 bm25 25%→**hybrid 75%**（6/12 语义救援）；端到端 A/B Δ=100pct；2048 维（方舟 doubao-embedding-vision） |
| **P9** | **MCP 真接入（自研 Client+注册期治理）** | src/mcp/client.js, tools/mcp-registry.js, tools/index.js, handler.js | 官方 filesystem server 14 工具实测纳管；三道闸：注册期注入扫描（tool poisoning 防线）→ dangerLevel 自动定级（默认最危险）→ 走审批/溯源管线；三级验证（单测/集成/UI 层） |

## 4. 常用命令（都在 agent-server/ 下，除非注明）

```bash
pnpm test              # 全量单测 158/158（零网络，必须保持全绿）
pnpm eval              # 黄金评测（需 LLM key）
pnpm eval:memory       # 记忆 A/B（LLM；auto 模式下走 hybrid 检索）
pnpm eval:hybrid       # 混合检索三路对照（确定性判分，零 LLM 成本，需 EMBED_*）
pnpm embed:sync        # 存量卡片向量回填（幂等，需 EMBED_*）
pnpm bench / bench:subagent  # 压缩保真度 / 子 agent A/B 基准
pnpm start             # 启动服务端（WS 9999 + Dashboard /dashboard）
pnpm mcp:demo          # MCP 官方 filesystem server 注册演示
pnpm mcp:e2e           # MCP 全真集成测试（真 LLM+真 server+真磁盘，需 ARK_API_KEY）
node cdp-e2e.cjs       # 真 UI 级 e2e（需先按脚本头注释启动 Chrome for Testing + 服务端）
pnpm report            # 成本报表（eval/cost-report.js）
```

**环境变量**（agent-server/.env，.env.example 有说明）：`ARK_API_KEY/ARK_BASE_URL/ARK_MODEL`（主模型，实配 DeepSeek）、`LLM_LIGHT_*`（Kimi）、`EMBED_BASE_URL/EMBED_API_KEY/EMBED_MODEL`（方舟 doubao-embedding-vision，来自同账号）、`MEMORY_RETRIEVAL`（auto=配了 EMBED 即 hybrid，未配=纯 BM25 行为零变化）、`MCP_SERVERS`（JSON 数组，未配置不启动）。

## 5. MCP 全真验证环境（已跑通，可复现）

- 单元层：`test/mcp.test.js` + `test/fixtures/fake-mcp-server.cjs`（假 server，7 测试）
- 集成层：`mcp-e2e.js`——真 npx filesystem server + 真 LLM 决策 + 程序化审批 + 真磁盘断言；日志 `eval/results/mcp-e2e.log`
- UI 层：`cdp-e2e.cjs`（仓库根）——Chrome for Testing 154（**品牌 Chrome 137+ 已移除 --load-extension，必须用 CfT**，`npx @puppeteer/browsers install chrome@stable`）+ 真扩展侧边栏真实输入/真实点击「允许执行」；截图 `eval/results/ui-e2e-*.png`
- 架构事实：**WS 连接由侧边栏页面自身持有**（SidePanel.vue:1450），MV3 SW 休眠不影响；`handleToolCall` 有 WS 初始化门槛，脚本环境需 `handler.init({manager: stub})`（评测既有模式）

## 6. 工程约定（AI 代理改代码前必读）

1. **数字纪律**：文档/话术里的每个数字必须来自 `eval/results/` 真实产物；跑不出来就留 ⚠️ 占位，**禁止编造或手填**。
2. **交付仪式**：功能完成 → `pnpm test` 全绿 → eslint 0 → `pnpm eval` 不回退 → 回填技术文档（Desktop/mcp/项目技术文档-进展与升级计划.md 新 P 章节）→ 同步面试总集。
3. **零依赖原则**：不引向量库/重框架/LLM SDK；BM25、RRF、SSE 解析、MCP 客户端全部手写（各 ~100-200 行）。
4. **行为保持式重构**：改动不破坏既有行为时，用"存量测试零修改全绿"作为证据。
5. **测试模式**：LLM/工具 mock 注入；评测用 `setToolOverrides` + 子进程隔离（store.js 在 require 时固化 MEMORY_FILE）。
6. **已知坑**：① `store.append` 有 40 字摘要下限静默过滤；② config 在 require 时固化 env（dotenv 必须先 require）；③ 评测语料直写 JSONL 绕过 append 会没有 id——身份键一律用 `vector-store.cardKey(card)`（id 优先 url 兜底）；④ 品牌 Chrome 137+ 不支持 --load-extension。

## 7. 当前状态与待办

- **已完成**：P0-P9 全部（见 §3）；测试 158/158；eslint 0。
- **blocked**：P2 轻路线「以文搜图」——doubao-embedding-vision 图片向量：coding 端点只收纯文本、标准 api/v3 端点无权限（需方舟控制台开通后复测，检索管线已就绪）。
- **排队待办**：memory 卡片 keywords 字段 + 写卡去重；评测集加研究类 golden case（轨迹判卷扩展到子 agent 链路）；会话管理补全（重命名/删除/搜索）；MCP 工具分发门槛按来源分层（MCP 工具其实不依赖扩展连接）；RRF 通道置信度门控（对抗集上 bm25 被陷阱卡污染的改进方向）；跨主题并行（v2，会动 HITL 语义）。
- **不要做**：浏览器-as-MCP-Server（市场饱和，Playwright/Chrome DevTools MCP 已覆盖）。
- **下一步行动指南**：见仓库根 `TODO.md`——第二层 MCP server 接入测试方法（GitHub/Playwright/SQLite/Notion 逐个配置+测试用例）、第三层开发项（按优先级）、维护护栏（红线，违反=做错）。
