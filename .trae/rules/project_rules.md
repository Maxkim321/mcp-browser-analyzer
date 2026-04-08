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
├── server/                    # MCP 服务
└── chrome-extension/          # Chrome 插件
```

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
