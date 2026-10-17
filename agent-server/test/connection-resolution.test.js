/** 连接生命周期：回合中通道重建后 connectionId 动态回落（P12c 收尾） */
const test = require('node:test')
const assert = require('node:assert/strict')
const handler = require('../src/tools/handler.js')

test('resolveConnectionId：显式传入且连接活跃 → 原样返回', () => {
  handler.init({ manager: { getIds: () => [3, 7] } })
  assert.strictEqual(handler.resolveConnectionId(7, { connectionId: 3 }), 7)
})

test('resolveConnectionId：回合内固化的 connectionId 失效 → 回落到最新活跃连接', () => {
  handler.init({ manager: { getIds: () => [12] } })
  // 回合开始时 connectionId=2，中途通道重建（2 已死，最新活跃=12）
  assert.strictEqual(handler.resolveConnectionId(2, { connectionId: 2 }), 12)
  // providedId 失效同样回落
  assert.strictEqual(handler.resolveConnectionId(2, {}), 12)
})

test('resolveConnectionId：无任何活跃连接 → 保持原值（上层发送时自然报不可用）', () => {
  handler.init({ manager: { getIds: () => [] } })
  assert.strictEqual(handler.resolveConnectionId(2, {}), 2)
})

test('resolveConnectionId：非法值照旧抛错（行为保持）', () => {
  handler.init({ manager: { getIds: () => [1] } })
  assert.throws(() => handler.resolveConnectionId(-1, {}), /Invalid connectionId/)
  assert.throws(() => handler.resolveConnectionId('abc', {}), /Invalid connectionId/)
})
