/**
 * Skill 抽象：一个 Skill = 一条审查关注点
 *  - systemRule: 喂给 LLM 的系统审查规则（prompt 模板）
 *  - precheck: 可选的确定性规则校验（不依赖 LLM 的快速硬查），返回 [{line, severity, message}]
 * 输出格式统一为 { line, severity, message }
 */
export { securitySkill } from './security.js'
export { namingSkill } from './naming.js'
export { complexitySkill } from './complexity.js'