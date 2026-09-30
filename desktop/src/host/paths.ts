// 用户数据目录（docs/desktop.md D6）。
//
// 桌面版把数据放在用户目录而不是程序目录：安装目录可能只读、且升级不应丢数据。
// 路径一律用 ASCII 子目录名（OMOPredict），避免中文用户名/长路径触发 SQLite 与解压问题。
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

/** Host 使用的全部路径。 */
export interface HostPaths {
  /** 数据目录（数据库等） */
  dataDir: string
  /** 日志目录（三段日志按天轮转，docs/desktop.md D7） */
  logsDir: string
  /** SQLite 数据库文件 */
  dbPath: string
  /** 单实例锁文件 */
  lockPath: string
}

/** 解析所需的平台与环境（可注入，便于单测三种平台）。 */
export interface PathInput {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  /** 用户主目录（默认 os.homedir()） */
  home?: string
}

/** 应用目录名（ASCII）。 */
const APP_DIR = 'OMOPredict'

/**
 * 解析数据目录（按平台惯例）：
 *
 * | 平台 | 路径 |
 * |---|---|
 * | Windows | `%LOCALAPPDATA%\OMOPredict\` |
 * | macOS | `~/Library/Application Support/OMOPredict/` |
 * | Linux | `${XDG_DATA_HOME:-~/.local/share}/omopredict/` |
 *
 * Windows 下 `LOCALAPPDATA` 缺失时回落到 `%USERPROFILE%\AppData\Local`。
 */
export function resolveHostPaths(input: PathInput = {}): HostPaths {
  const platform = input.platform ?? process.platform
  const env = input.env ?? process.env
  const home = input.home ?? homedir()
  // 按**目标平台**选择路径语义（而不是宿主平台）：这样跨平台行为可被单测精确断言，
  // 也避免在 Windows 上为 macOS/Linux 拼出反斜杠路径。
  const p = platform === 'win32' ? win32 : posix

  let base: string
  let appDir = APP_DIR
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA?.trim()
    const userProfile = env.USERPROFILE?.trim() ?? home
    base =
      localAppData && localAppData.length > 0 ? localAppData : p.join(userProfile, 'AppData', 'Local')
  } else if (platform === 'darwin') {
    base = p.join(home, 'Library', 'Application Support')
  } else {
    const xdg = env.XDG_DATA_HOME?.trim()
    base = xdg && xdg.length > 0 ? xdg : p.join(home, '.local', 'share')
    appDir = APP_DIR.toLowerCase()
  }

  const dataDir = p.join(base, appDir)
  return {
    dataDir,
    logsDir: p.join(dataDir, 'logs'),
    dbPath: p.join(dataDir, 'omopredict.db'),
    lockPath: p.join(dataDir, 'instance.lock'),
  }
}
