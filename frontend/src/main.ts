import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import router from './router'
import { useAuthStore } from './stores/auth'

import './styles/main.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)

// 先取能力声明（meta）再挂载：单用户本地模式要跳过登录页，
// 否则会先闪一下登录页再被守卫重定向（docs/desktop.md D10）。
// bootstrap 内部已吞掉失败（失败按"需要认证"兜底），故 finally 一定会执行。
const auth = useAuthStore(pinia)
void auth.bootstrap().finally(() => {
  app.use(router)
  app.mount('#app')
})
