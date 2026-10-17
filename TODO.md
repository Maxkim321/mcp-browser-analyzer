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
2. ~~RRF 通道置信度门控~~ **✅ 已完成（2026-09-28）**：BM25 名次进入融合需语义背书（余弦 ≥0.9×本查询最高）；semantic 集 40%→100%、regression 100% 不回退、3 条留出 case 全 hit#1；详见技术文档 P8.1
3. **memory 卡片 keywords 字段 + 写卡去重**（store.js 注释承诺过的阶段 2）
4. **会话管理补全**：重命名 / 删除 / 搜索（Roadmap 承诺过，UI 已有入口雏形）
5. **评测集加研究类 golden case**：轨迹判卷扩展到子 agent 链路
6. **P2 以文搜图**（blocked）：需方舟控制台给 doubao-embedding-vision 开图片输入权限或标准端点访问——开通后检索管线现成（截图→向量→同一记忆索引）
7. **跨主题并行 v2**（谨慎）：会动 HITL 语义（currentTopic 游标挂载审批语义）
8. **页面操作 P12c（候选）**：~~fill_form/wait_for/审批卡字段列表~~ **✅ P12b 已交付**（2026-10-16：fill_form 两阶段批量填表 + wait_for + 审批卡字段列表 + 真实站点 e2e httpbin/bing，见技术文档 P12b）；剩 chrome.debugger CDP 增强通道（closed shadow root/跨域 iframe/paint order，开关式）+ JS 监听器探测 + 导航竞态的 wait_for 重试兜底 + Boss直聘半自动验收（**✅ P12c 核心已交付 2026-10-16**：chrome.debugger 可信输入通道（trusted_click 工具，debugger 权限，空闲自动 detach）→ isTrusted 门控实锤（三重验证+登录变量消除）→ Boss 真站全流程：搜索→筛选应届生→岗位详情→停在立即沟通按钮前（发送权在人）；**端到端实战复盘 2026-10-16 晚**：用户自然语言"投递应届前端/AI全栈"→ agent 完成筛选+逐个打开 9 个岗位详情核验 JD（get_page_content 批量）→ 10 轮迭代预算耗尽触发压缩 → 唯一全核验岗位=海艺智创 WEB前端（✅HTML5/CSS3/JS/React/Vue/TS/Webpack）；该岗位 WEB 端聊天入口显示"去App"→ 常用语步骤不可达（诚实边界：网页端对部分岗位不提供沟通入口）；agent 全程零伪造（拒编 ref/拒假装完成），两次主动停下提问；**SOP 守则入 SYSTEM_PROMPT 后自然语言驱动验收（commit 3f04a52）**：一句大白话 → 单轮 7.1s 自主核验全部 2 个前端岗位（此前同规模 10 轮）→ 结构化能做/不能做清单 → 零副作用；**追加核验：华为 2027 秋招-前端(全国) JD ✅（Vue/React/HTML5/工程化）但网页端同样只有「去App」——2/2 岗位网页端无聊天入口，疑似 Boss Web 产品策略而非岗位差异**；遗留：多 trusted 动作类型（trusted_fill）、**连接生命周期 bug（真机实锤+根因假设已定位：Boss 实战中 zhipin 页 reload 后 content script 重注入，agent 回合内所有工具调用撞死在断掉的通道上（"message port closed"）——而同刻从 sidepanel 直发的探针成功；根因=回合开始时固化的 connectionId 在通道重建后失效，修法=resolveConnectionId 改为每次工具调用动态解析最新 sidepanel 连接（或回合内重连时更新 context），P12c 收尾首要项）**、导航竞态重试兜底、Boss 高频频控未测（红线））
9. **MCP 设置页（P10 的续集，候选）**：预设模板卡 + 运行时热注册（registerMcpServer 本就是运行时函数，差一个 WS/HTTP 入口）+ mcp-servers.local.json 持久化（启动时与 .env 合并，注意 config require 时固化 env 的坑）——把"第二层接入测试"装进这个 UI 做，接入过程即评测产物；届时一并修本清单第 1 项（分发门槛按来源分层）

---

## 三、维护护栏（防止乱改——给未来 AI 的红线，违反任何一条都算做错）

