// 集成测试：Host ↔ 真实 Go 后端 ↔ 真实 Python 引擎（可选、默认跳过）。
//
// 为什么默认跳过：需要先构建 Go 后端、且机器上要有可用的引擎（Python/uv），
// 这些在通用 CI 上不具备。用环境变量显式开启：
//
//   $env:OMO_BACKEND_EXE = 'D:\...\server\omopredict.exe'
//   $env:OMO_ENGINE_CMD  = '"D:\...\engine\.venv\Scripts\python.exe" -m omo.rpc'
//   pnpm test
//
// 验证目标：桌面链路真的能算（tasks.create → 轮询 succeeded → 数值与 REST 契约一致），
// 且整条链路（Go + 引擎）**不监听任何端口**（docs/desktop.md §10.6）。
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, describe, expect, it } from 'vitest'
import { Host } from './host'
import type { HostPaths } from './paths'
import { CHANNELS, makeRpcHandler, type RpcEnvelope } from '../shell/channels'
import { createOmoApi, type IpcInvoker } from '../shell/preloadBridge'

const execFileAsync = promisify(execFile)

const backendExe = process.env.OMO_BACKEND_EXE?.trim()
const engineCmd = process.env.OMO_ENGINE_CMD?.trim()
const enabled = Boolean(backendExe)

/**
 * 数据目录：默认放系统临时目录；某些受限环境不允许在 `%TEMP%` 下创建 SQLite
 * （实测 modernc sqlite 会报 `unable to open database file`），此时用
 * `OMO_INTEGRATION_DIR` 指到可写目录。
 */
function makeWorkDir(): string {
  const override = process.env.OMO_INTEGRATION_DIR?.trim()
  if (override) {
    mkdirSync(override, { recursive: true })
    return override
  }
  return mkdtempSync(join(tmpdir(), 'omo-integration-'))
}

/** 列出给定 pid 集合中处于监听状态的端口（仅 Windows 用 netstat；其它平台返回 null = 无法判定）。 */
async function listeningPortsOf(pids: number[]): Promise<string[] | null> {
  if (process.platform !== 'win32') return null
  try {
    const { stdout } = await execFileAsync('netstat', ['-ano'], { maxBuffer: 4 << 20 })
    const found: string[] = []
    for (const line of stdout.split(/\r?\n/)) {
      if (!/LISTENING/i.test(line)) continue
      const cols = line.trim().split(/\s+/)
      const pid = Number(cols[cols.length - 1])
      if (pids.includes(pid)) found.push(cols[1] ?? line)
    }
    return found
  } catch {
    return null
  }
}

const suite = describe.skipIf(!enabled)

