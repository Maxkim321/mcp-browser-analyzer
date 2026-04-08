---
alwaysApply: false
---

# Project Rules for mcp-browser-analyzer

## 项目概述

这是一个基于浏览器插件的 MCP（Model Context Protocol）项目，使用 pnpm monorepo 结构。

## 技术栈

- **包管理器**: pnpm
- **Monorepo**: pnpm workspace
- **前端框架**: Vue 3
- **构建工具**: Vite
- **MCP SDK**: @modelcontextprotocol/sdk

## 项目结构

```
mcp-browser-analyzer/
├── package.json              # 根目录配置
├── pnpm-workspace.yaml        # monorepo 配置
├── server/                    # 纯 MCP Server（给 AI 助手用）
│   ├── index.js             # MCP 服务器入口
│   ├── ws-server.js         # WebSocket 服务器（简化版）
│   ├── tools.js             # MCP 工具定义
│   └── tool-handler.js      # 工具处理器和追踪
├── agent-server/             # Agent Server（集成大模型，给 Chrome 插件用）
│   ├── index.js             # Agent 服务器入口
│   ├── ws-server.js         # WebSocket 服务器（含 Agent）
│   ├── tools.js             # 工具定义
│   ├── tool-handler.js      # 工具处理器和追踪
│   ├── agent.js             # AI Agent 编排器
│   ├── llm.js               # 大模型集成
│   ├── config.js            # 服务端配置
│   └── .env.example         # 环境变量示例
└── chrome-extension/          # Chrome 插件
```

## 两种运行模式

### MCP Server 模式（server/）

- **用途**：给 Cursor、Claude Desktop 等 AI 助手用
- **启动**：`pnpm server`
- **特点**：只提供 MCP 协议，AI 助手自己决定调用工具

### Agent Server 模式（agent-server/）

- **用途**：给 Chrome 插件用
- **启动**：`pnpm agent-server`
- **特点**：集成大模型，自动调用工具，返回自然语言结果

## 服务端实现状态

### ✅ 已完成

1. **WebSocket 服务器** - 端口 9999，连接管理
2. **MCP 服务器骨架** - 初始化完成
3. **MCP Tools 注册** - 工具列表和定义
4. **Tool Handler 实现** - 工具执行逻辑
5. **MCP ↔ WebSocket 桥接层** - 完整调用链路
6. **Traces 追踪机制** - TraceManager 实现
7. **大模型集成** - LLMClient 支持 OpenAI API
8. **AI Agent 编排器** - 自动工具调用和多轮对话
9. **提示词处理** - WebSocket 接收用户提示词并返回结果
10. **配置管理** - config.js 统一管理所有配置
11. **并行工具调用** - 支持批量执行工具
12. **迭代控制** - 最大步骤限制防止无限循环

### 📦 已实现的 MCP 工具

- `list_connections` - 列出所有连接的浏览器插件
- `get_browser_performance` - 获取指定连接的性能数据
- `broadcast_message` - 向所有连接广播消息

### 🔄 完整调用链路

```
Chrome插件（用户输入提示词）
    ↓
WebSocket 发送 user_prompt 消息
    ↓
服务端 Agent 接收提示词
    ↓
调用大模型（LLMClient）
    ↓
大模型决定调用工具
    ↓
服务端执行 MCP 工具
    ↓
WebSocket 控制浏览器插件
    ↓
插件返回结果
    ↓
大模型整理结果
    ↓
WebSocket 返回 agent_response 给插件
    ↓
插件可视化展示给用户
```

### 📡 WebSocket 消息协议

**客户端 → 服务端：**

- `user_prompt` - 用户提示词 `{ type: 'user_prompt', prompt: '...' }`
- `clear_history` - 清空对话历史 `{ type: 'clear_history' }`
- `ping` - 心跳 `{ type: 'ping' }`
- `performance_data` - 性能数据 `{ type: 'performance_data', requestId: '...', payload: {...} }`

**服务端 → 客户端：**

- `thinking` - 正在思考 `{ type: 'thinking' }`
- `agent_response` - Agent 响应 `{ type: 'agent_response', success: true, content: '...' }`
- `history_cleared` - 历史已清空 `{ type: 'history_cleared' }`
- `pong` - 心跳响应 `{ type: 'pong' }`
- `get_performance` - 获取性能指令 `{ type: 'get_performance', requestId: '...' }`
- `broadcast` - 广播消息 `{ type: 'broadcast', message: '...' }`

### 🔧 环境配置

复制 `agent-server/.env.example` 为 `agent-server/.env` 并配置：

```
OPENAI_API_KEY=your_api_key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o
```

### ⚙️ Agent 配置

在 `agent-server/config.js` 中可以调整：

```javascript
agent: {
  maxIterations: 5,        // 最大迭代步骤
  parallelToolCalls: 2,    // 并行工具数
  timeout: 60000,          // 超时时间（毫秒）
}
```

### ❌ TODO（客户端 Chrome 插件）

- [ ] 实现 WebSocket 客户端连接服务端（ws://localhost:9999）
- [ ] 实现 `user_prompt` 消息发送
- [ ] 实现 `agent_response` 消息接收和展示
- [ ] 实现 `get_performance` 指令处理
- [ ] 采集浏览器性能数据并通过 `performance_data` 消息返回
- [ ] 实现 `ping/pong` 心跳机制
- [ ] 实现消息 ID 匹配机制（requestId）

## 工程化规范

### 1. 代码风格原则

- **简洁性**: 避免过度设计，保持代码简洁易读
- **实用性**: 优先满足实际业务需求，不追求过度工程化
- **可维护性**: 代码逻辑清晰，便于后续维护和扩展
- **性能优先**: 关注关键路径的性能优化

### 2. 代码注释规范

- **函数/类注释**: 说明用途、输入、输出、副作用
- **复杂逻辑**: 对非显而易见的业务逻辑添加说明
- **TODO/FIXME**: 使用标准标记标注待办事项和需要修复的问题
- **避免冗余**: 不对显而易见的代码添加无意义注释

### 3. 错误处理

- **必要校验**: 对用户输入、外部数据进行必要校验
- **优雅降级**: 错误情况下提供合理的降级方案
- **日志记录**: 关键错误记录日志，便于排查问题
- **避免过度**: 不对每个可能的错误都做过度防御性处理

### 4. 命名规范

- **语义化**: 变量、函数命名清晰表达用途
- **一致性**: 保持项目内命名风格一致
- **简洁性**: 在语义清晰的前提下保持简洁

### 5. 日志输出规范

- **分级**: 使用统一的日志前缀标记不同类型
- **结构化**: 关键数据使用 JSON 格式输出
- **生产友好**: 生产环境避免输出敏感信息

## 开发规范

### 1. 分支策略

- `main`: 稳定分支，只放可发布的代码
- `develop`: 开发分支，日常开发在此进行
- `feature/*`: 功能分支，开发新功能时使用

### 2. 命令规范

- 启动 MCP 服务: `pnpm server`
- 启动 Agent 服务: `pnpm agent-server`
- 启动 Chrome 插件: `pnpm extension`
- 安装依赖到指定子项目: `pnpm add &lt;package&gt; -F &lt;project-name&gt;`

### 3. 代码规范

- 遵循项目现有的代码风格
- 使用 ESLint 和 Prettier 进行代码格式化
- 提交前确保代码通过 lint 和 typecheck

### 4. 提交规范

- 提交信息清晰描述变更内容
- 功能开发在 develop 分支进行
- 稳定代码合并到 main 分支
