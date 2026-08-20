# ai-code-review

AI 代码审查 CLI：在 **MR / PR 合并前**，基于 `diff` + 可插拔的 **Skills 审查规则** 调用 LLM 逐文件分析，并给出**行级评论**——像一个虚拟 Reviewer。平台通过 **Adapter** 抽象可插拔：默认 `mock`（本地即可演示），并内置 `github` 适配器（在真实 GitHub PR 上行内回贴评论）。

零外部依赖（Node 18+ 全局 `fetch`），LLM 走 OpenAI 兼容接口（默认 DeepSeek）。

## 一段话讲清原理（面试话术）
MR 触发 → 拉取本次变更 diff → 按文件拆行级 hunk → 对每个文件用各 Skill 跑（先确定性规则 `precheck` 硬查，再组装 prompt 交给 LLM 语义审查）→ 汇总评论，且**只锚定在本变更新增/上下文行**（避免评到无关代码）→ 回贴到对应行。规则 + LLM 混合，避免纯 LLM 的幻觉和纯规则的覆盖率不足。

## 快速演示（无需任何平台账号）
```bash
cd ai-code-review
cp .env.example .env   # 填入 ARK_API_KEY（复用项目已有的 DeepSeek key）
npm run review:sample  # 或用：node bin/ai-cr.mjs --platform mock --diff samples/sample.diff --files-dir samples/files
```
样例 `samples/files/src/order.js` 埋了 3 个典型问题：SQL 字符串拼接注入、无意义命名、圈复杂度超阈值。

## 在任意 git 仓库跑（Mock）
```bash
node bin/ai-cr.mjs --base main --head $(git branch --show-current)
```

## 在真实 GitHub PR 上回贴评论（日常可用）
```bash
# 给 PR #12 跑审查，并把行级评论贴到 PR 上（GitHub PR 页面就能看到）
node bin/ai-cr.mjs --platform github --repo owner/项目名 --pr 12 --post
# 只审查不回贴（先看结果）
node bin/ai-cr.mjs --platform github --repo owner/项目名 --pr 12
```
需要在 `.env` 里配 `GITHUB_TOKEN`（GitHub → Settings → Developer settings → Personal access tokens，勾 `repo` 权限）。评论锚定在新增行(RIGHT 侧)，在 PR 的 Files changed 页面上以内联形式展示。

> 注：也能接 GitLab（`--platform gitlab --project <path> --iid 42 --post`，对应简历里 GitLab CI 的场景），核心链路完全一致，只是 Adapter 不同。

## CLI 参数
```
--platform mock|gitlab|github  默认 mock
--diff <path> --files-dir <dir>    用 diff 文件 + 源码目录（mock，无 git 也能跑）
--base <ref> --head <ref>   在 git 仓库里生成 diff（mock）
--repo owner/name --pr <编号>   GitHub 仓库 / PR 编号
--project --iid             GitLab 项目路径 / MR iid
--skills a,b,c              security,naming,complexity（默认全部）
--min-severity error|warning|nit
--output text|md|json
--post                      回贴到 GitHub/GitLab
```

## 目录结构
```
bin/ai-cr.mjs           CLI 入口
src/parser.js           git diff 解析（hunk + 行号定位）
src/llm.js              OpenAI 兼容 LLM 调用 + 宽松 JSON 解析
src/reviewer.js         编排：规则校验 + LLM 语义审查 + 去重/定位
src/adapters/mock.js    本地演示（git diff / 指定 diff 文件）
src/adapters/github.js  GitHub PR changes 拉取 + 行级评论回贴
src/adapters/gitlab.js  GitLab changes 拉取 + discussions 回贴（简历场景）
src/skills/             可插拔审查规则（对应简历里 Skills）
  security.js           安全审查（SQL 注入 / 密钥 / eval）
  naming.js             命名规范
  complexity.js         圈复杂度（确定性算法 precheck）
samples/                演示样例
test/                   node:test 单元测试（零依赖）
```

## Skill 模型
每个 Skill = `systemRule`（喂给 LLM 的审查规则/输出格式）+ `precheck`（可选，不依赖 LLM 的快速硬查）+ 统一输出 `{ line, severity, message }`。新增审查维度只需新增一个 Skill 并在 `skills/index.js` 导出。

## 测试
```bash
npm test   # node --test
```