/**
 * Skill: 安全审查
 * 规则：SQL 拼接注入 / 参数化查询 / 明文密钥 / 危险函数（eval、exec）等
 * precheck 对最典型的几种做确定性扫描，命中即返回；其余交给 LLM 判断。
 */

const DANGEROUS = [
  { re: /(['"`])(SELECT|INSERT|UPDATE|DELETE|DROP)\b[\s\S]*?\+\s*[A-Za-z_$]\w*\s*/, msg: '疑似 SQL 字符串拼接，存在注入风险，建议使用参数化查询' },
  { re: /\b(eval|exec)\s*\(/g, msg: '禁止直接使用 eval/exec 执行动态字符串，存在代码注入风险' },
  { re: /api[_-]?key\s*[:=]\s*['"`][^'"`]{4,}['"`]/i, msg: '代码中疑似硬编码密钥，应改用环境变量或密钥管理服务' },
  { re: /\b(password|pwd|secret|token)\s*[:=]\s*['"`][^'"`]{4,}['"`]/i, msg: '疑似明文凭据，应避免写死在代码里' },
]

function precheck({ lines, changedLines }) {
  const findings = []
  for (const { re, msg } of DANGEROUS) {
    for (const lineNo of changedLines) {
      const text = lines[lineNo - 1] ?? ''
      if (re.test(text)) {
        findings.push({ line: lineNo, severity: 'error', message: msg, source: 'rule' })
        re.lastIndex = 0
      }
    }
  }
  return findings
}

export const securitySkill = {
  id: 'security',
  name: '安全审查',
  description: '检查注入、硬编码密钥、危险函数调用等安全风险',
  severity: 'error',
  systemRule: `你是资深安全工程师。基于给定的 JavaScript/TypeScript 代码逐行审查安全风险，重点关注：
1. SQL / 参数易被拼接的注入风险，应提醒改用参数化查询。
2. 硬编码的密钥、口令、token，应改为环境变量或密钥管理。
3. eval/exec/Function() 等动态执行危险函数。
4. 未校验的外部输入直接拼进命令、URL、HTML 的 XSS / 命令注入风险。
只对变更行（diff 中新增的行）给出意见；同一处问题只报一次。`,
  precheck,
}