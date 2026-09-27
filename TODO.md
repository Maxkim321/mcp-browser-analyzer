# TODO — 第二层接入测试指南 · 第三层开发项 · 维护护栏

> 给下次的 AI 和未来的自己：开工前先读根目录 `AGENTS.md`（项目结构/约定/已知坑），再读本文件。
> 更新：2026-09-27（P8/P9 已交付并全真验证；本文件是后续行动清单）。

---

## 一、第二层：接入其他 MCP server 的测试方法（每个 ~30 分钟）

**通用流程（每个 server 相同）**：
1. 停掉服务端 → 编辑 `agent-server/.env` 的 `MCP_SERVERS`（JSON 数组，可多个 server 并存）→ `pnpm start`
2. 看启动日志 `🔌 [MCP] server「xx」已接入，纳管工具: ...`——确认工具名前缀 `mcp_<server>_`、read/write 定级合理
3. 侧边栏（或 `cdp-e2e.cjs` 的驱动方式）发测试 prompt
4. 治理验证三件套：**写操作必弹审批卡**；`trace-log.jsonl` 有 `mcp_tool_registered`；`pnpm test` 仍 158/158（动态注册不破坏单测）
5. （可选）故意测拒绝路径：审批卡点「拒绝」→ agent 应如实收到拒绝并告知用户

### 1. GitHub（最有价值，一个免费 token）
- **前置**：GitHub → Settings → Developer settings → Personal access tokens → Fine-grained → 只勾目标仓库 repo 权限
- **配置**：`MCP_SERVERS` 数组加 `{"name":"github","command":"npx","shell":true,"args":["-y","@modelcontextprotocol/server-github"],"env":{"GITHUB_PERSONAL_ACCESS_TOKEN":"ghp_你的token"}}`
- **测试**：读——"查我 mcp-browser-analyzer 仓库的 open issue"；写——"创建一个 issue：标题「测试」，内容由你生成" → **必须弹审批卡**
- **预期定级**：get_issue/list_issues→read；create_issue→write

### 2. Playwright MCP（无 token，最容易，先做这个）
- **配置**：`{"name":"playwright","command":"npx","shell":true,"args":["-y","@playwright/mcp@latest"]}`
- **测试**："用浏览器工具打开 https://example.com 并告诉我页面标题"
- **注意**：会真开一个浏览器窗口；首次 npx 要下载依赖

### 3. SQLite（本地数据库，无 token）
- **前置**：随便造一个 test.db（sqlite3 命令或 DB Browser）
- **配置**：`{"name":"sqlite","command":"npx","shell":true,"args":["-y","@modelcontextprotocol/server-sqlite","--db-path","C:/绝对路径/test.db"]}`
- **测试**：读——"列出这个库的表和字段"；写——"插入一条测试数据" → 审批

### 4. Notion / 飞书（平台 token，稍重）
- **Notion**：`@modelcontextprotocol/server-notion` + NOTION_TOKEN（Notion「集成」页创建，30 秒）；测试："把 xx 总结写进我的 Notion 页面"
- **飞书**：社区 lark/openapi 系 MCP server（飞书开放平台建应用拿 token）；测试："把调研结论发到我的群"

### 5. 已知注意项
- **国内网络**：raw.githubusercontent.com 直连超时（本轮实测，agent 自动诊断并建议 jsdelivr 镜像）——GitHub 相关 server 测试时 token 走 env、API 域名一般可达，但网页抓取类任务优先给 jsdelivr/ghproxy 镜像源
- shell:true 时 args 含空格路径要加引号

---

## 二、第三层开发项（按优先级排序，做完一项划掉一项）

1. **MCP 工具分发门槛按来源分层**：`handleToolCall` 的 WS 初始化门槛对本地工具必要（要连扩展），对 MCP 工具不必要（独立子进程）——e2e 时用 stub manager 绕过的，正式做法是按工具来源区分前置检查
2. **RRF 通道置信度门控**：semantic 对抗集 hybrid 75% vs 纯向量 100% 的根因是 bm25 被陷阱卡污染、等权 RRF 被带偏——做法：bm25 分数归一化后设门槛，过门槛才参与融合（用 `pnpm eval:hybrid` 验证，两集都不能回退）
3. **memory 卡片 keywords 字段 + 写卡去重**（store.js 注释承诺过的阶段 2）
4. **会话管理补全**：重命名 / 删除 / 搜索（Roadmap 承诺过，UI 已有入口雏形）
5. **评测集加研究类 golden case**：轨迹判卷扩展到子 agent 链路
6. **P2 以文搜图**（blocked）：需方舟控制台给 doubao-embedding-vision 开图片输入权限或标准端点访问——开通后检索管线现成（截图→向量→同一记忆索引）
7. **跨主题并行 v2**（谨慎）：会动 HITL 语义（currentTopic 游标挂载审批语义）

---

## 三、维护护栏（防止乱改——给未来 AI 的红线，违反任何一条都算做错）

1. **数字纪律**：文档/话术里每个数字必须来自 `agent-server/eval/results/` 真实产物；跑不出来留 ⚠️，**禁止编造、手填、美化**
2. **交付仪式**：改完 → `pnpm test` 全绿 → eslint 0 → `pnpm eval` 不回退 → 回填技术文档 P 章节 → 同步面试总集
3. **零依赖原则**：不引入向量库、LangChain 系、LLM SDK、日志库——现有手写实现（BM25/RRF/SSE/MCP client）各 ~100-200 行是有意为之
4. **不要做**：browser-as-MCP-Server（市场饱和）；隐式学习偏好；深度研究以外的隐式自动路由；删除或绕过审批管线（包括"为了测试方便"）
5. **已知坑**（动手前必读 AGENTS.md §6）：store.append 40 字下限 / config require 时固化 env / 评测语料必须带 id（cardKey）/ 品牌 Chrome 137+ 无 --load-extension（用 Chrome for Testing）/ WS 由侧边栏页面持有
6. **诚实边界**：agent 拒绝编造是特性不是 bug（2026-09-27 实测：GitHub 不可达时 agent 拒绝写假笔记并给出镜像方案）——不要"修复"这个行为

---

## 四、已完成归档（2026-09-27，详情见技术文档 P8/P9）

- ✅ P8 混合检索：三路对照（regression 全 100%；semantic 25%→75%）+ 端到端 Δ=100pct + 13 单测
- ✅ P9 MCP：Client + 三道闸 + 14 工具真实纳管 + 集成 e2e + 真 UI 审批点击（截图 eval/results/ui-e2e-*.png）
- ✅ 实用任务真跑：总结 GitHub 仓库页 → 笔记.md 落盘 3601 字（含一次"拒绝编造"的正确行为演示）
