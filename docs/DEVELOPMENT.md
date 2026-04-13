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

### 日常开发工作流

1. **切换到 develop 分支**

```bash
git checkout develop
git pull origin develop
```

2. **创建功能分支**

```bash
git checkout -b feature/your-feature-name
```

3. **启动开发服务**

```bash
# 终端 1：启动 MCP 服务
pnpm server

# 终端 2：启动 Chrome 插件开发
pnpm extension
```

4. **开发功能**

- 修改代码
- 保存后自动热重载
- 在浏览器中测试

5. **提交代码**

```bash
git add .
git commit -m "feat: add your feature description"
```

6. **推送到远程**

```bash
git push origin feature/your-feature-name
```

7. **创建 Pull Request**

在 GitHub 上创建 PR，目标分支为 `develop`

### 命令速查

| 命令                     | 说明                         |
| ------------------------ | ---------------------------- |
| `pnpm server`            | 启动 MCP 服务                |
| `pnpm extension`         | 启动 Chrome 插件开发模式     |
| `pnpm extension:build`   | 构建 Chrome 插件             |
| `pnpm build`             | 构建所有子项目               |
| `pnpm extension:dev`     | 构建 Chrome 插件（开发环境） |
| `pnpm extension:package` | 打包 Chrome 插件为 CRX3 文件 |
| `pnpm lint`              | 检查代码问题                 |
| `pnpm lint:fix`          | 自动修复代码问题             |
| `pnpm format`            | 格式化所有代码               |
| `pnpm format:check`      | 检查代码格式                 |
| `pnpm clean`             | 清理所有依赖和构建产物       |

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

## CRX3 打包优化

### 打包流程

1. **构建插件**

   ```bash
   # 生产环境构建
   pnpm extension:build

   # 开发环境构建
   pnpm extension:dev
   ```

2. **打包为 CRX3 文件**

   ```bash
   pnpm extension:package
   ```

   这会在 `chrome-extension` 目录下生成 `web-extension.crx` 文件。

### 打包优化措施

1. **代码压缩和混淆**
   - 使用 Terser 进行代码压缩
   - 移除生产环境中的 console 和 debugger 语句
   - 启用变量名混淆

2. **资源优化**
   - 分离 CSS 代码
   - 将 Vue 等第三方库分离到单独的 chunk 中
   - 优化文件命名和哈希策略

3. **安全性配置**
   - 为生产环境配置严格的内容安全策略
   - 使用私钥签名扩展，确保扩展的完整性和来源可信

### 注意事项

1. **私钥管理**
   - 私钥文件 `key.pem` 已添加到 `.gitignore`，不会被提交到版本控制系统
   - 请妥善保管私钥文件，用于后续扩展更新

2. **内容安全策略**
   - 生产环境中只允许从扩展本身加载资源
   - 开发环境中允许本地服务器连接，便于调试

3. **构建产物**
   - 构建和打包产物已添加到 `.gitignore`，不会被提交到版本控制系统
   - 每次打包都会生成新的 CRX3 文件

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
