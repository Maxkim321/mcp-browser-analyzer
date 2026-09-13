<div align="center">

# 浏览器 AI 助手 · Browser AI Assistant

一个住在浏览器**侧边栏**里的 AI 助手：不切页面，就能总结网页、划词即问、围绕页面内容追问，甚至自动完成一次带来源的**深度研究**。内置**AI 代码审查**能力，可通过 GitHub Actions 自动对 PR 生成行级评论。

Chrome Extension（Vue3 + MV3） · Node.js Agent Server（DeepSeek + 自研 Agent 编排） · AI Code Review CLI

</div>

---

## ✨ 功能特性

| 分类 | 功能 | 说明 |
| --- | --- | --- |
| **核心交互** | 📄 一键总结本页 | Readability 提取正文 + 结构化 Prompt 模板 → 输出概括/要点/结论，标注来源 URL，回答可溯源 |
| | ✍️ 划词即问 | 选中文字弹出浮动工具条（翻译/解释/改写/总结/自由提问），Shadow DOM 隔离页面样式 |
| | 💬 多轮上下文对话 | 会话持久化（`chrome.storage.local` 分桶存储），历史会话可切换 |
| | ⚡ 流式输出 | SSE 增量解析 + WebSocket 分片推送，打字机效果；工具调用与文本输出同通道区分 |
| **深度研究** | 🔍 Deep Research | 自动规划子问题 → 后台静默多页读取 → 信息充分性评估 → 交叉对比 → 流式生成带来源报告；checkpoint 断点恢复；**分级 HITL**——正常路径全程连跑零打断，只在死胡同/预算告警时请求人工拍板（`hitlMode: on-deadend / every-topic / off`），可选计划确认（planReview）把方向调整前置到研究开始前 |
| **页面操作** | 🖱️ 写操作 + 分级权限审批 | Agent 可点击/填表/选下拉（`click_element`/`fill_input`/`select_option`）：读操作零打断，**每次写操作前推送审批卡片**（展示目标选择器与填入值），超时/断连默认拒绝；写动作预算封顶（默认 8 个/轮）+ dry-run 模式 + 审批/执行全链路审计落痕；执行前强制 `get_interactive_elements` 定位，禁止凭空构造选择器 |
| **模型路由** | 🎚️ 分级路由 + 多模型抽象 | Provider 适配层（当前 OpenAI 兼容协议，可扩展 Claude/Gemini）与模型选择解耦；调用点按任务标注 tier——grade 打分/检索词改写/上下文压缩走 light 便宜模型，plan/报告走 reasoning 档，未配置档位自动回落主模型；瞬时错误（限流/5xx/网络）自动指数退避重试 |
| **可靠性** | 🛑 可取消回答 | AbortController 支持随时停止生成，不浪费 token |
| | 📊 Step 级可观测 | 推理/工具执行进度实时下发前端，用户可看到 Agent 当前在做什么 |
| | 📝 事件溯源 | append-only JSONL 事件日志，服务重启自动投影重建上下文（断点续跑） |
| | 📦 上下文压缩 | token 预算 + 冷热分层滚动摘要，长会话不爆 context window；**派生视图架构**——raw 只追加不改写，压缩策略可插拔（rolling-summary/truncate/no-compress），tool_calls 消息组原子性有边界对齐保障 |
| **度量** | 📏 上下文压缩基准 | 自建保真度基准（埋事实点→压缩→考回）实测：滚动摘要保留率 **100%**、截断式仅 **23.3%**，视图 token 省 69%——策略选型靠数字不靠感觉 |
| | 📋 黄金评测集 | 固定 fixture + rubric 三层判分（字符串/正则/LLM-as-judge），`pnpm eval` 自动阅卷出成绩单，prompt/模型改动退化当场报警；**写操作轨迹判卷**——期望动作序列按相对顺序比对（工具/选择器/值），评测离线可复现 |
| | 🖥️ 评测台 + 白盒仪表盘 | `localhost:9999/dashboard` 三视图：**概览**（成本台账/压缩基准/评测基线/记忆 A-B/观测事件）+ **评测台**（测试集可浏览、逐 case 判卷明细、历史通过率趋势）+ **白盒飞行记录仪**（会话事件时间线逐条展开原始 JSON、进程观测流实时轮询） |
| | 💰 Token 成本账本 | 每次 LLM 调用（含 tier）落 JSONL 台账，`pnpm report` 按档位/模型汇总成本——分级路由的 ROI 有账可查 |
| | ⏱️ 工具流水线 | 统一权限校验 + 超时控制，为写操作审批预留挂载点 |
| **个性化** | 🎯 偏好记忆（L3） | 跨会话记住总结风格/翻译语言/回复风格，自动注入提示词 |
| | 🧠 浏览记忆 RAG（L4 阶段1） | 总结过的页面自动沉淀为记忆卡片（本地 JSONL 只追加），提问时 BM25 检索 top-3 注入上下文，回答自动带"📌 参考了你之前读过的 N 篇"引用标签——跨页面对比/追问旧内容可行；卡片规模 < 1 万暴力检索最优，阶段 2 预留 embedding 升级接口 |
| | 📚 文章收藏 | 收藏已总结的文章，支持回看检索 |
| **额外工具** | 📊 页面性能分析 | 双通道：插件采集 LCP 等实时指标 + 服务端 Lighthouse 完整审计（四类得分/核心指标/优化机会） |
| **🔧 AI 代码审查** | 💻 ai-code-review | 零依赖 CLI + GitHub Actions 自动触发，对 PR/MR 生成行级评论（安全漏洞/圈复杂度/命名规范），支持适配器模式扩展平台 |

