const test = require('node:test')
const assert = require('node:assert/strict')
const { ACTION_PROMPTS } = require('../src/config/prompts.js')

/**
 * 动作提示词注册表：前端 sendPrompt 的 action 依赖这张表，漏注册会静默
 * 回落默认 SYSTEM_PROMPT（P11 前 knowledge_complete 就是这个坑——补全白跑
 * 完整 ReAct Agent 还不带页面上下文）。这里锁住"注册完整 + 内容有效"。
 */
test('P11: ACTION_PROMPTS 覆盖前端在用的全部 action，knowledge_complete 已注册', () => {
  const expected = [
    'summarize',
    'summarize_selection',
    'translate',
    'explain',
    'rewrite',
    'ask',
    'extract',
    'knowledge_complete',
  ]
  for (const key of expected) {
    assert.ok(
      typeof ACTION_PROMPTS[key] === 'string' && ACTION_PROMPTS[key].length > 20,
      `ACTION_PROMPTS.${key} 应为非空提示词`
    )
  }
})

test('P11: knowledge_complete 提示词锁住关键约束（直接作答、不跑工具）', () => {
  const p = ACTION_PROMPTS.knowledge_complete
  assert.match(p, /结论先行/, '答案风格约束要写死在提示词里')
  assert.match(p, /不调用任何工具/, '与 ws-server 的 tools:[] 硬闸双保险')
})

test('P16: 旅行票务守则锁红线（支付停点 + 日期条规则 + 日期行运行时计算）', () => {
  const {
    SYSTEM_PROMPT,
    currentDateLine,
  } = require('../src/config/prompts.js')
  assert.ok(SYSTEM_PROMPT.includes('收银台/支付永远由用户自己完成'), '买票红线必须在守则里')
  assert.ok(SYSTEM_PROMPT.includes('日期参数不可靠'), '日期条点击规则必须在守则里')
  assert.ok(!SYSTEM_PROMPT.includes('toISOString'), '模板不得固化日期（UTC+跨天双 bug）')
  const line = currentDateLine()
  assert.ok(/今天的日期：\d{4}年\d{1,2}月\d{1,2}日 星期/.test(line), '日期行运行时生成且带星期: ' + line)
})
