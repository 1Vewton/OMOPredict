// Host 组装层单测：目录/锁/日志/引擎注入/后端拉起与退出，以及 D6 环境变量的精确形态。
import { fileURLToPath } from 'node:url'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Host, buildBackendEnv, DEFAULT_ENGINE_TRANSPORT } from './host'
import { SingleInstanceError } from './singleton'
import type { HostPaths } from './paths'

const FIXTURE = fileURLToPath(new URL('../../test/fixtures/fake-backend.mjs', import.meta.url))

let dir: string
let paths: HostPaths
const hosts: Host[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'omo-host-'))
  paths = {
    dataDir: dir,
    logsDir: join(dir, 'logs'),
    dbPath: join(dir, 'omopredict.db'),
    lockPath: join(dir, 'instance.lock'),
  }
})

afterEach(async () => {
  for (const h of hosts.splice(0)) await h.dispose().catch(() => undefined)
  rmSync(dir, { recursive: true, force: true })
})

async function startHost(extra: Record<string, unknown> = {}): Promise<Host> {
  const host = await Host.start({
    paths,
    backendCommand: process.execPath,
    backendArgs: [FIXTURE],
    env: { FAKE_MODE: 'ok' },
    resourcesDir: join(dir, 'resources'),
    ...extra,
  })
  hosts.push(host)
  return host
}

describe('Host 启动与调用', () => {
  it('启动后 ready，可 invoke 后端方法', async () => {
    const host = await startHost()
    expect(host.status).toBe('ready')
    await expect(host.invoke('tasks.list')).resolves.toEqual({ tasks: [] })
    await expect(host.invoke('meta')).resolves.toMatchObject({ auth_required: false })
  })

  it('建好数据与日志目录，并写出 host.log / backend.log', async () => {
    const host = await startHost()
    await host.invoke('tasks.create', { kind: 'simulate' })
    await new Promise((r) => setTimeout(r, 150))
    await host.dispose()
    hosts.length = 0

    const files = readdirSync(paths.logsDir)
    expect(files.some((f) => f.startsWith('host-'))).toBe(true)
    expect(files.some((f) => f.startsWith('backend-'))).toBe(true)
    const hostLog = readFileSync(
      join(paths.logsDir, files.find((f) => f.startsWith('host-')) as string),
      'utf8',
    )
    expect(hostLog).toContain('Host 启动')
    expect(hostLog).toContain('Host 已退出')
  })

  it('dispose 释放单实例锁（否则用户重启会被自己的陈旧锁挡住）', async () => {
    const host = await startHost()
    expect(existsSync(paths.lockPath)).toBe(true)
    await host.dispose()
    hosts.length = 0
    expect(existsSync(paths.lockPath)).toBe(false)
  })

  it('第二个 Host 实例被单实例锁挡住', async () => {
    await startHost()
    await expect(startHost()).rejects.toBeInstanceOf(SingleInstanceError)
  })

  it('acquireLock:false 可跳过锁（供测试/开发）', async () => {
    const host = await startHost({ acquireLock: false })
    expect(existsSync(paths.lockPath)).toBe(false)
    expect(host.status).toBe('ready')
  })

  it('dispose 后拒绝新调用', async () => {
    const host = await startHost()
    await host.dispose()
    hosts.length = 0
    await expect(host.invoke('tasks.list')).rejects.toThrow(/已关闭/)
  })

  it('启动失败时释放锁并抛错（用户重试不会被锁挡）', async () => {
    await expect(
      Host.start({
        paths,
        backendCommand: process.execPath,
        backendArgs: [FIXTURE],
        env: { FAKE_MODE: 'silent' },
        resourcesDir: join(dir, 'resources'),
      }),
    ).rejects.toBeTruthy()
    expect(existsSync(paths.lockPath)).toBe(false)
  })

  it('事件可订阅并可取消订阅', async () => {
    const host = await startHost()
    const seen: string[] = []
    const off = host.onEvent((e) => seen.push(e.type))
    off()
    await host.invoke('tasks.list')
    expect(seen).toEqual([])
  })
})