1. **数字纪律**：文档/话术里每个数字必须来自 `agent-server/eval/results/` 真实产物；跑不出来留 ⚠️，**禁止编造、手填、美化**
2. **交付仪式**：改完 → `pnpm test` 全绿 → eslint 0 → `pnpm eval` 不回退 → 回填技术文档 P 章节 → 同步面试总集
3. **零依赖原则**：不引入向量库、LangChain 系、LLM SDK、日志库——现有手写实现（BM25/RRF/SSE/MCP client）各 ~100-200 行是有意为之
4. **不要做**：browser-as-MCP-Server（市场饱和）；隐式学习偏好；深度研究以外的隐式自动路由；删除或绕过审批管线（包括"为了测试方便"）；个人向 SRS 复习闭环（2026-10-12 决策：知识点定位通用内容，不绑定个人学习场景——遗留小项：卡片来源 URL 截断 80 字符，下次动 schema 加全量 URL 字段）
5. **已知坑**（动手前必读 AGENTS.md §6）：store.append 40 字下限 / config require 时固化 env / 评测语料必须带 id（cardKey）/ 品牌 Chrome 137+ 无 --load-extension（用 Chrome for Testing）/ WS 由侧边栏页面持有
6. **诚实边界**：agent 拒绝编造是特性不是 bug（2026-09-27 实测：GitHub 不可达时 agent 拒绝写假笔记并给出镜像方案）——不要"修复"这个行为

---

## 四、已完成归档（2026-09-27，详情见技术文档 P8/P9）

- ✅ P8 混合检索：三路对照（regression 全 100%；semantic 25%→75%）+ 端到端 Δ=100pct + 13 单测
- ✅ P9 MCP：Client + 三道闸 + 14 工具真实纳管 + 集成 e2e + 真 UI 审批点击（截图 eval/results/ui-e2e-*.png）
- ✅ 实用任务真跑：总结 GitHub 仓库页 → 笔记.md 落盘 3601 字（含一次"拒绝编造"的正确行为演示）
- ✅ P10 能力可见性（2026-10-12）：侧边栏工具箱面板（内置/MCP 分组 + 读写定级徽章，注册表快照驱动：WS 拉取 + 注册广播双通道）+ 空态 chip 按工具特征匹配 + 工具调用终态上轨迹（完成/被拒/预演/出错）；165/165 测试（+5）、pnpm eval 10/10 不回退、真机 e2e 截图 eval/results/ui-e2e-capabilities-*.png；详见技术文档 P10、面试总集 4.13
- ✅ P11 知识点面板重构 + 补全链路修复（2026-10-12）：列表/详情两态 + 搜索/状态筛选 + 显式 AI 补全（knowledge_complete 注册专用提示词 + `tools:[]` 硬闸——修复"未注册白跑全量 ReAct"存量 bug，省 ≈1317 tokens/次）+ 骨架屏/失败重试/90s 超时兜底 + 撤销删除 toast + clearAllKnowledge 收口 prefs 层；169/169 测试（+4）、pnpm eval 10/10 不回退、真机 e2e 含真实补全（截图 eval/results/ui-e2e-knowledge-*.png）；详见技术文档 P11、面试总集 4.14
- ✅ P12a 写操作 ref 寻址 + 操作可视化（2026-10-16）：元素引用身份（WeakRef+指纹，执行前校验失效即拒绝——移除"审批假安全感"）· shadow DOM 穿透枚举 + 伪 HTML 快照（带 checked/id/placeholder 语义锚点）· actionability 矩阵 + 动作后校验 · 操作可视化动画（closed shadow 隔离、reduced-motion 适配）· 审计补 ref 归因；chrome-extension 首次引入 node:test；177/177 测试（agent-server 169 + extension 8）、pnpm eval 10/10、真机 e2e 四链路（shadow 召回 0→全召回/ref 真点击/动画层/失效拒绝）；两个真机发现（elementFromPoint shadow retarget→composed 祖先链；rAF 后台不触发→80ms 竞速）；调研见 `../调研-浏览器Agent元素定位方案-2026-10.md`；详见技术文档 P12、面试总集 4.15
