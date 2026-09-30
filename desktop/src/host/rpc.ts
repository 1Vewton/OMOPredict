// stdio JSON-RPC 2.0 客户端（docs/desktop.md D11 / docs/api/rpc.md）。
//
// 与 Go 侧 `internal/rpc`、引擎侧 `omo/rpc` 同一族协议：JSON-Lines、UTF-8、错误码沿用 HTTP 语义。
// 本模块**不依赖子进程**——只依赖一个"把一行写出去"的 io，因此可以纯单测；
// 子进程的拉起与守护在 backend.ts。
import { DEFAULT_MAX_LINE_BYTES } from './lines'

/** 单次调用的默认超时。 */
export const DEFAULT_CALL_TIMEOUT_MS = 60_000

/** JSON-RPC 协议保留错误码。 */
export const PARSE_ERROR = -32700
export const INVALID_REQUEST = -32600
export const METHOD_NOT_FOUND = -32601
export const INVALID_PARAMS = -32602

/** 调用失败（应用错误用 HTTP 语义码，协议错误用保留码）。 */
export class RpcCallError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message)
    this.name = 'RpcCallError'
  }
}

/** 协议层异常（非法行、未知 id 等）：只上报，不影响在途请求。 */
export class RpcProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RpcProtocolError'
  }
}

/** 输出一行（含换行）。实现方负责写入子进程 stdin。 */
export interface RpcIo {
  write(line: string): void | Promise<void>
}

export interface RpcClientOptions {
  /** 单次调用超时（默认 60s） */
  timeoutMs?: number
  /** 单行上限（默认 16 MiB） */
  maxLineBytes?: number
  /** 收到通知（无 id 的报文）时回调，如 `progress` */
  onNotification?: (method: string, params: unknown) => void
  /** 协议/解析异常回调（默认静默，由调用方决定是否记日志） */
  onProtocolError?: (error: RpcProtocolError) => void
}

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

/** 面向行的 JSON-RPC 2.0 客户端。 */
export class RpcClient {
  private readonly pending = new Map<number, PendingCall>()
  private nextId = 1
  private closed = false

  constructor(
    private readonly io: RpcIo,
    private readonly opts: RpcClientOptions = {},
  ) {}

  /** 在途请求数（诊断/测试用）。 */
  get pendingCount(): number {
    return this.pending.size
  }

  /**
   * 发起一次调用。
   *
   * 参数:
   *   method  方法名（如 `tasks.create`）
   *   params  参数（HTTP 形态下即为请求体，见 docs/api/rpc.md §2）
   *   callOpts.timeoutMs 覆盖本次超时（如大规模反推需要更久）
   *
   * 返回:
   *   `result` 字段（与 REST 响应体逐字段相同）
   *
   * 异常:
   *   RpcCallError   引擎/后端返回 error（code 为 HTTP 语义或 JSON-RPC 保留码）
   *   RpcCallError   超时（code = 0，消息含超时说明）或客户端已关闭
   */
  async call<T>(method: string, params?: unknown, callOpts: { timeoutMs?: number } = {}): Promise<T> {
    if (this.closed) {
      throw new RpcCallError(0, 'RPC 客户端已关闭')
    }
    const id = this.nextId++
    const timeoutMs = callOpts.timeoutMs ?? this.opts.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS

    const line = JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} })
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new RpcCallError(0, `${method} 调用超时（${timeoutMs}ms）`))
      }, timeoutMs)
      if (typeof timer.unref === 'function') timer.unref()
      this.pending.set(id, { resolve, reject, timer })
    })

    try {
      await this.io.write(`${line}\n`)
    } catch (e) {
      const p = this.pending.get(id)
      if (p) {
        clearTimeout(p.timer)
        this.pending.delete(id)
      }
      throw new RpcCallError(0, `写入 ${method} 请求失败: ${(e as Error).message}`)
    }
    return (await promise) as T
  }

  /** 传输层每收到一行就调用这里。非法输入只产生协议错误，不影响在途请求。 */
  acceptLine(raw: Buffer | string): void {
    const text = (Buffer.isBuffer(raw) ? raw.toString('utf8') : raw).trim()
    if (text.length === 0) return
    if (Buffer.byteLength(text, 'utf8') > (this.opts.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES)) {
      this.protocolError(`响应行超过上限（${text.length} 字符）`)
      return
    }

    let msg: unknown
    try {
      msg = JSON.parse(text)
    } catch (e) {
      // stdout 可能混入第三方库的打印：记协议错误但继续（Go 侧吃过这个亏，docs/HANDOVER §6.15）
      this.protocolError(`非法 JSON 行: ${(e as Error).message}`)
      return
    }
    if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) {
      // 本协议是"一行一个报文"，不支持 JSON-RPC 批量数组；数组按非法报文处理
      this.protocolError('报文不是 JSON 对象')
      return
    }

    const { id, result, error, method, params } = msg as {
      id?: unknown
      result?: unknown
      error?: { code?: unknown; message?: unknown }
      method?: unknown
      params?: unknown
    }

    if (id === undefined || id === null) {
      // 通知：执行但不回复
      if (typeof method === 'string') this.opts.onNotification?.(method, params)
      return
    }
    if (typeof id !== 'number') {
      this.protocolError(`响应 id 非数值: ${String(id)}`)
      return
    }

    const entry = this.pending.get(id)
    if (!entry) {
      this.protocolError(`收到未知 id 的响应（id=${id}）`)
      return
    }
    clearTimeout(entry.timer)
    this.pending.delete(id)

    if (error) {
      const code = typeof error.code === 'number' ? error.code : 0
      const message = typeof error.message === 'string' ? error.message : 'RPC 错误'
      entry.reject(new RpcCallError(code, message))
      return
    }
    entry.resolve(result)
  }

  /**
   * 传输断开：让所有在途请求立即失败。
   *
   * 比"等到超时"重要得多——后端崩溃时用户应该马上看到错误，而不是干等 60s。
   */
  failPending(error: Error): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer)
      this.pending.delete(id)
      entry.reject(error)
    }
  }

  /** 关闭：后续调用直接失败。 */
  close(): void {
    this.closed = true
    this.failPending(new RpcCallError(0, 'RPC 客户端已关闭'))
  }

  private protocolError(message: string): void {
    this.opts.onProtocolError?.(new RpcProtocolError(message))
  }
}
