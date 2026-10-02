// Electron 主进程（docs/desktop.md T7）。
//
// 职责边界：**只做接线**——窗口、`app://` 协议、菜单、IPC、生命周期。
// 逻辑分别落在 `host/`（后端守护，D5/D6/D7）与 `shell/`（协议解析、菜单模板、预加载桥、
// 后端定位、诊断），那两部分可在无 GUI 环境下完整单测；本文件靠 `tsc --noEmit` 对真实
// Electron 类型做静态检查，**运行期验证属 T11 净机验收**（见 docs/desktop.md §13）。
//
// 安全基线（D2/D11）：渲染进程不联网（CSP `connect-src 'none'`）、无 Node 能力、
// 上下文隔离 + 沙箱，仅通过 preload 白名单与主进程通信。
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, shell } from 'electron'
import { writeFileSync } from 'node:fs'
import { readFile as readFileAsync } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Host } from './host/host'
import { BackendExitError } from './host/backend'
import { describeEngineFailure } from './host/engine'
import { SingleInstanceError } from './host/singleton'
import { CHANNELS, makeRpcHandler } from './shell/channels'
import { RESPONSE_HEADERS, resolveAppRequest } from './shell/appProtocol'
import { resolveBackendCommand } from './shell/backendCommand'
import { buildDiagnostics, diagnosticsFileName } from './shell/diagnostics'
import { buildMenuTemplate } from './shell/menu'
import { mainWindowOptions } from './shell/windowOptions'

/** 本文件所在目录（编译产物与 preload 同目录）。 */
const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * preload 必须是 **CommonJS**：窗口启用了 `sandbox: true`，而沙箱化的 preload 只能是 CJS，
 * 本包又是 `"type": "module"`。做法是把它编译到 `dist/preload/`，并在那里放一个
 * `{"type":"commonjs"}` 的 package.json（见 `tsconfig.preload.json` 与 `scripts/build-desktop.ps1`），
 * 因此这里指向隔壁目录的 `preload.js`，而不是同目录的 `.cjs`。
 */
const PRELOAD_PATH = join(HERE, '..', 'preload', 'preload.js')

/** 开发模式：加载 Vite dev server 而不是打包资源（docs/desktop.md §8）。 */
const DEV_URL = process.env.OMO_DESKTOP_DEV_URL?.trim() || undefined

/** 打包后的渲染资源目录（构建期把 frontend/dist 放到 resources/dist）。 */
const RENDERER_DIST = app.isPackaged
  ? join(process.resourcesPath, 'dist')
  : join(app.getAppPath(), '..', 'frontend', 'dist')

let host: Host | null = null
let mainWindow: BrowserWindow | null = null

// 自定义协议必须在 app ready 之前登记权限：standard 让它具备正常的源语义
// （history 路由、相对路径、存储分区都依赖它）。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false },
  },
])

/** 注册 `app://` 处理器：只服务打包好的渲染资源，未知路径回退 index.html（D2）。 */
function registerAppProtocol(): void {
  protocol.handle('app', async (request) => {
    const resolved = resolveAppRequest(request.url, RENDERER_DIST)
    if (!resolved) {
      return new Response('Not Found', { status: 404, headers: RESPONSE_HEADERS })
    }
    try {
      const body = await readFileAsync(resolved.filePath)
      return new Response(body, {
        status: 200,
        headers: { ...RESPONSE_HEADERS, 'Content-Type': resolved.mimeType },
      })
    } catch (e) {
      return new Response(`读取失败: ${(e as Error).message}`, {
        status: 500,
        headers: RESPONSE_HEADERS,
      })
    }
  })
}

async function createMainWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow(mainWindowOptions({ preloadPath: PRELOAD_PATH }))
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    mainWindow = null
  })

  if (DEV_URL) {
    await win.loadURL(DEV_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    await win.loadURL('app://omo/index.html')
  }
  return win
}

