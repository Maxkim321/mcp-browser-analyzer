import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRefStore, computeFingerprint } from '../src/content-script/ref-store.js'

/**
 * P12a ref 存储单测：元素身份的发放/复用/失效判定。
 * 用 stub 元素对象（只有 isConnected 标志）——模块核心 DOM 无关。
 * GC 场景无法确定性触发，"元素移除"统一由 isConnected:false 覆盖。
 */

const descriptorOf = (patch = {}) => ({
  tag: 'button',
  id: '',
  name: '',
  type: '',
  text: '提交',
  ...patch,
})

const stubEl = (isConnected = true) => ({ isConnected })

test('register：顺序发 ref（e1/e2…），格式 e<N>', () => {
  const store = createRefStore()
  const r1 = store.register(stubEl(), descriptorOf())
  const r2 = store.register(stubEl(), descriptorOf({ text: '取消' }))
  assert.strictEqual(r1, 'e1')
  assert.strictEqual(r2, 'e2')
})

test('register：同一元素重复枚举复用同一 ref（跨枚举稳定）', () => {
  const store = createRefStore()
  const el = stubEl()
  const desc = descriptorOf()
  const r1 = store.register(el, desc)
  // 模拟第二次枚举：同元素、现场重算的描述（内容相同）
  const r2 = store.register(el, desc)
  assert.strictEqual(r1, r2)
})

test('resolve：存活 + 指纹一致 → ok，返回原元素', () => {
  const store = createRefStore()
  const el = stubEl(true)
  const ref = store.register(el, descriptorOf())
  const r = store.resolve(ref, () => descriptorOf())
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.el, el)
})

test('resolve：元素已移除（isConnected:false）→ 失效 + 可自纠文案', () => {
  const store = createRefStore()
  const el = stubEl(true)
  const ref = store.register(el, descriptorOf())
  el.isConnected = false
  const r = store.resolve(ref, () => descriptorOf())
  assert.strictEqual(r.ok, false)
  assert.match(r.reason, /重新调用 get_interactive_elements/)
})

test('resolve：同对象内容被换（虚拟列表回收）→ 指纹拦截', () => {
  const store = createRefStore()
  const el = stubEl(true)
  const ref = store.register(el, descriptorOf({ text: '提交' }))
  // 同一个节点对象，但文本已被框架换成了别的内容
  const r = store.resolve(ref, () => descriptorOf({ text: '不相关的回收内容' }))
  assert.strictEqual(r.ok, false)
  assert.match(r.reason, /内容已变化/)
})

test('resolve：未知 ref → 不存在 + 可自纠文案', () => {
  const store = createRefStore()
  const r = store.resolve('e99', () => descriptorOf())
  assert.strictEqual(r.ok, false)
  assert.match(r.reason, /不存在/)
})

test('resolve：失效后的 ref 被清理，再解析直接报不存在', () => {
  const store = createRefStore()
  const el = stubEl(true)
  const ref = store.register(el, descriptorOf())
  el.isConnected = false
  store.resolve(ref, () => descriptorOf())
  const r2 = store.resolve(ref, () => descriptorOf())
  assert.strictEqual(r2.ok, false)
  assert.match(r2.reason, /不存在/)
})

test('computeFingerprint：指纹由 tag/id/name/type/text 构成，text 截 40', () => {
  assert.strictEqual(
    computeFingerprint({ tag: 'input', type: 'email', text: 'x' }),
    'input|||email|x'
  )
  const long = { tag: 'button', text: '长'.repeat(50) }
  const fp = computeFingerprint(long)
  const tail = fp.split('|').pop()
  assert.strictEqual(tail.length, 40)
})
