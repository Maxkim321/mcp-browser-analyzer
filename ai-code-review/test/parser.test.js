import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDiff, shouldSkip, normalizeSeverity } from '../src/parser.js'

const NEW_FILE = `diff --git a/src/order.js b/src/order.js
new file mode 100644
--- /dev/null
+++ b/src/order.js
@@ -0,0 +1,3 @@
+const sql = "SELECT * FROM o WHERE id = " + id
+const a = 1
+return a
`

test('解析新增文件：行号连续、全部为新增行', () => {
  const files = parseDiff(NEW_FILE)
  assert.equal(files.length, 1)
  assert.equal(files[0].path, 'src/order.js')
  const hunk = files[0].hunks[0]
  assert.equal(hunk.newStart, 1)
  assert.equal(hunk.lines.length, 3)
  assert.deepEqual(hunk.lines.map((l) => l.newLine), [1, 2, 3])
  assert.equal(hunk.lines.every((l) => l.type === 'add'), true)
})

const HUNK = `diff --git a/a.js b/a.js
--- a/a.js
+++ b/a.js
@@ -10,4 +10,5 @@ context before
 context line
-removed line
+added line1
+added line2
 context after
`

test('解析 hunk：删除行无新行号，新增行号在上下文之后正确推进', () => {
  const files = parseDiff(HUNK)
  const lines = files[0].hunks[0].lines
  // newStart=10，新文件侧顺序：context(10) -> removed(无) -> add(11) -> add(12)
  const ctx = lines.find((l) => l.type === 'ctx' && l.text === 'context line')
  assert.equal(ctx.newLine, 10)
  const removed = lines.find((l) => l.type === 'del')
  assert.equal(removed.newLine, null)
  const adds = lines.filter((l) => l.type === 'add').map((l) => l.newLine)
  assert.deepEqual(adds, [11, 12])
})

test('shouldSkip / normalizeSeverity', () => {
  assert.equal(shouldSkip('src/app.lock.json', ['*.lock.json', 'dist/']), true)
  assert.equal(shouldSkip('src/a.test.js', ['*.lock.json']), false)
  assert.equal(normalizeSeverity('blocker'), 'error')
  assert.equal(normalizeSeverity('WARN'), 'warning')
  assert.equal(normalizeSeverity('style'), 'nit')
})