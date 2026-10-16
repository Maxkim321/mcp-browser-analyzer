/**
 * P12a 操作可视化覆盖层：AI 写动作执行时的"看得见"
 *
 * 定位：白盒叙事的"做的时候看见"——审批卡是做之前看清，trace 是做完可回看，
 * 这层动画补上执行瞬间的过程可视化（业界惯例：夸克 AI 操作 / Operator 同款思路）。
 *
 * 实现要点：
 * - closed shadow root 承载全部样式：页面 CSS 污染不进来，我们的样式也漏不出去
 * - 覆盖层 host 挂在 documentElement（不是 body）：executeWriteAction 的动作后
 *   校验观察的是 body 的 MutationObserver——自己的动画不能污染"页面有无变化"判定
 * - pointer-events:none + z-index 顶格：纯视觉层，绝不拦截真实点击
 * - prefers-reduced-motion 时跳过动画直接返回（无障碍）
 */

const CURSOR_GLOW = 'rgba(124, 108, 255, 0.55)'
const CURSOR_COLOR = '#7c6cff'
const TRAIL_COLOR = '#67e8f9'
const MOVE_MS = 340

let host = null
let shadow = null
let cursorEl = null
let pillEl = null
let ringEl = null
let hideTimer = null

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const OVERLAY_CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .cursor {
    position: fixed;
    left: 0; top: 0;
    width: 14px; height: 14px;
    margin: -7px 0 0 -7px;
    border-radius: 50%;
    background: ${CURSOR_COLOR};
    box-shadow:
      0 0 12px 4px ${CURSOR_GLOW},
      0 0 0 5px rgba(103, 232, 249, 0.35);
    opacity: 0;
    transition:
      left ${MOVE_MS}ms cubic-bezier(0.22, 0.9, 0.35, 1),
      top ${MOVE_MS}ms cubic-bezier(0.22, 0.9, 0.35, 1),
      opacity 180ms ease;
    will-change: left, top;
  }
  .cursor.visible { opacity: 1; }
  .ripple {
    position: fixed;
    width: 34px; height: 34px;
    margin: -17px 0 0 -17px;
    border-radius: 50%;
    border: 2px solid ${TRAIL_COLOR};
    opacity: 0.9;
    animation: ba-ripple 520ms ease-out forwards;
  }
  @keyframes ba-ripple {
    from { transform: scale(0.4); opacity: 0.9; }
    to { transform: scale(2); opacity: 0; }
  }
  .ring {
    position: fixed;
    border-radius: 10px;
    border: 2px solid ${CURSOR_COLOR};
    box-shadow: 0 0 10px 2px ${CURSOR_GLOW};
    opacity: 0;
    transition: opacity 150ms ease;
    animation: ba-pulse 700ms ease-in-out infinite;
  }
  .ring.visible { opacity: 1; }
  @keyframes ba-pulse {
    0%, 100% { box-shadow: 0 0 8px 1px ${CURSOR_GLOW}; }
    50% { box-shadow: 0 0 16px 5px ${CURSOR_GLOW}; }
  }
  .pill {
    position: fixed;
    top: 14px; left: 50%;
    transform: translateX(-50%);
    padding: 6px 16px;
    border-radius: 999px;
    background: rgba(15, 18, 34, 0.92);
    border: 1px solid rgba(124, 108, 255, 0.65);
    color: #c7d2fe;
    font: 500 12px/1.4 system-ui, -apple-system, sans-serif;
    letter-spacing: 0.02em;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35), 0 0 12px rgba(124, 108, 255, 0.25);
    opacity: 0;
    transition: opacity 180ms ease;
    white-space: nowrap;
  }
  .pill.visible { opacity: 1; }
`

function ensureOverlay() {
  if (host && host.isConnected) return true
  if (!document.documentElement) return false
  host = document.createElement('div')
  host.id = '__ba_action_overlay__' // e2e/调试探测锚点（内部样式在 closed shadow 里，外部不可见）
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647'
  shadow = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = OVERLAY_CSS
  shadow.appendChild(style)
  cursorEl = document.createElement('div')
  cursorEl.className = 'cursor'
  shadow.appendChild(cursorEl)
  pillEl = document.createElement('div')
  pillEl.className = 'pill'
  shadow.appendChild(pillEl)
  document.documentElement.appendChild(host)
  return true
}

/** 目标元素中心视口坐标（scroll 不影响 fixed 定位，rect 本就是视口系） */
function centerOf(el) {
  const rect = el.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

/**
 * 动作执行动画：光标缓动移到目标 → click 出涟漪 / fill+select 目标脉冲外圈。
 * 返回 promise（动画播完），执行方 await 完再动 DOM——"先看见，再发生"。
 * @param {Element} el 目标元素
 * @param {string} action click | fill | select
 * @param {string} label 人类可读说明（pill 展示，如 button「立即订阅」）
 */
export async function playActionOverlay(el, action, label) {
  if (!ensureOverlay()) return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  clearTimeout(hideTimer)

  const { x, y } = centerOf(el)
  pillEl.textContent = `AI 正在操作 · ${label}`
  pillEl.classList.add('visible')
  cursorEl.classList.add('visible')
  // 首次出现：从右上斜向切入，之后在动作间连续移动（有"手"的连续感）
  if (!cursorEl.style.left) {
    cursorEl.style.left = `${x + 80}px`
    cursorEl.style.top = `${y - 80}px`
  }
  cursorEl.style.left = `${x}px`
  cursorEl.style.top = `${y}px`
  await sleep(MOVE_MS + 60)

  if (action === 'click') {
    const ripple = document.createElement('div')
    ripple.className = 'ripple'
    ripple.style.left = `${x}px`
    ripple.style.top = `${y}px`
    shadow.appendChild(ripple)
    setTimeout(() => ripple.remove(), 560)
  } else {
    // fill/select：目标外圈脉冲框，替代涟漪
    const rect = el.getBoundingClientRect()
    if (!ringEl) {
      ringEl = document.createElement('div')
      ringEl.className = 'ring'
      shadow.appendChild(ringEl)
    }
    ringEl.style.left = `${rect.left - 4}px`
    ringEl.style.top = `${rect.top - 4}px`
    ringEl.style.width = `${rect.width + 8}px`
    ringEl.style.height = `${rect.height + 8}px`
    ringEl.classList.add('visible')
  }
}

/** 动作收尾：pill/高亮退场，光标短暂停留后淡出（动作间保持连续感） */
export function settleActionOverlay() {
  if (!host || !host.isConnected) return
  pillEl.classList.remove('visible')
  if (ringEl) ringEl.classList.remove('visible')
  clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    cursorEl.classList.remove('visible')
  }, 1200)
}
