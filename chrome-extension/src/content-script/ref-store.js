/**
 * P12a 写操作 ref 存储：元素身份的发放与校验（DOM 无关纯逻辑，node:test 直测）
 *
 * 为什么是 ref 不是选择器：CSS 选择器是"重新解释"——枚举到执行之间 DOM 一变，
 * querySelector 可能静默命中另一个元素，审批给的是假安全感。ref 绑定元素身份：
 * 枚举时发 ref（WeakRef 持元素 + 指纹快照），执行时 resolve 校验，失效即报错
 * （绝不重查选择器碰运气）——"审批的东西 = 执行的东西"由此变成确定性。
 *
 * 指纹的意义：同一 DOM 节点对象被虚拟列表"回收复用"时（同对象、已连接、内容
 * 全换），仅靠对象身份会误判为有效——指纹比对把这类"内容偷换"也拦下来。
 *
 * 生命周期：content script 存活期（页面导航即整体重置）。ref 对 LLM 是会话内
 * 短生命周期凭据，失效错误文案保持"可自纠"契约（引导重新枚举）。
 */

let seq = 0

/** 指纹：tag+id+name+type+text 拼串（结构身份的轻量近似，纯函数） */
export function computeFingerprint(descriptor) {
  return [
    descriptor.tag || '',
    descriptor.id || '',
    descriptor.name || '',
    descriptor.type || '',
    String(descriptor.text || '').slice(0, 40),
  ].join('|')
}

export function createRefStore() {
  const refToEntry = new Map() // ref -> { weak: WeakRef, fingerprint }
  const elToRef = new WeakMap() // element -> ref：同元素重复枚举复用旧 ref

  return {
    /**
     * 发放/复用 ref。descriptor 由 DOM 侧 buildDescriptor(el) 产出（含 tag/id/name/type/text）。
     * 同一元素对象重复注册返回同一 ref，跨多次枚举保持稳定。
     */
    register(el, descriptor) {
      const existing = elToRef.get(el)
      if (existing && refToEntry.has(existing)) return existing
      const ref = `e${++seq}`
      refToEntry.set(ref, {
        weak: new WeakRef(el),
        fingerprint: computeFingerprint(descriptor),
      })
      elToRef.set(el, ref)
      return ref
    },

    /**
     * 执行前校验并解析。describe(el) 是注入的现场描述函数（DOM 侧传 buildDescriptor）——
     * 对活元素重算指纹：对象身份相同但内容被换（虚拟列表回收）时指纹比对会拦下。
     * 失败 reason 全部保持"可自纠"契约：引导 LLM 重新枚举，绝不盲操作。
     */
    resolve(ref, describe) {
      const entry = refToEntry.get(ref)
      if (!entry) {
        return {
          ok: false,
          reason: `ref ${ref} 不存在或来自更早的页面状态，请重新调用 get_interactive_elements 获取最新快照`,
        }
      }
      const el = entry.weak.deref()
      if (!el || el.isConnected === false) {
        refToEntry.delete(ref)
        return {
          ok: false,
          reason: `ref ${ref} 指向的元素已从页面移除（页面可能已跳转或重新渲染），请重新调用 get_interactive_elements`,
        }
      }
      if (entry.fingerprint !== computeFingerprint(describe(el))) {
        refToEntry.delete(ref)
        return {
          ok: false,
          reason: `ref ${ref} 指向的元素内容已变化（可能是虚拟列表回收或组件重渲染），请重新调用 get_interactive_elements 后引用新 ref`,
        }
      }
      return { ok: true, el }
    },

    /** 当前有效 ref 数（观测用） */
    get size() {
      return refToEntry.size
    },
  }
}
