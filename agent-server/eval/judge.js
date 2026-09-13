/**
 * 评测判分器（三层，由便宜到贵）
 * 1. must_mention / regex / nonempty / max_chars：确定性判分，零成本
 * 2. llm_judge：reasoning 档 + temperature 0，输出 {score, reason} JSON
 * 判分器自身的校准：先手工标定期望分，确认打分一致后再信任（见技术文档 P0）
 */

const JUDGE_SYSTEM_PROMPT = `你是一个严格的 AI 助手回答质量评委。根据评分标准对回答打 0-5 分（整数）：
5 = 完全满足标准且表述准确
4 = 满足标准，个别细节不完整
3 = 大体满足标准，有明显小瑕疵
2 = 部分满足，遗漏关键内容
1 = 基本不满足
0 = 完全不满足或答非所问
只输出 JSON：{"score": 数字, "reason": "一句话理由"}`

function checkMustMention(content, list) {
  const missing = (list || []).filter((kw) => !content.includes(kw))
  return {
    name: 'must_mention',
    passed: missing.length === 0,
    detail: missing.length ? `缺失: ${missing.join('、')}` : '全部命中',
  }
}

function checkRegex(content, list) {
  const failed = []
  for (const pattern of list || []) {
    let ok = false
    try {
      ok = new RegExp(pattern).test(content)
    } catch {
      ok = content.includes(pattern)
    }
    if (!ok) failed.push(pattern)
  }
  return {
    name: 'regex',
    passed: failed.length === 0,
    detail: failed.length ? `未匹配: ${failed.join('、')}` : '全部命中',
  }
}

async function checkLLMJudge(content, llmJudge, llm) {
  const response = await llm.chat(
    [
      {
        role: 'user',
        content: `【评分标准】\n${llmJudge.criteria}\n\n【待评回答】\n${String(content).slice(0, 4000)}\n\n请打分。`,
      },
    ],
    [],
    JUDGE_SYSTEM_PROMPT,
    undefined,
    { tier: 'reasoning' }
  )
  // 容错解析：可能被 ```json 包裹
  const text = String(response?.content || '')
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) {
    return { name: 'llm_judge', passed: false, detail: `judge 输出无法解析: ${text.slice(0, 80)}` }
  }
  try {
    const parsed = JSON.parse(match[0])
    const score = Number(parsed.score)
    const passed = Number.isFinite(score) && score >= llmJudge.min_score
    return {
      name: 'llm_judge',
      passed,
      detail: `score=${score} (min=${llmJudge.min_score}) ${parsed.reason || ''}`,
    }
  } catch {
    return { name: 'llm_judge', passed: false, detail: `judge JSON 解析失败: ${text.slice(0, 80)}` }
  }
}

/**
 * 对单条回答执行 rubric 判分
 * @param {object} rubric - { must_mention, regex, llm_judge, max_chars, nonempty }
 * @param {object} result - agent.process 的返回 { success, content }
 * @param {object} [opts] - { useLLMJudge: 是否跑 LLM 判分, llm: LLMClient }
 */
async function judgeAnswer(rubric, result, opts = {}) {
  const content = String(result?.content || '')
  const checks = []

  checks.push({
    name: 'success',
    passed: result?.success === true,
    detail: result?.success === true ? '调用成功' : `失败: ${result?.error || 'unknown'}`,
  })

  if (rubric.nonempty) {
    checks.push({
      name: 'nonempty',
      passed: content.trim().length > 0,
      detail: `长度 ${content.length}`,
    })
  }

  if (rubric.max_chars) {
    checks.push({
      name: 'max_chars',
      passed: content.length <= rubric.max_chars,
      detail: `${content.length}/${rubric.max_chars}`,
    })
  }

  if (rubric.must_mention) checks.push(checkMustMention(content, rubric.must_mention))
  if (rubric.regex) checks.push(checkRegex(content, rubric.regex))

  if (rubric.llm_judge && opts.useLLMJudge !== false) {
    checks.push(await checkLLMJudge(content, rubric.llm_judge, opts.llm))
  }

  return { passed: checks.every((c) => c.passed), checks }
}

module.exports = { judgeAnswer, JUDGE_SYSTEM_PROMPT }
