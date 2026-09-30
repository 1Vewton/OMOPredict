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
})
