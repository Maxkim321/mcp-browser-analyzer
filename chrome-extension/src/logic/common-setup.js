const connectHmr = () => {
  const url = globalThis.__EXT_HMR__
  if (!url) return
  let es
  const open = () => {
    try {
      es = new EventSource(url)
      es.onmessage = () => window.location.reload()
      es.onerror = () => {
        try {
          es.close()
        } catch {
          /* noop */
        }
        setTimeout(open, 1000)
      }
    } catch (e) {
      console.error('connect hmr error', e)
      setTimeout(open, 1000)
    }
  }
  open()
}

connectHmr()

export const setupApp = (app) => app
