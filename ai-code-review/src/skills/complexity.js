/**
 * Skill: 圈复杂度审查
 * precheck：用确定性算法计算每个函数的圈复杂度（无需 LLM 的快速硬查），
 * 超过阈值且位于本次变更范围的函数给出「建议拆分」意见。
 *
 * 实现说明：通过正则里的分支关键字 +1 估算圈复杂度（与 Sonar-style 的
 * decision-points 计数等价，只是不求精确到每个分支表达式，够演示）。
 */

const THRESHOLD = 10
const BRANCH_RE = /(\b(if|else if|for|while|case|catch)\b|\bswitch\b|\?|[&|]{2})/g

/** 提取「函数名 -> [startLine, endLine]」的粗略位置 */
function scanFunctions(lines) {
  const funcs = []
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]
    let m = text.match(/\bfunction\b(?:\s+([\w$]+))?\s*\(/)
    if (!m) m = text.match(/\b([\w$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/)
    if (!m) m = text.match(/\b(?:async\s+)?([\w$]+)\s*\([^)]*\)\s*\{/)
    if (!m) continue

    // 找到本函数体起点（= 该行第一个 { 或下一行）
    let open = text.indexOf('{', m.index)
    let start = i
    if (open === -1) {
      // 花括号可能在下一行
      let j = i + 1
      while (j < lines.length && lines[j].indexOf('{') === -1) j++
      if (j >= lines.length) { start = i; open = 0; } else { start = j; open = lines[j].indexOf('{') }
    }
    // 括号配平找 endLine
    let depth = 1
    let end = start
    let col = open
    for (let j = start; j < lines.length && depth > 0; j++) {
      const seg = lines[j]
      // 第 start 行从开括号后面开始读，避免把函数体起点那个 { 重复计入
      for (let k = j === start ? col + 1 : 0; k < seg.length; k++) {
        const ch = seg[k]
        if (ch === '{') depth++
        else if (ch === '}') depth--
      }
      end = j
    }
    funcs.push({ name: m[1] || '(anon)', start: start + 1, end: end + 1 })
  }
  return funcs
}

function cyclomaticComplexity(lines, startLine, endLine) {
  let score = 1
  for (let i = startLine - 1; i < endLine; i++) {
    BRANCH_RE.lastIndex = 0
    const str = lines[i] ?? ''
    let m
    while ((m = BRANCH_RE.exec(str))) {
      // 跳过注释行
      if (str.trimStart().startsWith('//') || str.trimStart().startsWith('*')) break
      score++
    }
  }
  return score
}

function precheck({ lines, changedLines }) {
  const findings = []
  for (const fn of scanFunctions(lines)) {
    const overlap = [...changedLines].find((n) => n >= fn.start && n <= fn.end)
    if (overlap === undefined) continue
    const score = cyclomaticComplexity(lines, fn.start, fn.end)
    if (score > THRESHOLD) {
      findings.push({
        line: overlap,
        severity: 'warning',
        message: `函数「${fn.name}」的圈复杂度约为 ${score}，超过阈值 ${THRESHOLD}，建议拆分成更小的函数以降低复杂度`,
        source: 'rule',
      })
    }
  }
  return findings
}

export const complexitySkill = {
  id: 'complexity',
  name: '圈复杂度',
  description: '检测圈复杂度超阈值的函数，建议拆分',
  severity: 'warning',
  systemRule: `你是代码质量工程师。审查函数是否过于复杂、是否嵌套过深。判断指标：
1. 圈复杂度过高（大量 if/for/switch/三元/&&/||）应提醒拆分。
2. 函数过长、职责过多，应考虑单一职责原则拆分。
只对变更行给出的函数的整体复杂度意见；用中文建议具体怎么拆。`,
  precheck,
}