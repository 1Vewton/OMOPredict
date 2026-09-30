// Host 层组装（docs/desktop.md D5/D6/D7）：把路径、日志、单实例、引擎发现、后端守护串起来，
// 对外只暴露 `invoke(method, params)` 与 `dispose()`——T7 的 Electron 主进程与 preload
// 只需要这两个入口（外加事件订阅）。
//
// 本模块**不 import Electron**：Host 逻辑可以在纯 Node 下单测；窗口/菜单/app 协议留给 T7。
import { mkdirSync } from 'node:fs'
import { Backend, type BackendEvent, type KillTreeFn, type RestartPolicy, type SpawnFn } from './backend'
import { createFileLogger, type Logger } from './logger'
import { discoverEngine, type EngineDiscovery } from './engine'
import { resolveHostPaths, type HostPaths } from './paths'
import { acquireSingletonLock, type SingletonLock } from './singleton'

/** 默认引擎传输：桌面形态必须无端口（D11），故默认 stdio；开发模式可显式改 http。 */
export const DEFAULT_ENGINE_TRANSPORT = 'stdio'

export interface HostOptions {
  /** 数据/日志目录；缺省按平台惯例解析（D6） */
  paths?: HostPaths
  /** Go 后端可执行文件 */
  backendCommand: string
  backendArgs?: string[]
  backendCwd?: string
  /** 壳资源目录（安装包内 `resources/`），用于发现随包分发的引擎 */
  resourcesDir?: string
  /** 额外环境变量（优先级高于 Host 默认值） */
  env?: NodeJS.ProcessEnv
  /** 单次调用超时（毫秒） */
  requestTimeoutMs?: number
  /** 优雅退出等待上限（毫秒，默认 3s） */
  shutdownGraceMs?: number
  /** 引擎传输方式（默认 stdio） */
  engineTransport?: string
  /** 引擎 HTTP 地址（仅 engineTransport=http 时有意义） */
  engineUrl?: string
  /** 注入日志（缺省写 `<logsDir>/host.log`） */
  logger?: Logger
  /** 是否取单实例锁（默认 true） */
  acquireLock?: boolean
  restartPolicy?: RestartPolicy
  /** 注入点（测试用） */
  spawnFn?: SpawnFn
  killTreeFn?: KillTreeFn
}

/**
 * 桌面 Host：负责"应用能用"这件事——目录、日志、单实例、引擎来源、后端进程。
 *
 * 用法（T7 主进程）：
 * ```ts
 * const host = await Host.start({ backendCommand, resourcesDir })
 * const tasks = await host.invoke('tasks.list')
 * await host.dispose()
 * ```
 */
export class Host {
  private disposed = false

  private constructor(
    private readonly backend: Backend,
    private readonly hostPaths: HostPaths,
    private readonly logger: Logger,
    private readonly lock: SingletonLock | null,
    private readonly engine: EngineDiscovery,
    private readonly shutdownGraceMs: number,
  ) {}

  /**
   * 启动 Host：建目录 → 日志 → 单实例锁 → 引擎发现 → 拉起后端并 ping。
   *
   * 异常:
   *   SingleInstanceError  已有实例在运行
   *   BackendExitError     后端启动失败（携带 stderr 尾部，可用 `describeEngineFailure` 转成指引）
   */
  static async start(opts: HostOptions): Promise<Host> {
    const hostPaths = opts.paths ?? resolveHostPaths()
    mkdirSync(hostPaths.dataDir, { recursive: true })
    mkdirSync(hostPaths.logsDir, { recursive: true })

    const logger = opts.logger ?? createFileLogger({ dir: hostPaths.logsDir, name: 'host' })
    logger.info(`Host 启动：dataDir=${hostPaths.dataDir}`)

    let lock: SingletonLock | null = null
    if (opts.acquireLock !== false) {
      lock = acquireSingletonLock(hostPaths.lockPath)
      if (lock.reclaimed) logger.warn('覆盖了陈旧的单实例锁（上次异常退出）')
    }

    const engine = discoverEngine({ resourcesDir: opts.resourcesDir, env: opts.env })
    logger.info(`引擎来源：${engine.source}${engine.sidecarPath ? ` (${engine.sidecarPath})` : ''}`)

    const backendLogger = createFileLogger({ dir: hostPaths.logsDir, name: 'backend' })
    const backend = new Backend({
      command: opts.backendCommand,
      args: opts.backendArgs,
      cwd: opts.backendCwd,
      env: buildBackendEnv(opts, hostPaths, engine),
      logger: backendLogger,
      requestTimeoutMs: opts.requestTimeoutMs,
      restartPolicy: opts.restartPolicy,
      spawnFn: opts.spawnFn,
      killTreeFn: opts.killTreeFn,
    })

    const host = new Host(
      backend,
      hostPaths,
      logger,
      lock,
      engine,
      opts.shutdownGraceMs ?? 3_000,
    )
    try {
      await backend.start()
    } catch (e) {
      // 启动失败要立刻把锁与日志收干净，否则用户重试会被自己的陈旧锁挡住
      lock?.release()
      logger.error(`后端启动失败：${(e as Error).message}`)
      throw e
    }
    logger.info(`后端就绪（pid=${backend.pid ?? '?'}）`)
    return host
  }

  /** 调用后端方法（与 docs/api/rpc.md 的方法名一致）。 */
  invoke<T>(method: string, params?: unknown, callOpts?: { timeoutMs?: number }): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Host 已关闭'))
    return this.backend.invoke<T>(method, params, callOpts)
  }

  /** 订阅后端事件（退出/重启/失败/stdout 污染），返回取消订阅函数。 */
  onEvent(listener: (e: BackendEvent) => void): () => void {
    return this.backend.onEvent(listener)
  }

  get status(): string {
    return this.backend.status
  }

  /** 后端进程 pid（未运行时 undefined）；诊断与"无端口"自检用。 */
  get backendPid(): number | undefined {
    return this.backend.pid
  }

  get paths(): HostPaths {
    return this.hostPaths
  }

  get engineDiscovery(): EngineDiscovery {
    return this.engine
  }

  /** stderr 尾部快照（启动失败时用于生成友好提示）。 */
  get backendStderr(): string {
    return this.backend.stderrTailText
  }

  /** 优雅退出：停后端（回收进程树）→ 释放单实例锁 → 关日志。 */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await this.backend.stop(this.shutdownGraceMs)
    this.lock?.release()
    this.logger.info('Host 已退出')
    this.logger.close()
  }
}

/** 组装后端环境变量（D6）：数据库指向用户数据目录、单用户模式、无端口引擎。 */
export function buildBackendEnv(
  opts: Pick<HostOptions, 'env' | 'engineTransport' | 'engineUrl'>,
  paths: HostPaths,
  engine: EngineDiscovery,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // 数据落在用户目录（D6）；用绝对路径，避免受 cwd 影响
    OMO_DB_DRIVER: 'sqlite',
    OMO_DB_DSN: paths.dbPath,
    // 桌面版无用户管理（D10）：单用户本地模式
    OMO_AUTH_MODE: 'none',
    // 桌面版不监听端口（D11）：Go 拉起引擎走 stdio
    OMO_ENGINE_TRANSPORT: opts.engineTransport ?? DEFAULT_ENGINE_TRANSPORT,
    ...(opts.engineUrl ? { OMO_ENGINE_URL: opts.engineUrl } : {}),
    // 引擎来源（Host 才知道的资源目录布局）
    ...engine.env,
    // 调用方显式传入的最后生效，便于开发期覆盖
    ...opts.env,
  }
}
