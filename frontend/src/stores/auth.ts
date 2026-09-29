import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { authApi } from '@/api/auth'
import { metaApi } from '@/api/meta'
import { getToken, setToken } from '@/api/token'
import type { Meta, User } from '@/types'

const USER_KEY = 'omo_user'

function loadUser(): User | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as User
  } catch {
    localStorage.removeItem(USER_KEY)
    return null
  }
}

/**
 * 认证状态 + 能力门禁（docs/desktop.md D10）。
 *
 * - 启动时拉取 `meta`（HTTP `GET /api/meta` / RPC `meta`），据 `auth_required` 决定是否要求登录；
 * - **桌面单用户模式**（`auth_required === false`）：`isAuthenticated` 恒为 true、跳过登录页、
 *   顶栏显示"本地模式"；token 不参与；
 * - **meta 拉取失败**（网络/传输异常）：按"需要认证"处理，避免误放行受保护页面。
 */
export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(getToken())
  const user = ref<User | null>(loadUser())

  /** 能力声明（null = 尚未取得或取得失败） */
  const meta = ref<Meta | null>(null)

  /** 是否需要登录：未取得 meta 或取得失败时按 true 兜底（安全默认） */
  const authRequired = computed(() => meta.value?.auth_required ?? true)

  /** 是否为已确认的单用户本地模式（用于顶栏标记与退出按钮的显隐） */
  const isLocalMode = computed(() => meta.value !== null && !authRequired.value)

  /** 可否访问受保护页面：需要认证时看 token，否则一律放行 */
  const isAuthenticated = computed(() => !authRequired.value || token.value !== null)

  let bootstrapPromise: Promise<void> | null = null

  async function loadMeta(): Promise<void> {
    try {
      meta.value = await metaApi.get()
    } catch {
      // 失败不抛出：门禁按"需要认证"兜底，登录页会给出连接错误提示
      meta.value = null
    }
  }

  /**
   * 拉取能力声明（幂等：多次调用只真正请求一次）。
   * main.ts 在挂载前调用，路由守卫调用以兜底（避免直接深链时门禁未就绪）。
   */
  function bootstrap(): Promise<void> {
    bootstrapPromise ??= loadMeta()
    return bootstrapPromise
  }

  function applyAuth(next: { token: string; user: User }): void {
    token.value = next.token
    user.value = next.user
    setToken(next.token)
    localStorage.setItem(USER_KEY, JSON.stringify(next.user))
  }

  async function login(username: string, password: string): Promise<void> {
    applyAuth(await authApi.login(username, password))
  }

  /** 注册：仅创建账号，不写入登录态（后端不签发 token，需再登录）。 */
  async function register(username: string, password: string): Promise<User> {
    return authApi.register(username, password)
  }

  function logout(): void {
    token.value = null
    user.value = null
    setToken(null)
    localStorage.removeItem(USER_KEY)
  }

  return {
    token,
    user,
    meta,
    authRequired,
    isLocalMode,
    isAuthenticated,
    bootstrap,
    login,
    register,
    logout,
  }
})
