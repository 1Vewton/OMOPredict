// Go 中间层子进程的拉起与守护（docs/desktop.md D5/D7）。
//
// 职责：spawn → 健康检查（ping）→ 转发 RPC → 捕获 stderr 到日志 → 异常退出时按限速重启
// → 退出时优雅关闭并回收进程树。
//
// **stdout 是协议流**（只能是 JSON-RPC 行）：第三方库往 stdout 打印会破坏协议，
// Go 侧为此专门把 GORM 日志改到 stderr（docs/HANDOVER §6.15）；这里对非法行只记日志、
// 不中断服务，把"被污染"的后果降到最小。
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { LineSplitter, DEFAULT_MAX_LINE_BYTES } from './lines'
import { RpcCallError, RpcClient } from './rpc'
import type { Logger } from './logger'

export type BackendStatus = 'stopped' | 'starting' | 'ready' | 'restarting' | 'failed'

/** 后端事件（供 UI/诊断订阅）。 */
export type BackendEvent =
  | { type: 'starting'; attempt: number }
  | { type: 'ready'; pid: number | undefined }
  | { type: 'exit'; code: number | null; signal: NodeJS.Signals | null; expected: boolean }
  | { type: 'restart'; attempt: number; delayMs: number }
  | { type: 'failed'; reason: string }
  | { type: 'stdout-pollution'; line: string }

/** 重启限速（D5：连续失败 3 次/10min 后停止重试）。 */
export interface RestartPolicy {
  minIntervalMs: number
  maxAttempts: number
  windowMs: number
}

export const DEFAULT_RESTART_POLICY: RestartPolicy = {
  minIntervalMs: 3_000,
  maxAttempts: 3,
  windowMs: 10 * 60_000,
}

/** 优雅退出等待上限（D5：超时 3s 强杀）。 */
export const DEFAULT_SHUTDOWN_GRACE_MS = 3_000

/** spawn 的注入点（测试可用假实现）。 */
export type SpawnFn = (
  command: string,
  args: string[],
  options: { cwd?: string; env: NodeJS.ProcessEnv },
) => ChildProcessWithoutNullStreams

/** 进程树回收的注入点（Windows 用 taskkill /T /F，其它平台 kill 进程组）。 */
export type KillTreeFn = (pid: number) => Promise<void>

export interface BackendOptions {
  /** 后端可执行文件（omopredict-server.exe / 开发期用 go run 包装脚本） */
  command: string
  args?: string[]
  cwd?: string
  /** 子进程环境（默认继承，另由 Host 注入 OMO_* 变量） */
  env?: NodeJS.ProcessEnv
  /** 日志出口（backend.log） */
  logger?: Logger
  /** 单次调用超时 */
  requestTimeoutMs?: number
  /** 健康检查超时（D5：ping 超时 2s） */
  pingTimeoutMs?: number
  restartPolicy?: RestartPolicy
  spawnFn?: SpawnFn
  killTreeFn?: KillTreeFn
  /** stderr 环形缓冲保留行数（供友好错误对话框展示） */
  stderrTailLines?: number
}

/** 后端崩溃时的错误（携带 stderr 尾部，便于给出可操作提示）。 */
export class BackendExitError extends RpcCallError {
  constructor(
    message: string,
    public readonly stderrTail: string,
  ) {
    super(0, message)
    this.name = 'BackendExitError'
  }
}

/**
 * Go 中间层子进程的守护器。
 *
 * 生命周期：`stopped → starting → ready`；异常退出后 `restarting → starting → ready`，
 * 超出限速则 `failed` 并停止重试。
 */
export class Backend {
  private readonly policy: RestartPolicy
  private readonly spawnFn: SpawnFn
  private readonly killTreeFn: KillTreeFn
  private readonly rpc: RpcClient
  private readonly listeners = new Set<(e: BackendEvent) => void>()
  private readonly stderrTail: string[] = []
  private readonly stderrTailLines: number

  private child: ChildProcessWithoutNullStreams | null = null
  private splitter = new LineSplitter()
  private state: BackendStatus = 'stopped'
  private stopping = false
  /** 是否曾经就绪过：决定"退出后是否自动重启"（启动阶段就失败不重启，见 handleExit） */
  private everReady = false
  private attempt = 0
  private attemptTimestamps: number[] = []
  private lastStartAt = 0
  private restartTimer: NodeJS.Timeout | null = null

