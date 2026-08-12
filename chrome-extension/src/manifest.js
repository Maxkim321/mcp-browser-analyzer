import { createRequire } from 'node:module'
import { isDev, port } from './utils/config.js'

const require = createRequire(import.meta.url)
const pkg = require('../package.json')

export const getManifest = () => {
  const m = {
    manifest_version: 3,
    name: '浏览器 AI 助手',
    description: '在浏览器侧边栏和 AI 对话：总结网页、划词翻译/解释/改写、围绕页面内容追问',
    version: pkg.version,
    icons: {
      16: 'dist/icons/logo-16.png',
      32: 'dist/icons/logo-32.png',
      48: 'dist/icons/logo-48.png',
      128: 'dist/icons/logo-128.png',
    },
    action: {
      default_popup: 'dist/src/popup/index.html',
      default_icon: {
        16: 'dist/icons/logo-16.png',
        32: 'dist/icons/logo-32.png',
      },
    },
    side_panel: { default_path: 'dist/src/ui/sidepanel/index.html' },
    options_page: 'dist/src/ui/options/index.html',
    permissions: ['storage', 'sidePanel', 'activeTab', 'tabs', 'scripting'],
    host_permissions: isDev 
      ? [`http://localhost:${port}/*`, 'ws://localhost:9999/*', '<all_urls>'] 
      : ['ws://localhost:9999/*', '<all_urls>'],
    background: isDev
      ? { service_worker: 'dist/script/dev-hmr.js', type: 'module' }
      : { service_worker: 'dist/script/background.js', type: 'module' },
    content_scripts: [
      {
        // 默认 isolated world：chrome.* API 完整且不被页面 JS 污染（MAIN world 会被掘金等站点删除 window.chrome）
        matches: ['<all_urls>'],
        js: ['dist/src/content-script/index.js'],
        run_at: 'document_idle',
      },
    ],
    web_accessible_resources: [
      { 
        resources: ['dist/*'], 
        matches: ['<all_urls>'] 
      },
    ],
  }
  if (isDev) {
    m.content_security_policy = {
      extension_pages: `script-src 'self' http://localhost:${port}; object-src 'self'; connect-src 'self' ws://localhost:${port} ws://localhost:9999 http://localhost:${port}`,
    }
  }
  return m
}

export default getManifest
