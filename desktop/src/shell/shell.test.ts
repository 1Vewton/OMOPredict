// 菜单、窗口选项、后端定位与诊断的单测。
import { describe, expect, it, vi } from 'vitest'
import { buildMenuTemplate, type MenuActions } from './menu'
import { DEFAULT_WINDOW_SIZE, mainWindowOptions } from './windowOptions'
import { BACKEND_ARGS, BackendNotFoundError, resolveBackendCommand } from './backendCommand'
import { buildDiagnostics, diagnosticsFileName, redactEnv } from './diagnostics'

function actions(): MenuActions & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    showAbout: () => calls.push('about'),
    openDataDir: () => calls.push('data'),
    openLogDir: () => calls.push('logs'),
    exportDiagnostics: () => calls.push('diagnostics'),
    quit: () => calls.push('quit'),
  }
}

/** 展平菜单模板里的所有叶子项（便于断言标签与动作）。 */
function leaves(template: ReturnType<typeof buildMenuTemplate>) {
  const out: { label?: string; click?: () => void }[] = []
  const walk = (items: ReturnType<typeof buildMenuTemplate>): void => {
    for (const item of items) {
      if (Array.isArray(item.submenu)) walk(item.submenu as ReturnType<typeof buildMenuTemplate>)
      else out.push({ label: item.label, click: item.click as (() => void) | undefined })
    }
  }
  walk(template)
  return out
}

describe('buildMenuTemplate', () => {
  it('包含 D7 要求的排障入口与关于', () => {
    const template = buildMenuTemplate(actions())
    const labels = leaves(template).map((l) => l.label)
    expect(labels).toContain('打开数据目录')
    expect(labels).toContain('打开日志目录')
    expect(labels).toContain('导出诊断信息…')
    expect(labels.some((l) => l?.startsWith('关于'))).toBe(true)
    expect(template.map((t) => t.label)).toEqual(['文件', '视图', '帮助'])
  })

  it('点击项接到对应动作', () => {
    const a = actions()
    const byLabel = new Map(leaves(buildMenuTemplate(a)).map((l) => [l.label, l.click]))
    byLabel.get('打开数据目录')?.()
    byLabel.get('打开日志目录')?.()
    byLabel.get('导出诊断信息…')?.()
    expect(a.calls).toEqual(['data', 'logs', 'diagnostics'])
  })

  it('macOS 额外有应用菜单，且退出放进应用菜单', () => {
    const mac = buildMenuTemplate(actions(), { isMac: true })
    expect(mac[0].label).toBe('OMOPredict')
    expect(mac[0].submenu).toBeTruthy()
    const win = buildMenuTemplate(actions(), { isMac: false })
    expect(win.map((t) => t.label)).toEqual(['文件', '视图', '帮助'])
  })

  it('视图菜单用 Electron 角色（重载/缩放/开发者工具）', () => {
    const view = buildMenuTemplate(actions()).find((t) => t.label === '视图')
    const roles = (view?.submenu as { role?: string }[]).map((s) => s.role)
    expect(roles).toContain('reload')
    expect(roles).toContain('toggleDevTools')
    expect(roles).toContain('zoomIn')
  })

  it('不含任何业务动作（菜单只做排障与版本）', () => {
    const labels = leaves(buildMenuTemplate(actions())).map((l) => l.label ?? '')
    expect(labels.some((l) => l.includes('仿真') || l.includes('反推'))).toBe(false)
  })
})

describe('mainWindowOptions', () => {
  it('安全基线：上下文隔离 + 沙箱 + 无 Node + 关 webview', () => {
    const opts = mainWindowOptions({ preloadPath: '/x/preload.cjs' })
    expect(opts.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      preload: '/x/preload.cjs',
    })
  })

  it('先隐藏、等 ready-to-show 再显示（避免白屏）', () => {
    expect(mainWindowOptions({ preloadPath: 'p' }).show).toBe(false)
  })

  it('尺寸有下限，且可传图标/背景色', () => {
    const opts = mainWindowOptions({ preloadPath: 'p', iconPath: 'i.ico', backgroundColor: '#000' })
    expect(opts).toMatchObject(DEFAULT_WINDOW_SIZE)
    expect(opts.icon).toBe('i.ico')
    expect(opts.backgroundColor).toBe('#000')
  })
})