  constructor(private readonly opts: BackendOptions) {
    this.policy = opts.restartPolicy ?? DEFAULT_RESTART_POLICY
    this.spawnFn = opts.spawnFn ?? ((c, a, o) => spawn(c, a, o))
    this.killTreeFn = opts.killTreeFn ?? defaultKillTree
    this.stderrTailLines = opts.stderrTailLines ?? 50
    this.rpc = new RpcClient(
      { write: (line) => this.writeToChild(line) },
      {
        timeoutMs: opts.requestTimeoutMs,
        maxLineBytes: DEFAULT_MAX_LINE_BYTES,
        onProtocolError: (e) => this.opts.logger?.warn(`协议: ${e.message}`),
      },
    )
  }

  get status(): BackendStatus {
    return this.state
  }

  /** 当前后端进程 pid（未运行时为 undefined）。 */
  get pid(): number | undefined {
    return this.child?.pid
  }

  /** stderr 尾部（最近若干行），供友好错误提示。 */
  get stderrTailText(): string {
    return this.stderrTail.join('\n')
  }

  onEvent(listener: (e: BackendEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 启动并健康检查（ping）；失败抛错且状态置 failed。 */
  async start(): Promise<void> {
    this.stopping = false
    try {
      await this.spawnOnce()
      await this.rpc.call('ping', {}, { timeoutMs: this.opts.pingTimeoutMs ?? 2_000 })
    } catch (e) {
      // 任何启动阶段失败都归到 failed：不留 'starting' 这种半吊子状态，
      // 否则调用方会看到一个既不能调用、又不像失败的状态。
      this.state = 'failed'
      const reason =
        e instanceof BackendExitError ? e.message : `后端启动失败: ${(e as Error).message}`
      this.emit({ type: 'failed', reason })
      if (e instanceof BackendExitError) throw e
      throw new BackendExitError(reason, this.stderrTailText)
    }
    this.state = 'ready'
    this.everReady = true
    this.emit({ type: 'ready', pid: this.child?.pid })
  }

  /** 调用后端方法；后端不可用时立即失败（不干等超时）。 */
  async invoke<T>(
    method: string,
    params?: unknown,
    callOpts: { timeoutMs?: number } = {},
  ): Promise<T> {
    // 崩溃/重启期间快速失败：让用户立刻看到"后端不可用"，而不是等 60s 超时
    if (this.state !== 'ready' || !this.child) {
      throw new BackendExitError(`后端未就绪（status=${this.state}）`, this.stderrTailText)
    }
    try {
      return await this.rpc.call<T>(method, params, callOpts)
    } catch (e) {
      if (e instanceof RpcCallError && e.code === 0 && this.state !== 'ready') {
        throw new BackendExitError(e.message, this.stderrTailText)
      }
      throw e
    }
  }

  /** 优雅停止：关闭 stdin（后端读到 EOF 自行退出）→ 超时强杀进程树。 */
  async stop(graceMs: number = DEFAULT_SHUTDOWN_GRACE_MS): Promise<void> {
    this.stopping = true
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    const child = this.child
    this.rpc.close()
    if (!child) {
      this.state = 'stopped'
      return
    }

    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    try {
      child.stdin.end()
    } catch {
      // 已经断开
    }

    const timedOut = await Promise.race([
      exited.then(() => false),
      delay(graceMs).then(() => true),
    ])
    if (timedOut && child.pid !== undefined) {
      this.opts.logger?.warn(`后端未在 ${graceMs}ms 内退出，强制终止进程树（pid=${child.pid}）`)
      await this.killTreeFn(child.pid).catch((e: Error) => {
        this.opts.logger?.error(`进程树终止失败: ${e.message}`)
      })
      await exited
    }
    this.child = null
    this.state = 'stopped'
  }

  // ---------------------------------------------------------------- 内部

  private async spawnOnce(): Promise<void> {
    const args = this.opts.args ?? []
    this.state = this.attempt === 0 ? 'starting' : 'restarting'
    this.emit({ type: 'starting', attempt: this.attempt + 1 })
    this.opts.logger?.info(`启动后端: ${this.opts.command} ${args.join(' ')}`)

    const child = this.spawnFn(this.opts.command, args, {
      ...(this.opts.cwd ? { cwd: this.opts.cwd } : {}),
      env: this.opts.env ?? process.env,
    })
    this.child = child
    this.lastStartAt = Date.now()
    this.splitter = new LineSplitter()

    child.stdout.on('data', (chunk: Buffer) => {
      for (const line of this.splitter.push(chunk)) this.handleStdoutLine(line)
    })
    child.stderr.on('data', (chunk: Buffer) => this.handleStderr(chunk))
    child.on('error', (e) => {
      this.opts.logger?.error(`后端进程错误: ${e.message}`)
      this.pushStderr(`[spawn error] ${e.message}`)
    })
    child.on('exit', (code, signal) => this.handleExit(child, code, signal))

    // spawn 失败（如文件不存在）时 'error' 先触发且**不会**触发 'exit'：用 child.pid
    // 判断是否真的起来了，避免对着一个不存在的可执行文件傻等 ping 超时。
    await delay(0)
    if (child.pid === undefined) {
      throw new BackendExitError(
        `后端启动失败：无法运行 ${this.opts.command}`,
        this.stderrTailText,
      )
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new BackendExitError(
        `后端进程启动即退出（code=${child.exitCode}, signal=${child.signalCode}）`,
        this.stderrTailText,
      )
    }
  }

  private handleStdoutLine(line: string): void {
    const trimmed = line.trim()
    if (trimmed.length === 0) return
    if (!trimmed.startsWith('{')) {
      // 协议污染：记日志并上报，但不影响在途请求
      this.opts.logger?.warn(`stdout 出现非 JSON 行（已忽略）: ${trimmed.slice(0, 200)}`)
      this.emit({ type: 'stdout-pollution', line: trimmed.slice(0, 200) })
      return
    }
    this.rpc.acceptLine(trimmed)
  }

  private handleStderr(chunk: Buffer): void {
    const text = chunk.toString('utf8')
    // 后端日志按行落盘：保留原始换行信息，便于排障
    for (const line of text.split(/\r?\n/)) {
      if (line.length === 0) continue
      this.pushStderr(line)
      this.opts.logger?.info(`[backend] ${line}`)
    }
  }

  private pushStderr(line: string): void {
    this.stderrTail.push(line)
    while (this.stderrTail.length > this.stderrTailLines) this.stderrTail.shift()
  }

  private handleExit(
    child: ChildProcessWithoutNullStreams,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (this.child !== child) return // 已被更新的一代取代
    this.child = null
    const expected = this.stopping
    this.emit({ type: 'exit', code, signal, expected })
    this.opts.logger?.info(`后端退出: code=${code} signal=${signal} expected=${expected}`)

    if (expected) {
      this.state = 'stopped'
      return
    }

    // 在途请求立即失败（不要让用户干等到超时）
    this.rpc.failPending(
      new BackendExitError(`后端进程异常退出（code=${code}, signal=${signal}）`, this.stderrTailText),
    )

    if (!this.everReady) {
      // 启动阶段就退出（引擎没装、配置错误…）：自动重启只会重复失败，
      // 由 Host 决定如何提示用户（D9 第 5 级的友好对话框）。
      this.state = 'failed'
      const reason = `后端启动阶段即退出（code=${code}, signal=${signal}）`
      this.opts.logger?.error(reason)
      this.emit({ type: 'failed', reason })
      return
    }

    const decision = this.decideRestart()
    if (!decision.allowed) {
      this.state = 'failed'
      this.opts.logger?.error(`后端反复退出，停止重启：${decision.reason}`)
      this.emit({ type: 'failed', reason: decision.reason })
      return
    }

    this.attempt++
    this.attemptTimestamps.push(Date.now())
    this.state = 'restarting'
    this.emit({ type: 'restart', attempt: this.attempt + 1, delayMs: decision.delayMs })
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (this.stopping) return
      void this.start().catch((e: Error) => {
        this.opts.logger?.error(`重启失败: ${e.message}`)
        this.state = 'failed'
        this.emit({ type: 'failed', reason: e.message })
      })
    }, decision.delayMs)
  }

