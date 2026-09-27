# 混合检索三路对照评测

- 时间：2026-09-27T13:35:00.357Z
- 设计：regression 集（原 12 case，关键词重合型）验证不回退；semantic 集（12 条同义改写/
  跨语言/意图型对抗 query + 4 张词面陷阱卡）验证补盲区；判分确定性（期望卡进 top-3），零 LLM 成本
- embedding：方舟 doubao-embedding-vision（2048 维），查询向量三模式共享缓存

## 总表（recall@3 / recall@1 / 平均单次查询时延）

| 语料集 | 指标 | bm25 | vector | hybrid |
|---|---|---|---|---|
| regression（关键词主场） | recall@3 | **100%** | 100% | **100%** |
| regression（关键词主场） | recall@1 | 100% | 100% | 100% |
| regression（关键词主场） | 时延 | 1ms | 188ms | 1ms |
| semantic（语义对抗） | recall@3 | **25%** | 100% | **75%** |
| semantic（语义对抗） | recall@1 | 17% | 83% | 17% |
| semantic（语义对抗） | 时延 | 1ms | 185ms | 2ms |

## semantic 集逐 case 明细（双通道救援视图）

| case | 类型 | bm25 | vector | hybrid | 救援判定 |
|---|---|---|---|---|---|
| S1-paraphrase | paraphrase | #1 | #1 | #1 | 关键词通道保住 |
| S2-paraphrase | paraphrase | ✗ | #2 | #3 | **语义通道救援** |
| S3-crosslang | cross-lang | ✗ | #1 | #2 | **语义通道救援** |
| S4-crosslang | cross-lang | ✗ | #1 | #2 | **语义通道救援** |
| S5-intent | intent | ✗ | #2 | ✗ | — |
| S6-paraphrase | paraphrase | ✗ | #1 | ✗ | — |
| S7-crosslang | cross-lang | ✗ | #1 | ✗ | — |
| S8-paraphrase | paraphrase | #2 | #1 | #2 | 关键词通道保住 |
| S9-paraphrase | paraphrase | ✗ | #1 | #3 | **语义通道救援** |
| S10-crosslang | cross-lang | #1 | #1 | #1 | 关键词通道保住 |
| S11-intent | intent | ✗ | #1 | #3 | **语义通道救援** |
| S12-paraphrase | paraphrase | ✗ | #1 | #3 | **语义通道救援** |

## regression 集逐 case 明细（不回退验证）

| case | bm25 | hybrid | 双通道排名 |
|---|---|---|---|
| memory-bm25-01 | #1 | #1 | bm25:1 / vec:1 |
| memory-release-02 | #1 | #1 | bm25:1 / vec:1 |
| memory-dbpool-03 | #1 | #1 | bm25:1 / vec:1 |
| memory-cache-04 | #1 | #1 | bm25:1 / vec:1 |
| memory-ratelimit-05 | #1 | #1 | bm25:1 / vec:1 |
| memory-mq-06 | #1 | #1 | bm25:1 / vec:1 |
| memory-monitoring-07 | #1 | #1 | bm25:1 / vec:1 |
| memory-auth-08 | #1 | #1 | bm25:1 / vec:1 |
| memory-loadtest-09 | #1 | #1 | bm25:1 / vec:1 |
| memory-log-10 | #1 | #1 | bm25:1 / vec:1 |
| memory-payment-11 | #1 | #1 | bm25:1 / vec:1 |
| memory-backup-12 | #1 | #1 | bm25:1 / vec:1 |