import type { AuthResponse, User } from '@/types'
import { http } from './http'

/** 认证接口（docs/api/rest.md §用户认证）。 */
export const authApi = {
  /** 注册：仅创建账号（201 返回 {id, username}，不签发 token，需再登录） */
  register: (username: string, password: string): Promise<User> =>
    http.post<User>('/api/auth/register', { username, password }),

  /** 登录：签发 JWT */
  login: (username: string, password: string): Promise<AuthResponse> =>
    http.post<AuthResponse>('/api/auth/login', { username, password }),

  me: (): Promise<User> => http.get<User>('/api/auth/me'),
}
