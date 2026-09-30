// IPC 通道名（渲染进程 ↔ 主进程）。集中定义，避免两侧字符串漂移——
// 这类拼写错误在运行期只会表现为"调用永远挂起/报未知通道"，很难查。
//
// 契约见 docs/desktop.md D11 与 frontend/src/api/transport.ts（渲染侧消费方）。

export const CHANNELS = {
  /** JSON-RPC 方法调用（载荷与 REST 逐字段相同） */
  rpc: 'omo:rpc',
  /** 壳版本 */
  version: 'omo:version',
  /** 打开日志目录 */
  openLogDir: 'omo:open-log-dir',
  /** 打开数据目录 */
  openDataDir: 'omo:open-data-dir',
} as const

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS]

/** `omo:rpc` 的调用参数。 */
export interface RpcCallParams {
  method: string
  params?: unknown
}

/**
 * `omo:rpc` 的返回信封。
 *
 * **为什么不直接 reject**：Electron 的 `ipcRenderer.invoke` 在跨进程传输时会把 Error
 * 压成只剩 message 的普通错误（自定义字段如 `code` 会丢），于是渲染进程拿不到
 * "401/404/422" 这类语义。改成返回信封、由 preload 侧还原成带 code 的错误，
 * 前端 `toApiError` 的既有分支（401 登出等）才能照常工作。
 */
export type RpcEnvelope =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: number; message: string } }

/** JSON-RPC 保留码（与 Go/Python 侧一致，见 docs/api/rpc.md §3）。 */
export const INVALID_REQUEST = -32600

/**
 * 构造 `omo:rpc` 的处理器：把 (method, params) 转给 Host 并包成信封。
 *
 * 参数:
 *   invoke  实际调用后端的方法（通常是 `host.invoke`）
 *
 * 返回:
 *   接收 `RpcCallParams` 的处理器；**永不 reject**（错误一律放进信封）
 */
export function makeRpcHandler(
  invoke: (method: string, params?: unknown) => Promise<unknown>,
): (raw: unknown) => Promise<RpcEnvelope> {
  return async (raw: unknown): Promise<RpcEnvelope> => {
    const args = (raw ?? {}) as Partial<RpcCallParams>
    if (typeof args.method !== 'string' || args.method.trim().length === 0) {
      return { ok: false, error: { code: INVALID_REQUEST, message: '缺少 method' } }
    }
    try {
      const result = await invoke(args.method, args.params)
      return { ok: true, result }
    } catch (e) {
      return { ok: false, error: toRpcError(e) }
    }
  }
}

/**
 * 把任意错误规整成 `{code, message}`。
 *
 * `code` 沿用 HTTP 状态码语义（0 表示本地/后端不可用）；`RpcCallError` 与
 * `BackendExitError` 都带 `code`，因此能原样透传到渲染进程。
 */
export function toRpcError(e: unknown): { code: number; message: string } {
  if (e && typeof e === 'object') {
    const code = Number((e as { code?: unknown }).code)
    const rawMessage = (e as { message?: unknown }).message
    const message =
      typeof rawMessage === 'string' && rawMessage.length > 0 ? rawMessage : String(e)
    if (Number.isFinite(code) && code !== 0) return { code, message }
    if (e instanceof Error) return { code: 0, message }
  }
  return { code: 0, message: typeof e === 'string' && e ? e : '调用失败' }
}

/**
 * 把信封还原成"结果或抛错"（preload 侧使用）。
 *
 * 抛出的是**普通对象** `{code, message}`：前端 `toApiError` 明确接受该形态
 * （frontend/src/api/transport.ts），因此无需依赖 Electron 对 Error 的序列化能力。
 */
export function unwrapEnvelope(envelope: unknown): unknown {
  if (envelope && typeof envelope === 'object' && (envelope as { ok?: unknown }).ok === true) {
    return (envelope as { result: unknown }).result
  }
  const error = (envelope as { error?: { code?: unknown; message?: unknown } } | null)?.error
  const code = Number(error?.code)
  const message = typeof error?.message === 'string' ? error.message : '调用失败'
  throw { code: Number.isFinite(code) ? code : 0, message }
}
