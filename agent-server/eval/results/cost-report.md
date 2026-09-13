# Token 成本账本

- 时间：2026-09-13T07:10:43.808Z
- 记录数：81 · 总调用 81 · 总 cost ¥0.8966

## 按档位（分级路由 ROI）

| 档位 | 调用 | 占比 | prompt tok | completion tok | 成本¥ | 均耗时 |
|---|---|---|---|---|---|---|
| main | 55 | 67.9% | 196,561 | 12,930 | 0.4966 | 1812ms |
| light | 26 | 32.1% | 96,066 | 11,334 | 0.4 | 9879ms |

## 按模型

| 模型 | 调用 | prompt tok | completion tok | 成本¥ |
|---|---|---|---|---|
| deepseek-chat | 65 | 271,720 | 14,835 | 0.6621 |
| kimi-k2.7-code | 16 | 20,907 | 9,429 | 0.2345 |

> 单价表：{"deepseek-chat":{"input":2,"output":8},"doubao-seed-2-0-pro-260215":{"input":4,"output":16},"kimi-k2.7-code":{"input":4,"output":16}}（元/百万 token，可在 config.llm.pricing 配置）