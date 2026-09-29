// 路由守卫单测：三种 meta 结局 × 目标路由的放行/重定向矩阵。
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RouteLocationNormalized } from 'vue-router'

const { metaGet } = vi.hoisted(() => ({ metaGet: vi.fn() }))
vi.mock('@/api/meta', () => ({ metaApi: { get: metaGet } }))

import { authGuard } from './guard'
import { useAuthStore } from '@/stores/auth'
import { setToken } from '@/api/token'
import type { Meta } from '@/types'

/** 造一个够用的路由对象（守卫只读 name / meta.public / fullPath）。 */
function route(
  name: string,
  opts: { public?: boolean; fullPath?: string } = {},
): RouteLocationNormalized {
  return {
    name,
    fullPath: opts.fullPath ?? `/${name}`,
    meta: opts.public ? { public: true } : {},
  } as unknown as RouteLocationNormalized
}

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
})

describe('Web 模式（auth_required=true）', () => {
  beforeEach(() => metaGet.mockResolvedValue(meta()))

  it('未认证访问受保护页面 → 跳登录页并带上 redirect', async () => {
    await expect(authGuard(route('design', { fullPath: '/design' }))).resolves.toEqual({
      name: 'login',
      query: { redirect: '/design' },
    })
  })

  it('未认证访问 public 页面（登录页）→ 放行', async () => {
    await expect(authGuard(route('login', { public: true }))).resolves.toBeUndefined()
  })

  it('已认证访问受保护页面 → 放行', async () => {
    setToken('jwt-abc')
    setActivePinia(createPinia()) // 让 store 重新读取已被写入的 token
    await expect(authGuard(route('history'))).resolves.toBeUndefined()
  })

  it('已认证访问登录页 → 跳回设计页', async () => {
    setToken('jwt-abc')
    setActivePinia(createPinia())
    await expect(authGuard(route('login', { public: true }))).resolves.toEqual({ name: 'design' })
  })
})

describe('单用户本地模式（auth_required=false）', () => {
  beforeEach(() => metaGet.mockResolvedValue(meta({ auth_mode: 'none', auth_required: false })))

  it('无 token 也放行受保护页面', async () => {
    await expect(authGuard(route('design'))).resolves.toBeUndefined()
    await expect(authGuard(route('history'))).resolves.toBeUndefined()
  })

  it('登录页 → 重定向到设计页（该模式没有账号概念）', async () => {
    await expect(authGuard(route('login', { public: true }))).resolves.toEqual({ name: 'design' })
  })
})

describe('meta 拉取失败（兜底为需要认证）', () => {
  // 用函数形式 reject：mockRejectedValue 会在配置时就生成已拒绝的 promise，
  // 未被消费时会被 Vitest 报成 unhandled rejection。
  beforeEach(() => {
    metaGet.mockImplementation(() => Promise.reject(new Error('ECONNREFUSED')))
  })

  it('受保护页面仍要求登录（不误放行）', async () => {
    await expect(authGuard(route('design'))).resolves.toEqual({
      name: 'login',
      query: { redirect: '/design' },
    })
  })

  it('登录页放行（否则无法登录）', async () => {
    await expect(authGuard(route('login', { public: true }))).resolves.toBeUndefined()
  })

  it('store 的门禁状态与兜底一致', async () => {
    await authGuard(route('design'))
    const auth = useAuthStore()
    expect(auth.authRequired).toBe(true)
    expect(auth.isLocalMode).toBe(false)
  })
})
