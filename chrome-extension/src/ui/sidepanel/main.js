import { createApp } from 'vue'
import App from './SidePanel.vue'
import { setupApp } from '@/logic/common-setup'

const app = createApp(App)
setupApp(app)
app.mount('#app')
