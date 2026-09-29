// 传输抽象（T5，docs/desktop.md D11）：Web/开发形态走 HTTP，桌面形态走 Electron IPC。
//
// 两种传输的**载荷逐字段相同**：RPC 方法名与参数即 REST 端点与请求体（映射表见 docs/api/rpc.md §2），
// 因此上层（client.ts 与各业务 api 模块）只依赖 Transport 接口，不感知传输差异。
//
// 本文件负责「抽象 + IPC + 选择」；HTTP 实现在 http.ts（那里也是 ApiError 的家，
// 因为它的 status 就是 HTTP 状态码语义）。

import { ApiError, httpTransport } from './http'

/** RPC 方法名（与 docs/api/rpc.md §2 的「方法 ↔ 端点」映射表一一对应）。 */
export type RpcMethod =
  | 'ping'
  | 'meta'
  | 'tasks.create'
  | 'tasks.list'
  | 'tasks.get'
  | 'tasks.delete'
  | 'auth.register'
  | 'auth.login'
  | 'auth.me'

/** 调用参数（HTTP 形态下：路径参数从 `id` 取，`body: true` 的方法整个作为请求体）。 */
export type RpcParams = Record<string, unknown>

/** 传输接口：方法名 + 参数 → 结果。 */
export interface Transport {
  /** 传输名（诊断/日志用） */
  readonly name: 'http' | 'ipc'
  invoke<T>(method: RpcMethod, params?: RpcParams): Promise<T>
}

/**
 * preload 暴露给渲染进程的桥（由 Host 层 T6/T7 实现，**契约在此固化**）：
 *
 * - `rpc(method, params)` 成功时 resolve 结果（与 REST 响应体逐字段相同）；
 * - 失败时 reject，错误对象带 HTTP 语义的 `code`（401 / 404 / 422 …）与 `message`；
 * - 渲染进程**不允许任何网络连接**（CSP `connect-src 'none'`），只走 IPC。
 */
export interface OmoBridge {
  rpc(method: string, params?: unknown): Promise<unknown>
  /** 壳版本（供"关于"信息使用；可选） */
  version?: string
}

declare global {
  interface Window {
    /** 仅桌面形态由 preload 注入；Web 形态为 undefined（据此选择传输） */
    omo?: OmoBridge
  }
}

/**
 * 把任意错误统一成 ApiError。
 *
 * 兼容三种常见形态，避免 Host 层实现细节泄漏到上层：
 * `Error & {code}`、`{code, message}`、JSON-RPC 的 `{error:{code,message}}`。
 */
export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e
  if (typeof e === 'object' && e !== null) {
    const obj = e as {
      code?: unknown
      message?: unknown
      error?: { code?: unknown; message?: unknown }
    }
    const inner = obj.error
    const code = Number(inner?.code ?? obj.code)
    const rawMessage = inner?.message ?? obj.message
    const message = typeof rawMessage === 'string' && rawMessage ? rawMessage : ''
    if (Number.isFinite(code) && code !== 0) {
      return new ApiError(code, message || `RPC 错误 ${code}`)
    }
    if (message) return new ApiError(0, message)
  }
  if (e instanceof Error) return new ApiError(0, e.message)
  return new ApiError(0, '调用失败')
}

/** IPC 传输：经 `window.omo.rpc` 调用 Go 中间层（无网络、无端口）。 */
export const ipcTransport: Transport = {
  name: 'ipc',

  async invoke<T>(method: RpcMethod, params?: RpcParams): Promise<T> {
    const bridge = typeof window !== 'undefined' ? window.omo : undefined
    if (typeof bridge?.rpc !== 'function') {
      throw new ApiError(0, '桌面 IPC 通道不可用（window.omo 未注入）')
    }
    try {
      return (await bridge.rpc(method, params)) as T
    } catch (e) {
      throw toApiError(e)
    }
  },
}

let override: Transport | null = null

/**
 * 当前传输：显式覆盖 > 检测到 `window.omo`（桌面形态）> HTTP（Web/开发形态）。
 *
 * 回落 HTTP 是安全默认：Web 是默认形态，而桌面形态必然由 preload 注入了 `window.omo`。
 */
export function activeTransport(): Transport {
  if (override) return override
  if (typeof window !== 'undefined' && typeof window.omo?.rpc === 'function') {
    return ipcTransport
  }
  return httpTransport
}

/** 覆盖当前传输（测试/调试用；传 null 恢复自动检测）。 */
export function setTransport(t: Transport | null): void {
  override = t
}

// 供上层与单测取用：两个实现与错误类型都可从本模块导入（http.ts 是 HTTP 细节的所在地）
export { ApiError, httpTransport }