## 🏗️ 架构

```
┌──────────────────────────── Chrome 扩展（Vue3 + MV3）────────────────────────────┐
│  SidePanel 侧边栏  ◀───▶  Background Service Worker  ◀───▶  Content Script        │
│  （对话 UI / 深度研究）     （消息路由 / 手势 API / 后台抓页）   （Readability + 划词工具条） │
│  ┌────────────────────────────────────────────────────────────────────────────┐   │
│  │  F5 偏好记忆 · F4 会话持久化（chrome.storage.local）                       │   │
│  └────────────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────┬──────────────────────────────────────────────┘
                                     │ WebSocket（:9999，requestId 异步匹配）
┌────────────────────────────────────▼──────────────────────────────────────────────┐
│                              Agent Server（Node.js）                              │
│  ┌────────────────────────────────────────────────────────────────────────────┐   │
│  │                    三层 Agent 编排（按任务复杂度选型）                        │   │
│  │  Prompt 模板（固定任务） │ ReAct 循环（开放对话） │ 深度研究状态机（plan→    │   │
│  │  · 总结/翻译/改写        │ · 模型选工具→执行→回喂 │ research→compare→report） │   │
│  └────────────────────────────────────────────────────────────────────────────┘   │
│  ┌────────────────────────────────────────────────────────────────────────────┐   │
│  │  dph 可靠性增强层（对标 DeepSeek Harness 2026）                            │   │
│  │  · dph-A: Turn/Step 执行模型（可观测 + AbortController 取消）               │   │
│  │  · dph-B: 事件溯源日志（append-only，断点续跑）                             │   │
│  │  · dph-C: 上下文压缩（token 预算 + 冷热分层滚动摘要）                        │   │
│  │  · dph-D: 工具执行流水线（权限/超时统一 hook，写操作审批预留）               │   │
│  └────────────────────────────────────────────────────────────────────────────┘   │
│  LLM 客户端（SSE 流式解析 + Function Calling） · 工具封装（schema/handler/传输）   │
└────────────────────────────────────┬──────────────────────────────────────────────┘
                                     │ OpenAI 兼容接口
                              ┌──────▼──────┐
                              │  DeepSeek   │
                              └─────────────┘
```

### 关键设计决策

- **三层编排**：固定任务用 Prompt 模板保证结构化输出；开放对话走 ReAct 循环灵活调用工具；深度研究用自研状态机（对齐 LangGraph 四概念：State/节点/条件边/checkpoint/HITL），~200 行零依赖可单测
- **记忆分层**：L0 当前上下文 → L1 会话历史 → L2 滚动摘要 → L3 偏好 KV，不盲目上向量检索
- **ai-code-review 适配器模式**：核心审查逻辑与平台解耦，Mock/GitHub/GitLab 三种适配器可插拔
- **Skills 可插拔**：安全审查/复杂度检查/命名规范各成模块，precheck（确定性扫描）+ LLM 审查双层保障

## 🚀 快速开始

### 环境要求

- Node.js >= 20
- pnpm >= 9

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置 Agent Server

在 `agent-server` 目录下创建 `.env`：

```bash
cd agent-server
```

```env
ARK_API_KEY=你的DeepSeek API密钥
ARK_BASE_URL=https://api.deepseek.com
ARK_MODEL=deepseek-chat
```

可选：配置轻量档模型（分级路由用——打分/检索词改写/上下文压缩走 light 档省钱，不配置则自动回落主模型）：

```env
LLM_LIGHT_MODEL=kimi-k2.7-code
LLM_LIGHT_BASE_URL=你的OpenAI兼容接口地址
LLM_LIGHT_API_KEY=对应密钥
```

### 3. 启动 Agent Server（监听 :9999）

```bash
pnpm agent-server
```

或进入 `agent-server` 目录直接 `npm start`。

### 4. 构建并加载 Chrome 插件

```bash
pnpm extension:build   # 一次性构建插件（产物在 chrome-extension/extension/dist）
pnpm extension         # watch 模式，改代码自动重构建
```

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」，选择 `chrome-extension/extension` 目录（即 `manifest.json` 所在层）
4. 点击扩展图标 → 打开侧边栏，即可开始使用

### 5. 测试与质量保障

```bash
pnpm test             # 108 个单测（node:test 零依赖），锁编排层行为不变量
pnpm eval             # 黄金评测集：10 个 case 端到端阅卷出成绩单（离线可复现）
pnpm eval:memory      # 浏览记忆 A/B 对照：recall@3 / 记忆增益 Δ
pnpm bench            # 压缩保真度基准：滚动摘要 vs 截断 vs 不压缩
pnpm report           # Token 成本账本：按档位/模型汇总分级路由 ROI
```

