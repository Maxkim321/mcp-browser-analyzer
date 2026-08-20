/**
 * Skill: 命名规范
 * 规则：变量/函数/常量命名是否清晰、符合团队规范；
 * 常见：全小写下划线 vs camelCase 混用、语义不明的单字母、magic number。
 * 以 LLM 判断为主（语义层面的建议更准），precheck 做轻度启发式扫描。
 */

const HEURISTIC = [
  { re: /\b(a|b|c|x|y|z|i|j|k|data|temp|tmp|val|res)\b\s*[:=]\s/g, msg: '变量命名过于模糊，建议改用能表达语义的名称，例如将其意图说清楚' },
  { re: /(?:const|let|var)\s+[a-z0-9_]+[A-Z]/g, msg: '驼峰和下划线风格混用，建议统一命名风格' },
]

function precheck({ lines, changedLines }) {
  const findings = []
  for (const { re, msg } of HEURISTIC) {
    for (const lineNo of changedLines) {
      const text = lines[lineNo - 1] ?? ''
      if (re.test(text)) {
        findings.push({ line: lineNo, severity: 'nit', message: msg, source: 'rule' })
        re.lastIndex = 0
      }
    }
  }
  return findings
}

export const namingSkill = {
  id: 'naming',
  name: '命名规范',
  description: '检查变量/函数命名是否清晰、风格一致',
  severity: 'nit',
  systemRule: `你是资深前端/后端工程师。基于给定代码审查命名质量：
1. 变量/参数/函数名是否清晰表达含义，避免单字母或无意义命名（a、tmp、data、val）。
2. 命名风格是否一致（建议 camelCase 变量 / PascalCase 类 / UPPER_SNAKE 常量）。
3. 是否有可读性差的缩写。
只对变更行给出意见，建议给出具体的新命名方案；同一处只报一次。`,
  precheck,
}