# MCP Browser Analyzer

AI 可直接调用 Chrome 插件实现浏览器性能分析
基于 MCP 协议 | Vue3 + Vite | Chrome Extension MV3 | pnpm monorepo

## 特性

- 🚀 基于 MCP 协议的浏览器分析工具
- 📊 浏览器性能数据采集
- 🎯 Lighthouse 性能分析
- 🤖 集成火山引擎豆包大模型
- 🛠️ 现代化技术栈
- 📦 pnpm monorepo 架构

## 当前定位（MVP）

- 当前 MVP 版本聚焦 **Chrome 性能测试** 场景（采集与分析性能数据）
- 先验证「插件 ↔ Agent Server ↔ 工具调用」完整链路的稳定性
- 在 MVP 稳定后，项目将陆续演进为 **Chrome 通用形态的 Agent**，支持更广泛的浏览器自动化与分析任务

## 技术栈

| 分类        | 技术                |
| ----------- | ------------------- |
| 包管理器    | pnpm                |
| Monorepo    | pnpm workspace      |
| Chrome 插件 | Vue 3 + Vite + MV3  |
| MCP 服务    | Node.js             |
| Agent 服务  | Node.js + 火山引擎  |
| 通信        | WebSocket           |
| 代码规范    | ESLint + Prettier   |
| Git Hooks   | husky + lint-staged |
| CI/CD       | GitHub Actions      |

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
├── agent-server/                # Agent 服务（子项目）
├── docs/                        # 文档
│   └── DEVELOPMENT.md          # 开发文档
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

### 2. 配置 Agent Server

在 `agent-server` 目录下创建 `.env` 文件，配置火山引擎 API：

```bash
cd agent-server
cp .env.example .env
```

编辑 `.env` 文件，填入您的火山引擎 API 密钥和模型信息：

```
OPENAI_API_KEY=您的火山引擎API密钥
OPENAI_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
OPENAI_MODEL=您的模型ID
```

### 3. 启动 Agent Server

```bash
cd agent-server
npm start
```

或者使用交互式聊天工具测试：

```bash
cd agent-server
node chat.js
```

### 4. 启动 MCP 服务（可选）

```bash
pnpm server
```

### 5. 启动 Chrome 插件开发

```bash
pnpm extension
```

### 6. 加载 Chrome 插件

1. 打开 Chrome 浏览器，访问 `chrome://extensions/`
2. 开启右上角的「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `chrome-extension/dist` 目录

## 开发指南

详细的开发文档请参考 [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)

### 常用命令

| 命令                   | 说明                     |
| ---------------------- | ------------------------ |
| `pnpm server`          | 启动 MCP 服务            |
| `pnpm extension`       | 启动 Chrome 插件开发模式 |
| `pnpm extension:build` | 构建 Chrome 插件         |
| `pnpm build`           | 构建所有子项目           |
| `pnpm lint`            | 检查代码                 |
| `pnpm lint:fix`        | 自动修复代码问题         |
| `pnpm format`          | 格式化代码               |
| `pnpm format:check`    | 检查代码格式             |
| `pnpm clean`           | 清理依赖和构建产物       |

### 分支策略

- `main`: 稳定分支，只放可发布的代码
- `develop`: 开发分支，日常开发在此进行
- `feature/*`: 功能分支，开发新功能时使用

### 提交规范

1. 提交前确保代码通过 lint 和 format 检查
2. 使用清晰的提交信息描述变更内容
3. 功能开发在 develop 分支进行
4. 稳定代码合并到 main 分支

## 服务端说明

### Agent Server（agent-server/）

- **用途**: 给 Chrome 插件用，集成大模型，自动调用工具
- **启动**: `cd agent-server && npm start`
- **MVP 特点**: 以性能测试为核心能力，集成火山引擎豆包大模型，支持 ReAct 模式与自动工具调用
- **后续方向**: 逐步扩展为 Chrome 通用 Agent（不仅限于性能测试）

### MCP Server（server/）

- **用途**: 给 Cursor、Claude Desktop 等 AI 助手用
- **启动**: `cd server && pnpm start`
- **特点**: 纯 MCP 协议，AI 助手自己决定调用工具

## 开发计划

- ✅ Day1：项目初始化 + monorepo 搭建
- ✅ Day2：WebSocket 通信基础
- ✅ Day3：Agent Server 框架 + 火山引擎集成
- ✅ Day4：性能数据采集工具
- ✅ Day5：Chrome 插件开发（MVP 性能测试链路）
- ✅ Day6：联调测试（聚焦性能测试稳定性）
- ✅ Day7：优化 + 文档完善（明确通用 Agent 演进路线）

## 团队协作

1. Fork 本项目
2. 创建功能分支 (`git checkout -b feature/awesome-feature`)
3. 提交代码 (`git commit -m 'Add some awesome feature'`)
4. 推送到分支 (`git push origin feature/awesome-feature`)
5. 发起 Pull Request

## License

MIT
