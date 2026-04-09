# 项目重构指南

## 目标
将 server 目录拆分为两个独立的服务：
1. **server/** - 纯 MCP Server（给 Cursor、Claude Desktop 等 AI 助手用）
2. **agent-server/** - Agent Server（集成大模型，给 Chrome 插件用）

## 当前状态
- ✅ agent-server 目录已创建
- ✅ agent-server/package.json 已创建
- ⏳ 需要完成其他文件的拆分

---

## 完整提示词（复制给 AI）

```
请帮我完成 mcp-browser-analyzer 项目的重构，将 server 目录拆分为两个独立的服务。

## 任务清单

### 1. agent-server 需要的文件
从 server/ 目录复制以下文件到 agent-server/ 目录，并确保路径引用正确：
- [ ] index.js（修改为 Agent 模式，去掉 MCP 相关代码）
- [ ] ws-server.js（保持现状，已集成 Agent）
- [ ] tools.js（保持现状）
- [ ] tool-handler.js（保持现状）
- [ ] agent.js（保持现状）
- [ ] llm.js（保持现状）
- [ ] config.js（保持现状）
- [ ] .env.example（保持现状）

### 2. server/ 需要重构为纯 MCP Server
修改 server/ 目录下的文件，去掉 Agent 相关代码：
- [ ] index.js - 只保留 MCP Server 功能
- [ ] ws-server.js - 简化，去掉 user_prompt、clear_history 等 Agent 相关消息处理
- [ ] 删除 agent.js、llm.js、config.js、.env.example（这些只属于 agent-server）

### 3. 更新项目配置
- [ ] 更新 pnpm-workspace.yaml，添加 agent-server
- [ ] 更新根目录 package.json，添加 agent-server 相关脚本
- [ ] 更新 .trae/rules/project_rules.md，更新项目结构和说明

### 4. 最终项目结构
```
mcp-browser-analyzer/
├── server/                    # 纯 MCP Server
│   ├── index.js
│   ├── ws-server.js
│   ├── tools.js
│   ├── tool-handler.js
│   └── package.json
├── agent-server/             # Agent Server
│   ├── index.js
│   ├── ws-server.js
│   ├── tools.js
│   ├── tool-handler.js
│   ├── agent.js
│   ├── llm.js
│   ├── config.js
│   ├── .env.example
│   └── package.json
└── chrome-extension/          # Chrome 插件
```

## 注意事项
1. 两个服务都需要 ws-server.js、tools.js、tool-handler.js
2. server/ 不需要大模型相关代码
3. agent-server/ 不需要 @modelcontextprotocol/sdk 依赖
4. 更新文档时说明两种模式的区别和使用场景
```

---

## 两种模式说明

### MCP Server 模式（server/）
- **用途**：给 Cursor、Claude Desktop 等 AI 助手用
- **启动**：`cd server && pnpm start`
- **特点**：只提供 MCP 协议，AI 助手自己决定调用工具

### Agent Server 模式（agent-server/）
- **用途**：给 Chrome 插件用
- **启动**：`cd agent-server && pnpm start`
- **特点**：集成大模型，自动调用工具，返回自然语言结果
