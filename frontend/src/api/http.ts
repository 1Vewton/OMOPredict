// 轻量 HTTP 客户端：统一 JSON 编解码、JWT 注入、错误消息提取。
// 401 时清除凭证并广播 omo:unauthorized 事件（由 App.vue 统一跳转登录页）。

export const TOKEN_KEY = 'omo_token'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

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

interface ErrorBody {
  error?: string
  detail?: string
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  }
  const token = getToken()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  let resp: Response
  try {
    resp = await fetch(path, { ...options, headers })
  } catch {
    throw new ApiError(0, '无法连接服务器，请确认服务已启动')
  }

  if (!resp.ok) {
    let message = `HTTP ${resp.status}`
    try {
      const body = (await resp.json()) as ErrorBody
      message = body.error ?? body.detail ?? message
    } catch {
      // 非 JSON 错误体，保留默认消息
    }
    if (resp.status === 401) {
      setToken(null)
      window.dispatchEvent(new CustomEvent('omo:unauthorized'))
    }
    throw new ApiError(resp.status, String(message))
  }
  return (await resp.json()) as T
}

export const http = {
  get: <T>(path: string): Promise<T> => request<T>(path),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
}
