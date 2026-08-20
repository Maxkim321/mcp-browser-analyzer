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
| **深度研究** | 🔍 Deep Research | 自动规划子问题 → 后台静默多页读取 → 信息充分性评估 → 交叉对比 → 流式生成带来源报告；支持**人工介入（HITL）**调整方向，checkpoint 断点恢复 |
| **可靠性** | 🛑 可取消回答 | AbortController 支持随时停止生成，不浪费 token |
| | 📊 Step 级可观测 | 推理/工具执行进度实时下发前端，用户可看到 Agent 当前在做什么 |
| | 📝 事件溯源 | append-only JSONL 事件日志，服务重启自动投影重建上下文（断点续跑） |
| | 📦 上下文压缩 | token 预算 + 冷热分层滚动摘要，长会话不爆 context window |
| | ⏱️ 工具流水线 | 统一权限校验 + 超时控制，为写操作审批预留挂载点 |
| **个性化** | 🎯 偏好记忆（L3） | 跨会话记住总结风格/翻译语言/回复风格，自动注入提示词 |
| | 📚 文章收藏 | 收藏已总结的文章，支持回看检索 |
| **额外工具** | 📊 页面性能分析 | 采集 LCP 等性能指标，供 AI 分析优化建议 |
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

### 3. 启动 Agent Server（监听 :9999）

```bash
pnpm agent-server
```

或进入 `agent-server` 目录直接 `npm start`。

### 4. 构建并加载 Chrome 插件

```bash
pnpm extension        # 构建插件到 chrome-extension/dist（watch 模式）
```

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」，选择 `chrome-extension/dist` 目录
4. 点击扩展图标 → 打开侧边栏，即可开始使用

### 5. 运行测试

```bash
cd agent-server
node --test           # 核心模块单测（node:test，零依赖）
```

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
├── server/                    # MCP Server（stdio，供外部 AI 助手调用）
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
- **L4 记忆**：RAG 向量检索（确有需要时再加，当前 L0-L3 已满足绝大多数场景）
- **架构优化**：server/ 与 agent-server/ 代码重复抽公共层

## 📄 License

MIT
