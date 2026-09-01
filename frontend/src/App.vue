<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()

function logout(): void {
  auth.logout()
  router.push({ name: 'login' })
}

// 401（token 过期等）统一回到登录页
function onUnauthorized(): void {
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
        <RouterLink to="/history" active-class="active">任务历史</RouterLink>
      </nav>
      <div v-if="auth.isAuthenticated" class="user-box">
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
