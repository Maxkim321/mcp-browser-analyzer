export const openSidePanel = async () => {
  try {
    const c = globalThis.chrome
    if (!c) return
    const tabs = await c.tabs.query({ active: true, currentWindow: true })
    const tab = tabs[0]
    if (tab && tab.id != null) {
      await c.sidePanel.open({ tabId: tab.id })
    }
  } catch (e) {
    console.error('openSidePanel error', e)
  }
}

export const openOptions = () => {
  try {
    const c = globalThis.chrome
    if (!c) return
    c.runtime.openOptionsPage()
  } catch (e) {
    console.error('openOptions error', e)
  }
}
