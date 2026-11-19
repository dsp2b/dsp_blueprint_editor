import { createApp } from 'vue'
import App from './App.vue'
import i18n from './i18n'
import { registerServiceWorker } from './serviceWorker'

createApp(App).use(i18n).mount('#app')
registerServiceWorker()
