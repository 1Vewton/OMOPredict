<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()

// 便于排障：把 meta 里的引擎传输方式放进标记的悬浮提示
const localModeTip = computed(() => {
  const transport = auth.meta?.engine_transport
  return transport
    ? `单用户本地模式：无登录、无网络传输，仅限本机使用（引擎传输：${transport}）`
    : '单用户本地模式：无登录、无网络传输，仅限本机使用'
})

function logout(): void {
  auth.logout()
  router.push({ name: 'login' })
}

// 401（token 过期等）统一回到登录页。
// 单用户本地模式没有认证，忽略该事件——否则被拒的 auth.* 调用会把用户误踢到登录页。
function onUnauthorized(): void {
  if (!auth.authRequired) return
  auth.logout()
  router.push({ name: 'login' })
}

onMounted(() => window.addEventListener('omo:unauthorized', onUnauthorized))
onBeforeUnmount(() => window.removeEventListener('omo:unauthorized', onUnauthorized))
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="brand">
        <span class="brand-mark">OMO</span>
        <span>OMOPredict</span>
      </div>
      <nav v-if="auth.isAuthenticated" class="nav">
        <RouterLink to="/design" active-class="active">参数设计</RouterLink>
        <RouterLink to="/optimize" active-class="active">目标反推</RouterLink>
        <RouterLink to="/history" active-class="active">任务历史</RouterLink>
      </nav>
      <!-- 桌面单用户模式：只显示模式标记（无账号概念、无退出）；Web 模式：用户名 + 退出 -->
      <div v-if="auth.isLocalMode" class="user-box">
        <span class="mode-badge" :title="localModeTip">本地模式</span>
      </div>
      <div v-else-if="auth.isAuthenticated" class="user-box">
        <span class="username">{{ auth.user?.username }}</span>
        <button class="btn btn-ghost" type="button" @click="logout">退出</button>
      </div>
    </header>
    <main class="app-main">
      <RouterView />
    </main>
    <footer class="app-footer">OMO 纳米多层薄膜仿真 · 对标高水平论文实测数据</footer>
  </div>
</template>
