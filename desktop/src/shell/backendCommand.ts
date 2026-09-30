// 后端可执行文件的定位（打包后 vs 开发期）。
//
// 打包形态（T8 的 electron-builder 配置）把 `omopredict-server[.exe]` 放进 `resources/`；
// 开发期没有壳的安装目录，所以按"环境变量 → 打包资源 → 仓库内构建产物"的顺序找，
// 找不到就**明确报错并给出怎么构建**，而不是让用户面对一个空窗口。
import { existsSync } from 'node:fs'
import { posix, win32 } from 'node:path'

export interface BackendCommand {
  command: string
  args: string[]
  /** 解析来源（写日志/诊断） */
  source: 'env' | 'packaged' | 'repo-build'
}

export interface ResolveBackendInput {
  /** 是否运行在打包后的应用中（`app.isPackaged`） */
  isPackaged: boolean
  /** `process.resourcesPath`（打包后资源目录） */
  resourcesPath?: string
  /** `app.getAppPath()`（打包后为 asar 路径；开发期为 desktop/ 目录） */
  appPath?: string
  env?: NodeJS.ProcessEnv
  exists?: (path: string) => boolean
  platform?: NodeJS.Platform
}

/** 后端子进程始终以 stdio JSON-RPC 模式启动（桌面形态无端口，D11）。 */
export const BACKEND_ARGS = ['--stdio']

/** 找不到后端时抛出（消息面向用户，含"怎么构建"）。 */
export class BackendNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackendNotFoundError'
  }
}

/**
 * 解析后端可执行文件。
 *
 * 顺序：
 *   1. `OMO_BACKEND_EXE`（联调/机房统一配置；路径含空格时无需加引号——此处不走 shell）
 *   2. 打包资源 `<resourcesPath>/omopredict-server[.exe]`
 *   3. 开发期仓库构建产物 `<appPath>/../server/omopredict[.exe]`
 *
 * 异常:
 *   BackendNotFoundError  三者都没找到
 */
export function resolveBackendCommand(input: ResolveBackendInput): BackendCommand {
  const platform = input.platform ?? process.platform
  const exists = input.exists ?? existsSync
  const env = input.env ?? process.env
  const p = platform === 'win32' ? win32 : posix
  const names =
    platform === 'win32'
      ? ['omopredict-server.exe', 'omopredict-server', 'omopredict.exe']
      : ['omopredict-server', 'omopredict']

  const explicit = env.OMO_BACKEND_EXE?.trim()
  if (explicit && explicit.length > 0) {
    return { command: explicit, args: BACKEND_ARGS, source: 'env' }
  }

  if (input.resourcesPath) {
    for (const name of names) {
      const candidate = p.join(input.resourcesPath, name)
      if (exists(candidate)) return { command: candidate, args: BACKEND_ARGS, source: 'packaged' }
    }
  }

  if (input.appPath) {
    // 开发期：desktop/ 的上一级就是仓库根，后端产物在 server/ 下
    const repoServer = p.join(input.appPath, '..', 'server')
    for (const name of names) {
      const candidate = p.resolve(repoServer, name)
      if (exists(candidate)) return { command: candidate, args: BACKEND_ARGS, source: 'repo-build' }
    }
  }

  throw new BackendNotFoundError(
    '找不到 Go 中间层可执行文件（omopredict-server）。\n\n' +
      '开发期请先构建：\n  cd server && go build -o omopredict.exe ./cmd/omopredict\n' +
      '或设置环境变量 OMO_BACKEND_EXE 指向它的绝对路径。',
  )
}
