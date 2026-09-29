import type { RouteLocationNormalized, RouteLocationRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

/**
 * 路由守卫：先确保能力声明（meta）就绪，再按模式分流。
 *
 * - **单用户本地模式**（`auth_required === false`，桌面版）：放行全部页面，
 *   并把 `/login` 重定向到设计页（该模式没有账号概念）。
 * - **需认证模式**（Web，默认）：未认证只能访问 `public` 页面；已登录访问登录页则跳回设计页。
 * - meta 拉取失败时 `authRequired` 为 true（安全兜底），因此不会误放行。
 *
 * 独立成模块（而非写在 router/index.ts 里）是为了让单测能直接调用它，
 * 不必实例化 router，也不会因导入而触达路由表与视图组件（`guard.test.ts`）。
 */
export async function authGuard(to: RouteLocationNormalized): Promise<RouteLocationRaw | void> {
  const auth = useAuthStore()
  await auth.bootstrap() // 幂等：仅首次真正请求

  if (!auth.authRequired) {
    if (to.name === 'login') return { name: 'design' }
    return
  }

  if (!to.meta.public && !auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.name === 'login' && auth.isAuthenticated) {
    return { name: 'design' }
  }
}