suite('Host ↔ 真实后端（OMO_BACKEND_EXE 已设置）', () => {
  const dir = makeWorkDir()
  const paths: HostPaths = {
    dataDir: dir,
    logsDir: join(dir, 'logs'),
    dbPath: join(dir, 'omopredict.db'),
    lockPath: join(dir, 'instance.lock'),
  }
  let host: Host | undefined

  afterAll(async () => {
    await host?.dispose().catch(() => undefined)
    rmSync(dir, { recursive: true, force: true })
  })

  it('启动、建任务、轮询到 succeeded，数值与 REST 契约一致', async () => {
    host = await Host.start({
      paths,
      backendCommand: backendExe as string,
      backendArgs: ['--stdio'],
      // 引擎命令由调用方给出（未给出则交给 Go 的自动发现）
      ...(engineCmd ? { env: { OMO_ENGINE_CMD: engineCmd } } : {}),
    })
    expect(host.status).toBe('ready')

    const meta = await host.invoke<{ auth_required: boolean; engine_transport: string }>('meta')
    expect(meta.auth_required).toBe(false)
    expect(meta.engine_transport).toBe('stdio')

    const created = await host.invoke<{ id: string; status: string; user_id: string }>(
      'tasks.create',
      {
        kind: 'simulate',
        name: 'host-integration',
        layers: [
          { material: 'ITO', thickness_nm: 40 },
          { material: 'Ag', thickness_nm: 10 },
          { material: 'ITO', thickness_nm: 40 },
        ],
      },
    )
    expect(created.status).toBe('pending')
    expect(created.user_id).toBe('local') // 单用户模式（D10）

    // 轮询到终态
    const deadline = Date.now() + 120_000
    let task: {
      status: string
      error?: string
      result?: {
        sheet_resistance?: number | null
        transmittance: { x: number; value: number }[]
        se_db: { x: number; value: number }[]
      }
    } = { status: 'pending' }
    while (Date.now() < deadline) {
      task = await host.invoke('tasks.get', { id: created.id })
      if (task.status === 'succeeded' || task.status === 'failed') break
      await new Promise((r) => setTimeout(r, 300))
    }
    expect(task.status, `任务失败：${task.error ?? ''}`).toBe('succeeded')

    const rs = task.result?.sheet_resistance
    const t550 = task.result?.transmittance.find((p) => p.x === 550)?.value
    const se10 = task.result?.se_db.find((p) => p.x === 10)?.value
    expect(rs).toBeCloseTo(3.9708, 3)
    expect(t550).toBeCloseTo(0.9745, 3)
    expect(se10).toBeCloseTo(33.7037, 1)

    // 删除（含结果）
    await expect(host.invoke('tasks.delete', { id: created.id })).resolves.toMatchObject({
      deleted: true,
    })

    // 整条链路不监听任何端口（§10.6）：检查 Go 后端自身。
    // 引擎是它的子进程，stdio 传输下根本不会 bind 端口（T4.5 已用 PowerShell 全树核对过）。
    const listeners = await listeningPortsOf([host.backendPid as number])
    if (listeners !== null) expect(listeners).toEqual([])
  }, 180_000)

  /**
   * T7 的关键验证：渲染进程看到的那条链路。
   *
   * 本机装不了 Electron 二进制（见 docs/desktop.md §13 的说明），所以窗口无法实跑；
   * 但**除 Electron 传输与窗口之外**的每一环都能用真实组件串起来验证：
   *   渲染侧 createOmoApi（preload 暴露的 window.omo）
   *     → 假 ipcRenderer（模拟结构化克隆的跨进程边界）
   *     → makeRpcHandler（主进程 ipcMain.handle 用的处理器）
   *     → 真实 Host → 真实 Go 后端 → 真实 Python 引擎
   */
  it('渲染进程可见链路：window.omo.rpc → IPC 信封 → 真实后端', async () => {
    if (!host) host = await Host.start({
      paths,
      backendCommand: backendExe as string,
      backendArgs: ['--stdio'],
      ...(engineCmd ? { env: { OMO_ENGINE_CMD: engineCmd } } : {}),
    })

    // 与 src/main.ts 的 registerIpc() 同构：同一个处理器工厂
    const handle = makeRpcHandler((method, params) => host!.invoke(method, params))
    const ipc: IpcInvoker = {
      async invoke(channel, ...args) {
        // 只服务白名单通道，且模拟 Electron 的结构化克隆（含错误信封）
        if (channel !== CHANNELS.rpc) throw new Error(`未处理的通道: ${channel}`)
        return JSON.parse(JSON.stringify(await handle(args[0]))) as RpcEnvelope
      },
    }
    const omo = createOmoApi(ipc)

    // 渲染进程拿到的 meta 就是门禁依据（T5）
    await expect(omo.rpc('meta')).resolves.toMatchObject({
      auth_required: false,
      engine_transport: 'stdio',
    })

    // 建任务 → 轮询 → 数值与 REST 契约一致（全部经 IPC 往返）
    const created = (await omo.rpc('tasks.create', {
      kind: 'simulate',
      name: 'ipc-integration',
      layers: [
        { material: 'ITO', thickness_nm: 40 },
        { material: 'Ag', thickness_nm: 10 },
        { material: 'ITO', thickness_nm: 40 },
      ],
    })) as { id: string; status: string }
    expect(created.status).toBe('pending')

    const deadline = Date.now() + 120_000
    let task: {
      status: string
      error?: string
      result?: {
        sheet_resistance?: number | null
        transmittance: { x: number; value: number }[]
      }
    } = { status: 'pending' }
    while (Date.now() < deadline) {
      task = (await omo.rpc('tasks.get', { id: created.id })) as typeof task
      if (task.status === 'succeeded' || task.status === 'failed') break
      await new Promise((r) => setTimeout(r, 300))
    }
    expect(task.status, `任务失败：${task.error ?? ''}`).toBe('succeeded')
    expect(task.result?.sheet_resistance).toBeCloseTo(3.9708, 3)
    expect(task.result?.transmittance.find((p) => p.x === 550)?.value).toBeCloseTo(0.9745, 3)

    await expect(omo.rpc('tasks.delete', { id: created.id })).resolves.toMatchObject({
      deleted: true,
    })

    // 错误也要原样穿过跨进程边界（前端 toApiError 依赖 code 做 401/404 分支）
    await expect(omo.rpc('tasks.get', { id: 'no-such-task' })).rejects.toEqual({
      code: 404,
      message: 'task not found',
    })
  }, 180_000)
})