/** 导出诊断信息到数据目录并选中它（脱敏见 shell/diagnostics）。 */
async function exportDiagnostics(): Promise<void> {
  const dir = host?.paths.dataDir ?? app.getPath('userData')
  const payload = buildDiagnostics({
    versions: {
      app: app.getVersion(),
      electron: process.versions.electron ?? '-',
      chrome: process.versions.chrome ?? '-',
      node: process.versions.node,
    },
    paths: host?.paths ?? { dataDir: dir, logsDir: dir, dbPath: join(dir, 'omopredict.db') },
    backendStatus: host?.status ?? 'not-started',
    ...(host?.backendPid !== undefined ? { backendPid: host.backendPid } : {}),
    engine: host
      ? { source: host.engineDiscovery.source, env: host.engineDiscovery.env }
      : { source: 'unknown', env: {} },
    ...(host ? { backendStderrTail: host.backendStderr } : {}),
  })
  const file = join(dir, diagnosticsFileName())
  writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8')
  shell.showItemInFolder(file)
}

/** 按 D7 组装菜单。 */
function installMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildMenuTemplate(
        {
          showAbout: () => {
            const detail = [
              `OMOPredict ${app.getVersion()}`,
              `Electron ${process.versions.electron ?? '-'}`,
              `Chromium ${process.versions.chrome ?? '-'}`,
              `Node ${process.versions.node}`,
              `后端状态 ${host?.status ?? '未启动'}`,
              `引擎来源 ${host?.engineDiscovery.source ?? '-'}`,
            ].join('\n')
            void dialog.showMessageBox({
              type: 'info',
              title: '关于 OMOPredict',
              message: 'OMOPredict 桌面版',
              detail,
              buttons: ['确定'],
            })
          },
          openDataDir: () => void shell.openPath(host?.paths.dataDir ?? app.getPath('userData')),
          openLogDir: () => void shell.openPath(host?.paths.logsDir ?? app.getPath('userData')),
          exportDiagnostics: () => void exportDiagnostics(),
          quit: () => app.quit(),
        },
        { isMac: process.platform === 'darwin', appName: 'OMOPredict' },
      ),
    ),
  )
}

/** 启动后端；失败按 D9 第 5 级给出可操作提示（而不是只报一个 exit code）。 */
async function startHost(): Promise<Host> {
  const command = resolveBackendCommand({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  })
  // 打包形态：随包引擎放在 <resourcesPath>/engine（discoverEngine 会拼 'engine'）；
  // 开发期没有该目录，交给 Go 侧的自动发现（OMO_ENGINE_CMD / uv / PATH python）。
  const resourcesDir = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), '..')
  return Host.start({
    backendCommand: command.command,
    backendArgs: command.args,
    resourcesDir,
  })
}

function registerIpc(): void {
  const requireHost = (): Host => {
    if (!host) throw Object.assign(new Error('后端未就绪'), { code: 0 })
    return host
  }
  const handle = makeRpcHandler((method, params) => requireHost().invoke(method, params))
  ipcMain.handle(CHANNELS.rpc, (_event, raw: unknown) => handle(raw))
  ipcMain.handle(CHANNELS.version, () => app.getVersion())
  ipcMain.handle(CHANNELS.openLogDir, () => shell.openPath(requireHost().paths.logsDir))
  ipcMain.handle(CHANNELS.openDataDir, () => shell.openPath(requireHost().paths.dataDir))
}

async function bootstrap(): Promise<void> {
  try {
    host = await startHost()
  } catch (e) {
    const detail =
      e instanceof BackendExitError
        ? describeEngineFailure(e.stderrTail)
        : e instanceof SingleInstanceError
          ? e.message
          : (e as Error).message
    dialog.showErrorBox('OMOPredict 启动失败', detail)
    app.exit(1)
    return
  }

  registerIpc()
  installMenu()
  mainWindow = await createMainWindow()
}

// 单实例（D7）：Electron 锁负责"聚焦已有窗口"，Host 的文件锁负责守住后端与数据库。
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  // 桌面应用没有"关窗留在后台"的语义（托盘常驻是 §12 的后续选项）
  app.on('window-all-closed', () => app.quit())

  // 退出前先把后端子进程与单实例锁收干净，避免残留
  app.on('will-quit', (event) => {
    const target = host
    if (!target) return
    host = null
    event.preventDefault()
    void target
      .dispose()
      .catch(() => undefined)
      .finally(() => app.quit())
  })

  void app.whenReady().then(async () => {
    registerAppProtocol()
    await bootstrap()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createMainWindow()
    })
  })
}
