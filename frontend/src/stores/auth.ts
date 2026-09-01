import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { authApi } from '@/api/auth'
import { getToken, setToken } from '@/api/http'
import type { User } from '@/types'

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

/** 认证状态：token + 用户信息，localStorage 持久化（刷新不掉线）。 */
export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(getToken())
  const user = ref<User | null>(loadUser())

  const isAuthenticated = computed(() => token.value !== null)

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

  return { token, user, isAuthenticated, login, register, logout }
})