  /** 是否允许重启（D5：窗口内最多 maxAttempts 次，且两次之间有最小间隔）。 */
  private decideRestart(): { allowed: true; delayMs: number } | { allowed: false; reason: string } {
    const now = Date.now()
    this.attemptTimestamps = this.attemptTimestamps.filter((t) => now - t < this.policy.windowMs)
    if (this.attemptTimestamps.length >= this.policy.maxAttempts) {
      const minutes = Math.round(this.policy.windowMs / 60_000)
      return {
        allowed: false,
        reason: `${minutes} 分钟内已重启 ${this.attemptTimestamps.length} 次，超过上限 ${this.policy.maxAttempts}`,
      }
    }
    const since = now - this.lastStartAt
    const delayMs = Math.max(0, this.policy.minIntervalMs - since)
    return { allowed: true, delayMs }
  }

  private async writeToChild(line: string): Promise<void> {
    const child = this.child
    if (!child) throw new Error('后端未运行')
    await new Promise<void>((resolve, reject) => {
      child.stdin.write(line, (err) => (err ? reject(err) : resolve()))
    })
  }

  private emit(e: BackendEvent): void {
    for (const listener of this.listeners) listener(e)
  }
}

/** 默认进程树回收：Windows 用 taskkill /T /F，其它平台先 SIGTERM 进程组再强杀。 */
export async function defaultKillTree(pid: number): Promise<void> {
  const { execFile } = await import('node:child_process')
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => resolve())
    })
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // 已退出
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    if (typeof t.unref === 'function') t.unref()
  })
}