describe('discoverEngine 接入 Host', () => {
  it('资源目录有 sidecar 时把 OMO_ENGINE_CMD 注入后端环境', async () => {
    // 用一个"假 sidecar"文件占位，验证 Host 把它写进注入的环境
    const resourcesDir = join(dir, 'resources')
    const engineDir = join(resourcesDir, 'engine')
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(engineDir, { recursive: true })
    const sidecarName = process.platform === 'win32' ? 'omo-rpc.exe' : 'omo-rpc'
    writeFileSync(join(engineDir, sidecarName), '')

    const host = await Host.start({
      paths,
      backendCommand: process.execPath,
      // 让假后端把收到的环境回显出来：用 -p 打印 JSON 后退出会破坏协议，
      // 所以这里改为直接断言 discovery 结果（环境注入由 buildBackendEnv 单测覆盖）
      backendArgs: [FIXTURE],
      env: { FAKE_MODE: 'ok' },
      resourcesDir,
    })
    hosts.push(host)

    expect(host.engineDiscovery.source).toBe('bundled-sidecar')
    expect(host.engineDiscovery.sidecarPath).toBe(join(engineDir, sidecarName))
    expect(host.engineDiscovery.env.OMO_ENGINE_CMD).toBeTruthy()
  })
})

describe('buildBackendEnv（D6：桌面版注入的环境变量）', () => {
  /** 引擎发现结果（每次调用都新建，避免在 describe 作用域提前求值）。 */
  const withEngine = () => ({ env: { OMO_ENGINE_CMD: 'python -m omo.rpc' }, source: 'env' })
  const noEngine = { env: {}, source: 'auto' }

  it('数据库指向用户数据目录、单用户模式、默认无端口引擎', () => {
    const env = buildBackendEnv({}, paths, withEngine())
    expect(env.OMO_DB_DRIVER).toBe('sqlite')
    expect(env.OMO_DB_DSN).toBe(paths.dbPath)
    expect(env.OMO_AUTH_MODE).toBe('none')
    expect(env.OMO_ENGINE_TRANSPORT).toBe(DEFAULT_ENGINE_TRANSPORT)
    expect(env.OMO_ENGINE_TRANSPORT).toBe('stdio')
    expect(env.OMO_ENGINE_CMD).toBe('python -m omo.rpc')
    // 继承父进程环境（PATH 等）
    expect(env.PATH ?? env.Path).toBeTruthy()
  })

  it('调用方显式传入的 env 优先级最高（开发期可切回 http）', () => {
    const env = buildBackendEnv(
      { env: { OMO_ENGINE_TRANSPORT: 'http', OMO_ENGINE_URL: 'http://127.0.0.1:8000' } },
      paths,
      noEngine,
    )
    expect(env.OMO_ENGINE_TRANSPORT).toBe('http')
    expect(env.OMO_ENGINE_URL).toBe('http://127.0.0.1:8000')
  })

  it('engineTransport 选项可覆盖默认值', () => {
    const env = buildBackendEnv({ engineTransport: 'http' }, paths, noEngine)
    expect(env.OMO_ENGINE_TRANSPORT).toBe('http')
  })

  it('engineUrl 只在显式给出时注入', () => {
    expect(buildBackendEnv({}, paths, noEngine).OMO_ENGINE_URL).toBeUndefined()
    expect(buildBackendEnv({ engineUrl: 'http://x:1' }, paths, noEngine).OMO_ENGINE_URL).toBe(
      'http://x:1',
    )
  })

  it('不注入 OMO_LOG_DIR：后端 stderr 已由 Host 捕获进 logs/backend.log，避免双写', () => {
    const env = buildBackendEnv({}, paths, noEngine)
    expect(env.OMO_LOG_DIR).toBeUndefined()
  })
})
