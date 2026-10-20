/**
 * 回合工作 tab 注册表（P16 并行安全——tab 所有权粘性）
 *
 * 背景：读路径工具（get_page_content / get_interactive_elements / navigate 等）
 * 此前按"当前激活 tab"解析目标——两个会话并行时会互相踩（A 激活的 tab 不是 B
 * 想读的），用户切窗口也会读错页（掘金实测：tab 焦点被腾讯会议抢走）。
 *
 * 机制：服务端按会话记忆"该回合最近触碰的 tab"（从带 tabId 的工具结果回捕），
 * 后续工具命令附带 tabId 提示；客户端优先用提示 tab（有效则粘住），无效或缺失
 * 才回落 activeTab。P13 的写链路粘性推广到全部读路径。
 *
 * 这是"设备所有权租约"的轻量形态：不独占 tab（用户随时可以自己用），
 * 只保证 Agent 的连续操作落在同一个 tab 上。
 */

function createWorkingTabRegistry({ maxTabs = 16 } = {}) {
  /** sessionKey（`${connectionId}:${sessionId}`）→ { tabId, lastUsedAt } */
  const tabs = new Map()
  // 单调 tick：同毫秒内多次触碰也能分出先后（Date.now 粒度不够）
  let tick = 0

  const evictIfNeeded = (keepKey) => {
    if (tabs.size <= maxTabs) return
    let oldestKey = null
    let oldestTs = Infinity
    for (const [key, entry] of tabs) {
      if (key === keepKey) continue
      if (entry.lastUsedAt < oldestTs) {
        oldestTs = entry.lastUsedAt
        oldestKey = key
      }
    }
    if (oldestKey !== null) tabs.delete(oldestKey)
  }

  /** 取该会话的工作 tab 提示（无则 null）；命中刷新 LRU */
  const get = (key) => {
    const entry = tabs.get(key)
    if (!entry) return null
    entry.lastUsedAt = ++tick
    return entry.tabId
  }

  /** 回捕：该会话的工具结果触碰了某个 tab → 记为工作 tab */
  const capture = (key, tabId) => {
    if (!Number.isFinite(tabId)) return
    let entry = tabs.get(key)
    if (!entry) {
      entry = { tabId, lastUsedAt: 0 }
      tabs.set(key, entry)
      evictIfNeeded(key)
    }
    entry.tabId = tabId
    entry.lastUsedAt = ++tick
  }

  /** 回合结束：清除该会话的工作 tab */
  const clear = (key) => tabs.delete(key)

  /** 连接关闭：按前缀清除该连接全部会话的工作 tab */
  const clearConnection = (connectionId) => {
    const prefix = `${connectionId}:`
    for (const key of Array.from(tabs.keys())) {
      if (key.startsWith(prefix)) tabs.delete(key)
    }
  }

  const size = () => tabs.size

  return { get, capture, clear, clearConnection, size }
}

module.exports = { createWorkingTabRegistry }
