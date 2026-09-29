import type { AuthResponse, User } from '@/types'
import { invoke } from './client'

/**
 * 认证接口（docs/api/rest.md §用户认证）。
 *
 * 单用户本地模式（桌面版，`auth_required=false`）下这些方法一律返回 401 —— 前端不会调用它们
 * （登录页被门禁跳过），若被调用则是明确的编程错误。
 */
export const authApi = {
  /** 注册：仅创建账号（201 返回 {id, username}，不签发 token，需再登录） */
  register: (username: string, password: string): Promise<User> =>
    invoke<User>('auth.register', { username, password }),

  /** 登录：签发 JWT */
  login: (username: string, password: string): Promise<AuthResponse> =>
    invoke<AuthResponse>('auth.login', { username, password }),

  me: (): Promise<User> => invoke<User>('auth.me'),
}
