# 开发文档

## 目录

- [项目架构](#项目架构)
- [开发环境搭建](#开发环境搭建)
- [开发流程](#开发流程)
- [代码规范](#代码规范)
- [调试技巧](#调试技巧)
- [常见问题](#常见问题)

## 项目架构

### Monorepo 结构

本项目采用 pnpm monorepo 架构，包含两个子项目：

```
mcp-browser-analyzer/
├── server/              # MCP 服务端
│   ├── index.js        # MCP 服务入口
│   ├── ws-server.js    # WebSocket 服务
│   └── package.json
└── chrome-extension/    # Chrome 插件
    ├── src/
    │   ├── background/ # 后台脚本
    │   ├── ui/         # UI 页面（popup、options、sidepanel）
    │   ├── logic/      # 业务逻辑
    │   └── utils/      # 工具函数
    └── package.json
```

### 技术架构图

```
┌─────────────┐
│   AI Client │
└──────┬──────┘
       │ MCP Protocol
       ↓
┌─────────────────┐
│  MCP Server     │ (server/index.js)
│  (Node.js)      │
└──────┬──────────┘
       │ WebSocket
       ↓
┌─────────────────────┐
│  Chrome Extension   │ (chrome-extension/)
│  (Vue 3 + Vite)    │
└─────────────────────┘
       │ Chrome API
       ↓
┌─────────────────┐
│   Browser       │
│   (Web Page)    │
└─────────────────┘
```

## 开发环境搭建

### 前置要求

- **Node.js**: >= 20.19.0
- **pnpm**: >= 9.0.0
- **Chrome**: 最新版本（用于插件测试）

### 安装步骤

1. **克隆项目**

```bash
git clone <repository-url>
cd mcp-browser-analyzer
```

2. **安装依赖**

```bash
pnpm install
```

3. **初始化 Git Hooks**

```bash
pnpm prepare
```

### 验证安装

运行以下命令验证环境是否正常：

```bash
# 检查代码格式
pnpm format:check

# 检查代码问题
pnpm lint
```

## 开发流程

### 角色说明

- **开发者**：项目维护者，拥有仓库的直接推送权限
- **参与者**：项目贡献者，通过 Fork + Pull Request 方式贡献代码

---

### 开发者流程（项目维护者）

如果你是项目维护者，直接在仓库中开发：

#### 1. 日常开发工作流

```bash
# 1. 切换到 develop 分支
git checkout develop
git pull origin develop

# 2. 创建功能分支
git checkout -b feature/your-feature-name
# 例如：git checkout -b feature/screenshot
```

#### 2. 开发功能

```bash
# 启动开发服务
# 终端 1：启动 MCP 服务
pnpm server

# 终端 2：启动 Chrome 插件开发
pnpm extension
```

#### 3. 提交代码

```bash
# 修改代码后提交
git add .
git commit -m "feat: add your feature description"

# 推送到远程
git push origin feature/your-feature-name
```

#### 4. 合并到 develop

```bash
# 切换回 develop
git checkout develop
git pull origin develop

# 合并功能分支
git merge feature/your-feature-name

# 推送 develop
git push origin develop

# 删除功能分支（可选）
git branch -d feature/your-feature-name
git push origin --delete feature/your-feature-name
```

#### 5. 发布到 main

```bash
# 切换到 main
git checkout main
git pull origin main

# 合并 develop
git merge develop

# 推送 main
git push origin main

# 切换回 develop 继续开发
git checkout develop
```

---

### 参与者流程（项目贡献者）

如果你是外部贡献者，请使用 Fork + Pull Request 方式：

#### 1. Fork 项目

1. 访问项目仓库
2. 点击右上角的「Fork」按钮
3. 选择你的账号作为目标

#### 2. 克隆你的 Fork

```bash
git clone https://github.com/你的用户名/mcp-browser-analyzer.git
cd mcp-browser-analyzer
```

#### 3. 添加上游仓库

```bash
# 添加原始仓库为上游
git remote add upstream https://github.com/Maxkim321/mcp-browser-analyzer.git

# 查看远程仓库
git remote -v
```

#### 4. 同步上游代码

```bash
# 切换到 develop 分支
git checkout develop

# 获取上游最新代码
git fetch upstream

# 合并上游代码
git merge upstream/develop

# 推送到你的 Fork
git push origin develop
```

#### 5. 创建功能分支

```bash
# 从 develop 创建功能分支
git checkout -b feature/your-feature-name
```

#### 6. 开发功能

```bash
# 修改代码...

# 提交更改
git add .
git commit -m "feat: add your feature description"

# 推送到你的 Fork
git push origin feature/your-feature-name
```

#### 7. 创建 Pull Request

1. 访问你的 Fork 仓库
2. 点击「Compare & pull request」
3. 填写 PR 信息：
   - 标题：清晰描述你的变更
   - 描述：详细说明做了什么、为什么这么做
4. 选择目标分支：`develop`
5. 点击「Create pull request」

#### 8. 等待 Code Review

- 维护者会审查你的代码
- 可能会要求一些修改
- 审核通过后会合并到 develop

---

### 分支策略示意图

```
main (稳定分支)
  ↑
  └─ develop (开发分支) ← 日常开发在这里
       ↑
       ├─ feature/screenshot (开发者直接合并)
       ├─ feature/page-info (开发者直接合并)
       └─ feature/... (参与者通过 PR 合并)
```

### 命令速查

| 命令                   | 说明                     |
| ---------------------- | ------------------------ |
| `pnpm server`          | 启动 MCP 服务            |
| `pnpm extension`       | 启动 Chrome 插件开发模式 |
| `pnpm extension:build` | 构建 Chrome 插件         |
| `pnpm build`           | 构建所有子项目           |
| `pnpm lint`            | 检查代码问题             |
| `pnpm lint:fix`        | 自动修复代码问题         |
| `pnpm format`          | 格式化所有代码           |
| `pnpm format:check`    | 检查代码格式             |
| `pnpm clean`           | 清理所有依赖和构建产物   |

## 代码规范

### ESLint 规则

- 使用 ESLint 检查 JavaScript 代码
- 遵循 `eslint:recommended` 规则
- 自动修复：`pnpm lint:fix`

### Prettier 规则

```json
{
  "semi": false, // 不使用分号
  "singleQuote": true, // 使用单引号
  "printWidth": 100, // 每行最大 100 字符
  "tabWidth": 2, // 缩进 2 个空格
  "useTabs": false, // 使用空格而不是 tab
  "trailingComma": "es5", // ES5 风格的尾随逗号
  "bracketSpacing": true, // 对象大括号内添加空格
  "arrowParens": "always", // 箭头函数参数总是加括号
  "endOfLine": "lf" // 统一使用 LF 换行符
}
```

### Git 提交规范

提交信息格式：

```
<type>(<scope>): <subject>

<body>

<footer>
```

Type 类型：

- `feat`: 新功能
- `fix`: 修复 bug
- `docs`: 文档更新
- `style`: 代码格式调整
- `refactor`: 重构
- `test`: 测试相关
- `chore`: 构建/工具链相关

示例：

```bash
git commit -m "feat(extension): add screenshot functionality"
git commit -m "fix(server): handle websocket disconnection"
git commit -m "docs: update development guide"
```

### 分支策略

```
main (稳定分支)
  ↑
develop (开发分支) ← 日常开发在这里
  ↑
feature/* (功能分支) ← 开发新功能时创建
```

## 调试技巧

### 调试 Chrome 插件

1. **打开扩展管理页面**

访问 `chrome://extensions/`

2. **查看后台脚本日志**

点击插件的「Service Worker」链接打开 DevTools

3. **查看 Popup 日志**

右键点击 Popup → 检查

4. **热重载**

开发模式下，修改代码后插件会自动重新加载

### 调试 MCP 服务

1. **查看控制台输出**

MCP 服务的日志会输出到运行 `pnpm server` 的终端

2. **使用调试器**

在 VS Code 中创建 `.vscode/launch.json`：

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug MCP Server",
      "skipFiles": ["<node_internals>/**"],
      "program": "${workspaceFolder}/server/index.js"
    }
  ]
}
```

### WebSocket 调试

使用 Chrome DevTools 的 Network 面板：

1. 打开 DevTools → Network
2. 筛选「WS」（WebSocket）
3. 选择连接查看消息

## 常见问题

### 依赖安装失败

**问题**: `pnpm install` 失败

**解决方案**:

```bash
# 清理缓存
pnpm store prune

# 重新安装
pnpm install
```

### Git Hooks 不工作

**问题**: 提交时没有自动运行 lint/format

**解决方案**:

```bash
# 重新初始化 husky
pnpm prepare

# 检查 hook 文件权限
chmod +x .husky/pre-commit
```

### Chrome 插件无法加载

**问题**: 加载插件时提示错误

**解决方案**:

1. 确保先运行 `pnpm extension:build`
2. 检查 `chrome-extension/dist` 目录是否存在
3. 查看 `chrome://extensions/` 页面的错误信息

### ESLint 报错

**问题**: ESLint 报告错误

**解决方案**:

```bash
# 自动修复可修复的问题
pnpm lint:fix

# 手动修复剩余问题
pnpm lint
```

### 端口被占用

**问题**: 启动服务时提示端口已被占用

**解决方案**:

```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# 或者修改 server/ws-server.js 中的端口号
```

## 贡献指南

### 准备工作

1. Fork 本项目
2. 克隆你的 Fork
3. 安装依赖
4. 创建功能分支

### 提交 PR

1. 确保代码通过 lint 和 format 检查
2. 更新相关文档
3. 创建 Pull Request
4. 等待 Code Review

### 代码审查

- PR 标题清晰描述变更
- 提供足够的上下文信息
- 确保 CI/CD 通过

## 参考资源

- [pnpm Workspace 文档](https://pnpm.io/workspaces)
- [MCP 协议规范](https://modelcontextprotocol.io/)
- [Chrome Extension 开发文档](https://developer.chrome.com/docs/extensions/)
- [Vue 3 文档](https://vuejs.org/)
- [Vite 文档](https://vitejs.dev/)