describe('resolveBackendCommand', () => {
  it('OMO_BACKEND_EXE 优先，且总是带 --stdio（桌面无端口）', () => {
    const r = resolveBackendCommand({
      isPackaged: true,
      env: { OMO_BACKEND_EXE: 'D:\\x\\omopredict.exe' },
      exists: () => true,
      platform: 'win32',
    })
    expect(r).toEqual({
      command: 'D:\\x\\omopredict.exe',
      args: ['--stdio'],
      source: 'env',
    })
    expect(BACKEND_ARGS).toEqual(['--stdio'])
  })

  it('打包形态：从 resources 目录找后端', () => {
    const r = resolveBackendCommand({
      isPackaged: true,
      resourcesPath: 'C:\\app\\resources',
      env: {},
      exists: (p) => p === 'C:\\app\\resources\\omopredict-server.exe',
      platform: 'win32',
    })
    expect(r.source).toBe('packaged')
    expect(r.command).toBe('C:\\app\\resources\\omopredict-server.exe')
  })

  it('开发形态：回落到仓库内的构建产物', () => {
    const appPath = 'D:\\repo\\desktop'
    const r = resolveBackendCommand({
      isPackaged: false,
      appPath,
      env: {},
      exists: (p) => p === 'D:\\repo\\server\\omopredict.exe',
      platform: 'win32',
    })
    expect(r).toMatchObject({ source: 'repo-build' })
  })

  it('非 Windows 只认无扩展名', () => {
    const r = resolveBackendCommand({
      isPackaged: true,
      resourcesPath: '/app/resources',
      env: {},
      exists: (p) => p === '/app/resources/omopredict-server',
      platform: 'linux',
    })
    expect(r.command).toBe('/app/resources/omopredict-server')
  })

  it('都找不到时抛出可操作的错误（说明怎么构建）', () => {
    try {
      resolveBackendCommand({ isPackaged: true, resourcesPath: '/app/resources', env: {}, exists: () => false })
      throw new Error('应当抛出')
    } catch (e) {
      expect(e).toBeInstanceOf(BackendNotFoundError)
      expect((e as Error).message).toContain('go build')
      expect((e as Error).message).toContain('OMO_BACKEND_EXE')
    }
  })

  it('空白环境变量视为未设置（继续按目录查找，最终报缺失）', () => {
    expect(() =>
      resolveBackendCommand({
        isPackaged: false,
        env: { OMO_BACKEND_EXE: '   ' },
        exists: () => false,
        platform: 'win32',
      }),
    ).toThrow(BackendNotFoundError)
  })
})

describe('诊断信息', () => {
  it('脱敏环境变量里的密钥（诊断包是要发给别人看的）', () => {
    const redacted = redactEnv({
      OMO_JWT_SECRET: 'super-secret',
      OMO_AUTH_MODE: 'none',
      MY_TOKEN: 'abc',
      db_password: 'pw',
      OMO_DB_DSN: 'C:\\x\\omopredict.db',
    })
    expect(redacted.OMO_JWT_SECRET).toBe('***REDACTED***')
    expect(redacted.MY_TOKEN).toBe('***REDACTED***')
    expect(redacted.db_password).toBe('***REDACTED***')
    expect(redacted.OMO_AUTH_MODE).toBe('none')
    expect(redacted.OMO_DB_DSN).toContain('omopredict.db')
  })

  it('buildDiagnostics 给出各层版本、路径、后端状态与引擎来源', () => {
    const payload = buildDiagnostics({
      versions: { app: '0.1.0', electron: '44.4.5', node: '24.0.0' },
      paths: { dataDir: 'C:\\d', logsDir: 'C:\\d\\logs', dbPath: 'C:\\d\\omopredict.db' },
      backendStatus: 'ready',
      backendPid: 1234,
      engine: { source: 'bundled-sidecar', env: { OMO_ENGINE_CMD: 'x', OMO_JWT_SECRET: 'leak' } },
      backendStderrTail: 'line1\nline2',
      now: new Date('2026-09-30T10:00:00Z'),
    })
    expect(payload.generatedAt).toBe('2026-09-30T10:00:00.000Z')
    expect(payload.versions).toMatchObject({ electron: '44.4.5' })
    expect(payload.paths).toMatchObject({ dataDir: 'C:\\d', db: 'omopredict.db' })
    expect(payload.backend).toEqual({ status: 'ready', pid: 1234 })
    expect(payload.engine).toMatchObject({ source: 'bundled-sidecar' })
    // 密钥不得出现在诊断里
    expect(JSON.stringify(payload)).not.toContain('leak')
    expect(JSON.stringify(payload)).toContain('***REDACTED***')
  })

  it('stderr 尾部只保留最后若干行', () => {
    const many = Array.from({ length: 100 }, (_, i) => `line${i}`).join('\n')
    const payload = buildDiagnostics({
      versions: {},
      paths: { dataDir: 'd', logsDir: 'l', dbPath: 'd\\x.db' },
      backendStatus: 'failed',
      engine: { source: 'auto', env: {} },
      backendStderrTail: many,
    })
    const text = String(payload.backendStderrTail)
    expect(text).toContain('line99')
    expect(text).not.toContain('line0\n')
    expect(text.split('\n').length).toBeLessThanOrEqual(40)
  })

  it('后端 pid 未给时不写该字段；extra 会并入', () => {
    const payload = buildDiagnostics({
      versions: {},
      paths: { dataDir: 'd', logsDir: 'l', dbPath: 'd\\x.db' },
      backendStatus: 'stopped',
      engine: { source: 'auto', env: {} },
      extra: { taskCount: 3 },
    })
    expect(payload.backend).toEqual({ status: 'stopped' })
    expect(payload.taskCount).toBe(3)
  })

  it('文件名按本地时间戳生成', () => {
    const name = diagnosticsFileName(new Date(2026, 8, 30, 9, 5, 7))
    expect(name).toBe('diagnostics-20260930-090507.json')
  })

  it('版本缺失时不崩（桌面壳可能拿不到某些版本）', () => {
    const spy = vi.fn()
    spy()
    expect(() =>
      buildDiagnostics({
        versions: {},
        paths: { dataDir: 'd', logsDir: 'l', dbPath: 'd\\x.db' },
        backendStatus: 'starting',
        engine: { source: 'env', env: {} },
      }),
    ).not.toThrow()
  })
})