评测与基准的产物落盘在 `agent-server/eval/results` 与 `agent-server/bench/results`；仪表盘 `localhost:9999/dashboard` 只读这些产物展示（dashboard 不生产数字，只呈现数字）。

---

## 💻 AI Code Review（独立 CLI）

零依赖 Node.js CLI，可通过 GitHub Actions 自动在 PR 上生成行级评论：

- **安全审查**：SQL 注入、硬编码密钥、危险函数调用（eval/exec）等
- **复杂度检查**：圈复杂度过高提示拆分
- **命名规范**：变量/函数命名问题
- **适配器模式**：支持 GitHub（行级评论）、GitLab（MR 讨论）、Mock（终端打印）

### 手动使用

```bash
cd ai-code-review
node bin/ai-cr.mjs --platform github --repo <owner>/<repo> --pr <number> --post
```

### GitHub Actions 自动触发

已配置 `.github/workflows/ai-cr.yml`，PR 创建/更新时自动执行审查并回贴评论。需在仓库 Secrets 配置：
- `GITHUB_TOKEN`：带 Pull requests: Read and write 和 Contents: Read and write 权限
- `ARK_API_KEY`：DeepSeek API 密钥

Mock 演示：
```bash
cd ai-code-review
npm run review:sample
```

详见 [ai-code-review/README.md](ai-code-review/README.md)。

## 🛠️ 技术栈

| 分类 | 技术 |
| --- | --- |
| 浏览器扩展 | Chrome Extension MV3 · SidePanel · Service Worker · Content Script（Isolated World） |
| 前端 UI | Vue 3 + Vite |
| 正文提取 | @mozilla/readability（失败降级 body.innerText） |
| Agent 编排 | 自研三层编排：Prompt 模板 / ReAct 循环 / 深度研究状态机（对齐 LangGraph 四概念） |
| 可靠性增强 | dph-A/B/C/D（Turn-Step模型/事件溯源/上下文压缩/工具流水线） |
| LLM | DeepSeek（OpenAI 兼容接口，Function Calling + SSE 流式） |
| 通信 | WebSocket（ws）· requestId 异步请求-响应匹配 + 超时兜底 |
| AI 代码审查 | 零依赖 Node ESM · 适配器模式 · Skills 可插拔 · GitHub API |
| 测试 | node:test（零依赖原生 runner） |

## 📁 项目结构

```
├── chrome-extension/          # Chrome 插件（Vue3 + MV3）
│   ├── src/background/        #   Service Worker（消息路由 / 后台抓页）
│   ├── src/content-script/    #   页面正文提取（Readability）+ 划词工具条
│   ├── src/ui/sidepanel/      #   侧边栏对话 UI（含深度研究交互）
│   └── src/utils/             #   prefs.js（F5偏好记忆）· markdown.js · base.js
├── agent-server/              # Agent 服务（Node.js + WebSocket）
│   ├── src/core/              #   agent.js（ReAct + dph-A）· workflow.js（深度研究状态机）
│   │                          #   event-log.js（dph-B 事件溯源）· context-manager.js（dph-C 上下文压缩）
│   │                          #   tool-pipeline.js（dph-D 工具流水线）· llm.js（SSE流式）
│   ├── src/tools/             #   工具 schema + handler（fetch_url / get_page_content / ...）
│   ├── src/communication/     #   WS 服务 + 消息路由
│   ├── src/config/            #   prompts.js（模板提示词）· index.js
│   └── test/                  #   node:test 单测
├── ai-code-review/            # AI 代码审查独立 CLI（零依赖 Node ESM）
│   ├── bin/ai-cr.mjs          #   CLI 入口
│   ├── src/adapters/          #   平台适配器（mock/github/gitlab）
│   ├── src/skills/            #   审查技能（security/complexity/naming）
│   └── .github/workflows/     #   GitHub Actions 自动触发配置
└── pnpm-workspace.yaml
```

## 🗺️ Roadmap

### ✅ 已完成
- **M0**：页面总结 · 流式输出 · 划词即问 · 轻量页面上下文 · 会话持久化
- **M1-F5**：偏好记忆（L3 KV）· 文章收藏
- **M1-F8**：深度研究（自研状态机 + checkpoint 断点恢复 + HITL 人工介入）
- **dph 可靠性层**：Turn/Step 可观测可取消 · 事件溯源断点续跑 · 上下文冷热压缩 · 工具流水线
- **AI 代码审查**：零依赖 CLI · GitHub/GitLab 适配器 · GitHub Actions 自动触发 · PR 行级评论

### 🔜 进行中 / 未来
- **M1 剩余**：会话管理补全（重命名/删除/搜索）· 结构化提取
- **M2**：写操作（Computer Use，含权限审批流水线）· MCP Client / WebMCP 接入第三方工具生态
- ~~**L4 记忆**：RAG 检索~~ → **已完成阶段 1**：浏览记忆卡片库 + BM25 检索（阶段 2 预留 embedding 升级接口，规模 < 1 万条时暴力检索最优）

## 📄 License

MIT
