// 认证状态与能力门禁单测（docs/desktop.md D10）：meta 的三种结局分别如何影响门禁。
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { metaGet, authLogin, authRegister } = vi.hoisted(() => ({
  metaGet: vi.fn(),
  authLogin: vi.fn(),
  authRegister: vi.fn(),
}))

vi.mock('@/api/meta', () => ({ metaApi: { get: metaGet } }))
vi.mock('@/api/auth', () => ({
  authApi: { login: authLogin, register: authRegister, me: vi.fn() },
}))

import { useAuthStore } from './auth'
import { setToken } from '@/api/token'
import type { Meta } from '@/types'

function meta(overrides: Partial<Meta> = {}): Meta {
  return {
    version: '0.1.0',
    auth_mode: 'jwt',
    auth_required: true,
    engine_transport: 'http',
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  metaGet.mockReset()
  authLogin.mockReset()
  authRegister.mockReset()
})

describe('能力门禁（meta）', () => {
  it('Web 模式（auth_required=true）：无 token 即未认证', async () => {
    metaGet.mockResolvedValue(meta())
    const auth = useAuthStore()
    await auth.bootstrap()

    expect(auth.authRequired).toBe(true)
    expect(auth.isLocalMode).toBe(false)
    expect(auth.isAuthenticated).toBe(false)
  })

  it('单用户本地模式（auth_required=false）：无 token 也算已认证，并标记本地模式', async () => {
    metaGet.mockResolvedValue(
      meta({ auth_mode: 'none', auth_required: false, engine_transport: 'stdio' }),
    )
    const auth = useAuthStore()
    await auth.bootstrap()

    expect(auth.authRequired).toBe(false)
    expect(auth.isLocalMode).toBe(true)
    expect(auth.isAuthenticated).toBe(true)
    // 引擎传输方式透出给 UI 悬浮提示
    expect(auth.meta?.engine_transport).toBe('stdio')
  })

  it('meta 拉取失败：按"需要认证"兜底（不误放行）', async () => {
    // 函数形式 reject（见 guard.test.ts 的同名说明）
    metaGet.mockImplementation(() => Promise.reject(new Error('connect ECONNREFUSED')))
    const auth = useAuthStore()
    await expect(auth.bootstrap()).resolves.toBeUndefined()

    expect(auth.meta).toBeNull()
    expect(auth.authRequired).toBe(true)
    expect(auth.isLocalMode).toBe(false)
    expect(auth.isAuthenticated).toBe(false)
  })

  it('未拉取 meta 时（初始态）默认需要认证', () => {
    const auth = useAuthStore()
    expect(auth.authRequired).toBe(true)
    expect(auth.isLocalMode).toBe(false)
    expect(auth.isAuthenticated).toBe(false)
  })

  it('bootstrap 幂等：多次调用只真正请求一次', async () => {
    metaGet.mockResolvedValue(meta())
    const auth = useAuthStore()

    await Promise.all([auth.bootstrap(), auth.bootstrap(), auth.bootstrap()])
    await auth.bootstrap()

    expect(metaGet).toHaveBeenCalledTimes(1)
  })
})

describe('登录/登出', () => {
  it('login 写入 token 与用户；logout 清空', async () => {
    metaGet.mockResolvedValue(meta())
    authLogin.mockResolvedValue({ token: 'jwt-abc', user: { id: 'u1', username: 'alice' } })

    const auth = useAuthStore()
    await auth.bootstrap()
    await auth.login('alice', 'secret12')

    expect(auth.isAuthenticated).toBe(true)
    expect(auth.user?.username).toBe('alice')
    expect(localStorage.getItem('omo_token')).toBe('jwt-abc')

    auth.logout()
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.user).toBeNull()
    expect(localStorage.getItem('omo_token')).toBeNull()
  })

  it('本地模式下即使持有 token 也不算需要认证（isAuthenticated 恒真）', async () => {
    metaGet.mockResolvedValue(meta({ auth_required: false }))
    const auth = useAuthStore()
    await auth.bootstrap()

    auth.logout()
    expect(auth.isAuthenticated).toBe(true)
  })

  it('register：透传后端返回，不写入登录态', async () => {
    metaGet.mockResolvedValue(meta())
    authRegister.mockResolvedValue({ id: 'u2', username: 'bob' })

    const auth = useAuthStore()
    await auth.bootstrap()
    await expect(auth.register('bob', 'secret12')).resolves.toEqual({ id: 'u2', username: 'bob' })

    expect(auth.isAuthenticated).toBe(false)
    setToken(null)
  })
})
