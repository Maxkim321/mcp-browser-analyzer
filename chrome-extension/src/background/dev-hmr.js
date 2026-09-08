// dev service worker = 完整 background 逻辑 + HMR 自动重载
// 必须复用 main.js：否则 dev 模式下 text_action / get_page_content 等处理器全部缺失
import './main.js'

const url = globalThis.__EXT_HMR__
let es
const connect = () => {
  try {
    es = new EventSource(url)
    es.onmessage = () => {
      const c = globalThis.chrome
      if (c && c.runtime && typeof c.runtime.reload === 'function') c.runtime.reload()
    }
    es.onerror = () => {
      try {
        es.close()
      } catch (e) {
        void e
      }
      setTimeout(connect, 1000)
    }
  } catch {
    setTimeout(connect, 1000)
  }
}
connect()
