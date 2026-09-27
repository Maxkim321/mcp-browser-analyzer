# 研究管线路由三方对比——shallow 场景（P6 auto）

> 2026-09-19T08:16:29.270Z · 问题：MCP（Model Context Protocol）是什么？它的核心概念和生态现状如何？
> router 臂 = RESEARCH_ROUTING=auto（plan 标注 depth 分流 + 死胡同升级兜底），单次运行。
> 路由决策：[{"type":"research_routed","topicIndex":0,"depth":"shallow","pipeline":"legacy"},{"type":"research_routed","topicIndex":1,"depth":"shallow","pipeline":"legacy"}]

| 臂 | 墙钟(ms) | LLM调用 | 总tokens | 充分主题 |
|---|---|---|---|---|
| legacy | 51795 | 5 | 4905 | 1/2 |
| subagent | 214058 | 18 | 39285 | 1/2 |
| router | 473805 | 7 | 12948 | 2/2 |
