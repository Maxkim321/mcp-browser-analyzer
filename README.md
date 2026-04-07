# MCP Browser Analyzer

AI 可直接调用 Chrome 插件实现：截图、页面信息、控制台日志、Lighthouse 性能分析
基于 MCP 协议 | Vue3 + Vite | Chrome Extension MV3 | pnpm monorepo

## 特性

- 🚀 基于 MCP 协议的浏览器分析工具
- 📸 页面截图功能
- 📊 页面信息采集
- 📝 控制台日志获取
- 🎯 Lighthouse 性能分析
- 🛠️ 现代化技术栈
- 📦 pnpm monorepo 架构

## 技术栈

| 分类 | 技术 |
|------|------|
| 包管理器 | pnpm |
| Monorepo | pnpm workspace |
| Chrome 插件 | Vue 3 + Vite + MV3 |
| MCP 服务 | Node.js |
| 通信 | WebSocket |
| 性能分析 | Lighthouse |
| 代码规范 | ESLint + Prettier |
| Git Hooks | husky + lint-staged |
| CI/CD | GitHub Actions |

## 项目结构

```
mcp-browser-analyzer/
├── .github/
│   └── workflows/
│       └── ci.yml              # CI/CD 配置
├── .husky/                     # Git Hooks
├── .trae/
│   └── rules/
│       └── project_rules.md    # 项目规则
├── chrome-extension/           # Chrome 插件（子项目）
├── server/                      # MCP 服务（子项目）
├── .eslintrc.js
├── .prettierrc.json
├── .npmrc
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

## 快速开始

### 环境要求

- Node.js >= 20
- pnpm >= 9

### 1. 安装依赖

```bash
pnpm install
```

### 2. 启动 MCP 服务

```bash
pnpm server
```

### 3. 启动 Chrome 插件开发

```bash
pnpm extension
```

### 4. 加载 Chrome 插件

1. 打开 Chrome 浏览器，访问 `chrome://extensions/`
2. 开启右上角的「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `chrome-extension/dist` 目录

## 开发指南

详细的开发文档请参考 [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)

### 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm server` | 启动 MCP 服务 |
| `pnpm extension` | 启动 Chrome 插件开发模式 |
| `pnpm extension:build` | 构建 Chrome 插件 |
| `pnpm build` | 构建所有子项目 |
| `pnpm lint` | 检查代码 |
| `pnpm lint:fix` | 自动修复代码问题 |
| `pnpm format` | 格式化代码 |
| `pnpm format:check` | 检查代码格式 |
| `pnpm clean` | 清理依赖和构建产物 |

### 分支策略

- `main`: 稳定分支，只放可发布的代码
- `develop`: 开发分支，日常开发在此进行
- `feature/*`: 功能分支，开发新功能时使用

### 提交规范

1. 提交前确保代码通过 lint 和 format 检查
2. 使用清晰的提交信息描述变更内容
3. 功能开发在 develop 分支进行
4. 稳定代码合并到 main 分支

## 开发计划

- ✅ Day1：项目初始化 + monorepo 搭建
- ⏳ Day2：Chrome 插件功能（截图、信息）
- ⏳ Day3：WebSocket 通信
- ⏳ Day4：MCP 服务集成
- ⏳ Day5：控制台日志采集
- ⏳ Day6：Lighthouse 性能分析
- ⏳ Day7：联调 + 开源发布

## 团队协作

1. Fork 本项目
2. 创建功能分支 (`git checkout -b feature/awesome-feature`)
3. 提交代码 (`git commit -m 'Add some awesome feature'`)
4. 推送到分支 (`git push origin feature/awesome-feature`)
5. 发起 Pull Request

## License

MIT
