// 凭证持久化：仅 HTTP/JWT（Web）形态使用；单用户桌面形态不参与认证。
//
// 单独成模块是为了避免循环依赖：transport.ts（两种传输）与 client.ts（横切处理）都要用到它，
// 而它不依赖任何其它 api 模块。

export const TOKEN_KEY = 'omo_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token)
  } else {
    localStorage.removeItem(TOKEN_KEY)
  }
}
