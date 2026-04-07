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

## 开发规范

### 1. 分支策略

- `main`: 稳定分支，只放可发布的代码
- `develop`: 开发分支，日常开发在此进行
- `feature/*`: 功能分支，开发新功能时使用

### 2. 命令规范

- 启动 MCP 服务: `pnpm server`
- 启动 Chrome 插件: `pnpm extension`
- 安装依赖到指定子项目: `pnpm add <package> -F <project-name>`

### 3. 代码规范

- 遵循项目现有的代码风格
- 使用 ESLint 和 Prettier 进行代码格式化
- 提交前确保代码通过 lint 和 typecheck

### 4. 提交规范

- 提交信息清晰描述变更内容
- 功能开发在 develop 分支进行
- 稳定代码合并到 main 分支
