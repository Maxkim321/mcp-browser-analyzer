# 研究管线路由三方对比——deep 场景（P6 auto）

> 2026-09-19T08:08:17.083Z · 问题：HarmonyMesh 协议 v2.3 规范中定义的默认 gossip 同步间隔是多少秒？
> router 臂 = RESEARCH_ROUTING=auto（plan 标注 depth 分流 + 死胡同升级兜底），单次运行。
> 路由决策：[{"type":"research_routed","topicIndex":0,"depth":"deep","pipeline":"worker"}]

| 臂 | 墙钟(ms) | LLM调用 | 总tokens | 充分主题 | 事实命中 |
|---|---|---|---|---|---|
| legacy | 73715 | 7 | 5895 | 0/2 | ✗ |
| subagent | 48692 | 7 | 11524 | 1/1 | ✓ |
| router | 164575 | 7 | 14961 | 1/1 | ✓ |
