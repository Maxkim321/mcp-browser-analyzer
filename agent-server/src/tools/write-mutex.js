/**
 * 跨会话写互斥锁（P16 并行安全——资源仲裁）
 *
 * 背景：P15 之后多个会话的 Agent 并行工作，但它们共享同一台浏览器。
 * 上下文可以隔离，"手"是同一双：写动作（点击/填表）和页面变更（导航/刷新）
 * 如果跨会话并行执行，会在同一批 tab 上互相踩（A 的审批还没答完 B 的点击
 * 已经落下去、两个会话同时导航同一个 tab）。读操作无状态可并行。
 *
 * 这是操作系统"设备互斥"的经典形态：读并行、写全局互斥（单写者锁）。
 * 等待超过 timeoutMs 抛出可自纠错误——LLM 收到后可以"稍后重试或先做只读
 * 步骤"，与 ref 体系的"可自纠"契约同构。
 *
 * FIFO 公平：按到达顺序串行，先到先得。
 */

function createWriteMutex({
  /** 等待写锁的超时：写动作含审批等待（120s）+执行（30s），180s 覆盖单次最坏情况 */
  timeoutMs = 180000,
  /** 超时错误话术（给 LLM 的可自纠信息） */
  busyMessage = '另一会话正在执行浏览器写操作',
} = {}) {
  let busy = false
  const waiters = []

  const acquire = () =>
    new Promise((resolve, reject) => {
      if (!busy) {
        busy = true
        resolve()
        return
      }
      const waiter = { resolve: null }
      waiter.timer = setTimeout(() => {
        const i = waiters.indexOf(waiter)
        if (i >= 0) waiters.splice(i, 1)
        reject(
          new Error(
            `${busyMessage}，等待超过 ${Math.round(timeoutMs / 1000)}s。请稍后重试本步骤，或先执行其他只读步骤`
          )
        )
      }, timeoutMs)
      waiter.resolve = () => {
        clearTimeout(waiter.timer)
        busy = true
        resolve()
      }
      waiters.push(waiter)
    })

  const release = () => {
    const next = waiters.shift()
    if (next) next.resolve()
    else busy = false
  }

  /**
   * 在写锁内执行 fn：调用即入队（acquire 内部 FIFO，等待期间超时可触发），
   * 持有期间独占，fn 抛错也保证释放
   * @returns {Promise<*>} fn 的返回值；等待超时 reject busy 错误
   */
  const runExclusive = (fn) =>
    acquire().then(async () => {
      try {
        return await fn()
      } finally {
        release()
      }
    })

  const isBusy = () => busy
  /** 当前排队中的等待者数量（不含持有者） */
  const queueLength = () => waiters.length

  return { runExclusive, isBusy, queueLength }
}

module.exports = { createWriteMutex }
