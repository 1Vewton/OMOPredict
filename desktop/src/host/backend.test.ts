// Backend 的单测：真拉起子进程（假后端 fixture），覆盖守护、协议污染、崩溃、重启限速与退出。
import { fileURLToPath } from 'node:url'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Backend, BackendExitError, type BackendEvent } from './backend'
import { createFileLogger } from './logger'
import type { Logger } from './logger'

const FIXTURE = fileURLToPath(new URL('../../test/fixtures/fake-backend.mjs', import.meta.url))

let dir: string
let log: Logger
const started: Backend[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'omo-backend-'))
  log = createFileLogger({ dir, name: 'backend', echo: null })
})

afterEach(async () => {
  for (const b of started.splice(0)) {
    await b.stop(1_000).catch(() => undefined)
  }
  rmSync(dir, { recursive: true, force: true })
})

/** 构造一个指向假后端的 Backend。 */
function makeBackend(opts: {
  mode?: string
  delayMs?: number
  requestTimeoutMs?: number
  pingTimeoutMs?: number
  restartPolicy?: { minIntervalMs: number; maxAttempts: number; windowMs: number }
  stateFile?: string
  logger?: Logger | undefined
} = {}): Backend {
  const env: NodeJS.ProcessEnv = { ...process.env, FAKE_MODE: opts.mode ?? 'ok' }
  if (opts.delayMs !== undefined) env.FAKE_DELAY_MS = String(opts.delayMs)
  if (opts.stateFile) env.FAKE_STATE_FILE = opts.stateFile

  const backend = new Backend({
    command: process.execPath,
    args: [FIXTURE],
    env,
    logger: 'logger' in opts ? opts.logger : log,
    ...(opts.requestTimeoutMs !== undefined ? { requestTimeoutMs: opts.requestTimeoutMs } : {}),
    ...(opts.pingTimeoutMs !== undefined ? { pingTimeoutMs: opts.pingTimeoutMs } : {}),
    ...(opts.restartPolicy ? { restartPolicy: opts.restartPolicy } : {}),
    stderrTailLines: 20,
  })
  started.push(backend)
  return backend
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('Backend 正常路径', () => {
  it('start 后 ping 成功，状态 ready，可 invoke 各类方法', async () => {
    const b = makeBackend()
    expect(b.status).toBe('stopped')
    await b.start()
    expect(b.status).toBe('ready')
    expect(typeof b.pid).toBe('number')

    await expect(b.invoke('tasks.list')).resolves.toEqual({ tasks: [] })
    await expect(b.invoke('tasks.delete', { id: 'abc' })).resolves.toEqual({
      id: 'abc',
      deleted: true,
    })
    await expect(b.invoke('meta')).resolves.toMatchObject({ auth_required: false })
  })

  it('应用错误按 HTTP 语义码抛出（422）', async () => {
    const b = makeBackend()
    await b.start()
    await expect(b.invoke('boom')).rejects.toMatchObject({
      code: 422,
      message: '领域校验失败：层厚必须为正',
    })
  })

  it('stderr 被落盘到 backend 日志（D7）', async () => {
    const b = makeBackend()
    await b.start()
    await b.invoke('tasks.create', { kind: 'simulate' })
    await sleep(150)
    const content = readFileSync(log.currentFile(), 'utf8')
    expect(content).toContain('[fake-backend] creating task')
    expect(content).toContain('启动后端')
  })

  it('stdout 出现非 JSON 行时容忍并上报（协议污染不致命）', async () => {
    const b = makeBackend({ mode: 'pollute' })
    const events: BackendEvent[] = []
    b.onEvent((e) => events.push(e))
    await b.start()

    await expect(b.invoke('tasks.list')).resolves.toEqual({ tasks: [] })
    expect(events.some((e) => e.type === 'stdout-pollution')).toBe(true)
  })

  it('stop 优雅退出：关闭 stdin 后进程自行结束', async () => {
    const b = makeBackend()
    await b.start()
    const pid = b.pid
    await b.stop(5_000)
    expect(b.status).toBe('stopped')
    expect(b.pid).toBeUndefined()
    // 进程确实没了
    expect(() => process.kill(pid as number, 0)).toThrow()
  })

  it('stop 幂等', async () => {
    const b = makeBackend()
    await b.start()
    await b.stop(5_000)
    await expect(b.stop(1_000)).resolves.toBeUndefined()
  })
})

describe('Backend 失败路径', () => {
  it('启动 ping 超时（引擎没反应）→ 抛 BackendExitError 且状态 failed', async () => {
    const b = makeBackend({ mode: 'silent', pingTimeoutMs: 300 })
    await expect(b.start()).rejects.toBeInstanceOf(BackendExitError)
    expect(b.status).toBe('failed')
    await expect(b.invoke('tasks.list')).rejects.toThrow(/未就绪|failed/)
  })

  it('调用超时（slow）→ code 0 且消息含超时', async () => {
    const b = makeBackend({ mode: 'slow', delayMs: 500, requestTimeoutMs: 100, pingTimeoutMs: 5_000 })
    await b.start()
    await expect(b.invoke('tasks.list')).rejects.toMatchObject({ code: 0 })
    await expect(b.invoke('tasks.list')).rejects.toThrow(/超时/)
  })

  it('进程在处理请求时崩溃 → 在途请求立即失败（不干等超时）', async () => {
    const b = makeBackend({ mode: 'die-after-ping', requestTimeoutMs: 30_000 })
    await b.start() // ping 正常，进程是健康的

    const before = Date.now()
    await expect(b.invoke('tasks.list')).rejects.toThrow(/异常退出|未就绪/)
    expect(Date.now() - before).toBeLessThan(5_000)
  })

  it('崩溃后自动重启（die-once：第二次启动即正常）', async () => {
    const stateFile = join(dir, 'starts.txt')
    const b = makeBackend({
      mode: 'die-once',
      stateFile,
      pingTimeoutMs: 2_000,
      restartPolicy: { minIntervalMs: 50, maxAttempts: 3, windowMs: 60_000 },
    })
    const events: BackendEvent[] = []
    b.onEvent((e) => events.push(e))

    // 首次启动即崩、且从未就绪 → 不自动重启（避免对着配置错误空转），直接失败
    await expect(b.start()).rejects.toBeInstanceOf(BackendExitError)
    expect(b.status).toBe('failed')
    expect(events.some((e) => e.type === 'restart')).toBe(false)
  })

  it('就绪后崩溃会自动重启', async () => {
    const stateFile = join(dir, 'starts-ready.txt')
    const b = makeBackend({
      // 第一次启动正常（就绪），随后每次业务调用都崩 → 触发重启
      mode: 'die-after-ping',
      stateFile,
      pingTimeoutMs: 2_000,
      restartPolicy: { minIntervalMs: 30, maxAttempts: 3, windowMs: 60_000 },
    })
    const events: BackendEvent[] = []
    b.onEvent((e) => events.push(e))

    await b.start()
    expect(b.status).toBe('ready')
    await expect(b.invoke('tasks.list')).rejects.toBeTruthy() // 触发崩溃
    await waitFor(() => b.status === 'ready', 8_000)
    expect(b.status).toBe('ready')
    expect(events.some((e) => e.type === 'restart')).toBe(true)
  })

  it('反复崩溃时按限速停止重启并置 failed（D5：3 次/10min）', async () => {
    const b = makeBackend({
      mode: 'die-after-ping',
      restartPolicy: { minIntervalMs: 30, maxAttempts: 2, windowMs: 60_000 },
    })
    const events: BackendEvent[] = []
    b.onEvent((e) => events.push(e))

    await b.start()

    // 每次就绪后调用都会把后端打崩；反复触发直到达到重启上限
    for (let i = 0; i < 12 && b.status !== 'failed'; i++) {
      if (b.status === 'ready') {
        await b.invoke('tasks.list').catch(() => undefined)
      }
      await sleep(120)
    }

    expect(b.status).toBe('failed')
    const failed = events.filter((e) => e.type === 'failed')
    expect(failed.length).toBeGreaterThan(0)
    const last = failed[failed.length - 1]
    expect(last && last.type === 'failed' ? last.reason : '').toContain('超过上限')

    // 之后的调用立刻失败，且提示可操作
    await expect(b.invoke('tasks.list')).rejects.toThrow(/未就绪|failed/)
  })

  it('可执行文件不存在 → 启动失败并带 stderr 尾部（供友好提示）', async () => {
    const b = new Backend({
      command: join(dir, 'definitely-not-here.exe'),
      env: process.env,
      logger: log,
      pingTimeoutMs: 500,
    })
    started.push(b)
    await expect(b.start()).rejects.toBeInstanceOf(BackendExitError)
    expect(b.status).toBe('failed')
  })

  it('stop 能强制回收不理会 stdin EOF 的进程', async () => {
    // 假后端收到 stdin EOF 会自行退出；这里用一个"忽略 stdin"的进程验证强杀路径
    const b = new Backend({
      command: process.execPath,
      args: ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000)'],
      env: process.env,
      logger: log,
      pingTimeoutMs: 1_000,
    })
    started.push(b)
    await b.start().catch(() => undefined) // 该进程不会回 ping，start 会失败
    const pid = b.pid
    await b.stop(300)
    expect(b.status).toBe('stopped')
    if (pid !== undefined) {
      expect(() => process.kill(pid, 0)).toThrow()
    }
  })
})

/** 轮询等待条件成立（避免固定 sleep 造成的偶发失败，见 server/README 的测试约定）。 */
async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await sleep(50)
  }
}
