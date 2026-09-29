// HTTP 传输实现（Web/开发形态）：fetch + JWT 注入 + 错误消息提取。
//
// 传输抽象接口与 IPC 实现在 transport.ts；本文件只管 HTTP 细节：
// 方法 → 端点映射（docs/api/rpc.md §2）、相对路径请求（由 Vite 代理或反向代理转发）、
// 把非 2xx 响应转成 ApiError。
//
// ApiError 定义在此处：它的 `status` 就是 HTTP 状态码语义，而桌面 RPC 的 `error.code`
// 沿用同一语义（docs/desktop.md D11），因此 IPC 传输直接复用本类型，前端错误分支无需改写。

import { getToken } from './token'
// 仅类型导入（编译期擦除）：与 transport.ts 之间不形成运行时循环依赖。
import type { RpcMethod, RpcParams, Transport } from './transport'

/** 统一错误类型（`status` = HTTP 状态码语义；0 表示连接失败或本地校验失败）。 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

interface HttpRoute {
  verb: 'GET' | 'POST' | 'DELETE'
  /** 路径模板，`{id}` 由 params.id 填充 */
  path: string
  /** 是否把整个 params 作为 JSON 请求体发送 */
  body?: boolean
}

/** 方法 → 端点映射（与 Go 侧 router 及 docs/api/rest.md 对齐）。 */
const HTTP_ROUTES: Record<RpcMethod, HttpRoute> = {
  ping: { verb: 'GET', path: '/health' },
  meta: { verb: 'GET', path: '/api/meta' },
  'tasks.create': { verb: 'POST', path: '/api/tasks', body: true },
  'tasks.list': { verb: 'GET', path: '/api/tasks' },
  'tasks.get': { verb: 'GET', path: '/api/tasks/{id}' },
  'tasks.delete': { verb: 'DELETE', path: '/api/tasks/{id}' },
  'auth.register': { verb: 'POST', path: '/api/auth/register', body: true },
  'auth.login': { verb: 'POST', path: '/api/auth/login', body: true },
  'auth.me': { verb: 'GET', path: '/api/auth/me' },
}

interface ErrorBody {
  error?: string
  detail?: string
}

/** 填充路径模板中的 `{name}`；缺失即报错（避免把 `undefined` 发到后端）。 */
function fillPath(template: string, params?: RpcParams): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = params?.[key]
    if (value === undefined || value === null || value === '') {
      throw new ApiError(0, `调用缺少路径参数 ${key}`)
    }
    return encodeURIComponent(String(value))
  })
}

export const httpTransport: Transport = {
  name: 'http',

  async invoke<T>(method: RpcMethod, params?: RpcParams): Promise<T> {
    const route = HTTP_ROUTES[method]
    if (!route) throw new ApiError(0, `未知方法：${method}`)

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`

    let resp: Response
    try {
      resp = await fetch(fillPath(route.path, params), {
        method: route.verb,
        headers,
        body: route.body && params ? JSON.stringify(params) : undefined,
      })
    } catch (e) {
      // fillPath 的缺参错误要原样抛出，不能伪装成"连接失败"
      if (e instanceof ApiError) throw e
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
      throw new ApiError(resp.status, String(message))
    }
    return (await resp.json()) as T
  },
}
