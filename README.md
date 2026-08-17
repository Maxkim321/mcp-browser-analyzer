<div align="center">

# 浏览器 AI 助手 · Browser AI Assistant

一个住在浏览器**侧边栏**里的 AI 助手：不切页面，就能总结网页、划词即问、围绕页面内容追问，甚至自动完成一次带来源的**深度研究**。

Chrome Extension（Vue3 + MV3） · Node.js Agent Server（DeepSeek + 自研 Agent 编排）

</div>

---

## 功能特性

| 功能 | 说明 |
| --- | --- |
| 📄 **一键总结本页** | Readability 提取正文 + 结构化 Prompt 模板 → 输出概括/要点/结论，标注来源 URL 与正文截断状态，回答可溯源、防幻觉 |
| ✍️ **划词即问** | 选中文字弹出浮动工具条（翻译/解释/改写/总结/自由提问），Shadow DOM 隔离页面样式，自动唤起侧边栏问答 |
| 💬 **多轮上下文对话** | 会话持久化（`chrome.storage.local` 分桶存储），服务重启后自动重放重建上下文，历史会话可切换 |
| 🔍 **深度研究（Deep Research）** | 自动规划子问题 → 后台静默多页读取 → 信息充分性评估（不足自动补源重试）→ 交叉对比 → 流式生成带来源的研究报告；每完成一个主题可**人工介入**调整方向 |
| ⚡ **流式输出** | SSE 增量解析 + WebSocket 分片推送，打字机效果；工具调用与文本输出在同一条流式通道内正确区分 |
| 📊 **页面性能分析** | 采集页面性能指标（LCP 等），数据带可信度标签，供 AI 分析 |

## 架构

```
┌──────────────────────────── Chrome 扩展（Vue3 + MV3）────────────────────────────┐
│  SidePanel 侧边栏  ◀───▶  Background Service Worker  ◀───▶  Content Script        │
│  （对话 UI / 深度研究）     （消息路由 / 手势 API / 后台抓页）   （Readability 提取正文） │
└────────────────────────────────────┬──────────────────────────────────────────────┘
                                     │ WebSocket（:9999，requestId 异步请求-响应匹配）
┌────────────────────────────────────▼──────────────────────────────────────────────┐
│                              Agent Server（Node.js）                              │
│  ┌────────────────────────────────────────────────────────────────────────────┐   │
│  │                    三层 Agent 编排（按任务复杂度选型）                        │   │
│  │  Prompt 模板（固定任务） │ ReAct 循环（开放对话） │ 深度研究状态机（plan→    │   │
│  │  · 总结/翻译/改写        │ · 模型选工具→执行→回喂 │ research→compare→report） │   │
│  └────────────────────────────────────────────────────────────────────────────┘   │
│  LLM 客户端（SSE 流式解析 + Function Calling） · 工具封装（schema/handler/传输）   │
└────────────────────────────────────┬──────────────────────────────────────────────┘
                                     │ OpenAI 兼容接口
                              ┌──────▼──────┐
                              │  DeepSeek   │
                              └─────────────┘
```

深度研究状态机的编排思想对齐 LangGraph 的四个核心概念（State / 节点 / 条件边 / checkpoint / HITL），实现为自研 ~200 行轻量状态机（零依赖、可单测），详见 [`agent-server/src/core/workflow.js`](agent-server/src/core/workflow.js)。

## 演示

> 截图待补充：以下为截图清单，安装插件后按此操作截图，放入 `images/` 目录后 README 引用。

- `images/summary.png` — 侧边栏一键总结当前网页（含来源标注）
- `images/selection.png` — 网页划词弹出浮动工具条（翻译/解释/改写/总结）
- `images/deep-research.png` — 深度研究：规划子问题 → 进度消息 → 人工介入卡片 → 研究报告
- `images/performance.png` — 页面性能分析结果

## 快速开始

### 环境要求

- Node.js >= 20
- pnpm >= 9

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置 Agent Server

在 `agent-server` 目录下创建 `.env`（参考 `.env` 格式，变量名沿用 `ARK_` 前缀）：

```bash
cd agent-server
```

```
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
node --test           # 深度研究状态机单测（node:test，零依赖）
```

## 技术栈

| 分类 | 技术 |
| --- | --- |
| 浏览器扩展 | Chrome Extension MV3 · SidePanel · Service Worker · Content Script（Isolated World） |
| 前端 UI | Vue 3 + Vite |
| 正文提取 | @mozilla/readability（失败降级 body.innerText） |
| Agent 编排 | 自研三层编排：Prompt 模板 / ReAct 循环 / 深度研究状态机（对齐 LangGraph 四概念） |
| LLM | DeepSeek（OpenAI 兼容接口，Function Calling + SSE 流式） |
| 通信 | WebSocket（ws）· requestId 异步请求-响应匹配 + 超时兜底 |
| 测试 | node:test（零依赖原生 runner） |

## 项目结构

```
├── chrome-extension/          # Chrome 插件（Vue3 + MV3）
│   ├── src/background/        #   Service Worker（消息路由 / 后台抓页 / 手势 API）
│   ├── src/content-script/    #   页面正文提取（Readability）+ 划词工具条
│   └── src/ui/sidepanel/      #   侧边栏对话 UI（含深度研究交互）
├── agent-server/              # Agent 服务（Node.js + WebSocket）
│   ├── src/core/              #   agent.js（ReAct）· workflow.js（深度研究状态机）· llm.js（流式）
│   ├── src/tools/             #   工具 schema + handler（fetch_url / get_page_content / ...）
│   ├── src/communication/     #   WS 服务 + 消息路由
│   └── test/                  #   node:test 单测 + e2e 脚本
├── server/                    # MCP Server（stdio，供外部 AI 助手调用）
└── pnpm-workspace.yaml
```

## Roadmap

- ✅ **M0**：页面总结链路 · 流式输出 · 划词即问（翻译/解释/改写/总结/自由提问）· 轻量页面上下文 · 会话持久化
- ✅ **M1-F8**：深度研究（自研状态机：规划 → 多页抓取 → 信息评估 → 交叉对比 → 带来源报告，含 checkpoint 断点恢复 + 人工介入）
- 🔜 **M1 剩余**：偏好记忆（跨会话个性化）· 会话管理补全（重命名/搜索）· 结构化提取
- 🔜 **M2**：写操作（Computer Use，含权限审批流水线）· MCP Client / WebMCP 接入第三方工具生态

## License

MIT
