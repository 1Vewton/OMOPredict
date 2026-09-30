// 单实例（docs/desktop.md D7）。
//
// 用**文件锁**而不是 Electron 的 `app.requestSingleInstanceLock()`：
// 后者只管"同一用户的 Electron 实例"，而且只能在 T7 的主进程里用；
// 文件锁放在 Host 层既能被单测覆盖，也能防止"Go 后端被两个壳同时拉起"这类真正有害的场景
// （同一个 SQLite 文件被两个进程写）。T7 会两者都用：Electron 锁负责聚焦已有窗口，
// 文件锁负责守住后端与数据库。
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** 已有实例在运行时抛出（携带持有者 pid 便于提示"请切换到已打开的窗口"）。 */
export class SingleInstanceError extends Error {
  constructor(
    message: string,
    public readonly holderPid: number | null,
  ) {
    super(message)
    this.name = 'SingleInstanceError'
  }
}

export interface SingletonLock {
  path: string
  pid: number
  /** 覆盖了陈旧锁（上次异常退出留下的） */
  reclaimed: boolean
  /** 释放锁；只删除"仍属于自己"的锁文件，避免误删后来者的锁 */
  release(): void
}

export interface SingletonDeps {
  /** 当前进程 pid（测试用） */
  pid?: number
  /** 判断进程是否存活（默认 process.kill(pid, 0)） */
  isAlive?: (pid: number) => boolean
  /** 时间源 */
  now?: () => number
}

interface LockFile {
  pid?: unknown
  startedAt?: unknown
}

/** 默认存活判断：ESRCH 表示不存在，EPERM 表示存在但不属于我们（仍算存活）。 */
export function defaultIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * 取得单实例锁。
 *
 * 参数:
 *   lockPath  锁文件路径（通常 `<dataDir>/instance.lock`）
 *   deps      注入点（pid / 存活判断 / 时间源），便于单测
 *
 * 返回:
 *   SingletonLock（可 release）
 *
 * 异常:
 *   SingleInstanceError  已有存活实例持有锁
 */
export function acquireSingletonLock(lockPath: string, deps: SingletonDeps = {}): SingletonLock {
  const pid = deps.pid ?? process.pid
  const isAlive = deps.isAlive ?? defaultIsAlive
  const now = deps.now ?? (() => Date.now())

  mkdirSync(dirname(lockPath), { recursive: true })
  const payload = JSON.stringify({ pid, startedAt: now() })

  const tryCreate = (): boolean => {
    try {
      writeFileSync(lockPath, payload, { encoding: 'utf8', flag: 'wx' })
      return true
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false
      throw e
    }
  }

  let reclaimed = false
  if (!tryCreate()) {
    const holder = readHolderPid(lockPath)
    // 注意：**不豁免"持有者就是自己"**——同一进程内起两个 Host 会拉起两个后端写同一个
    // SQLite，属于要拦住的 bug，而不是要放行的重入。
    if (holder !== null && isAlive(holder)) {
      throw new SingleInstanceError(
        `OMOPredict 已在运行（pid=${holder}）；请切换到已打开的窗口。`,
        holder,
      )
    }
    // 陈旧锁（持有者已退出）或损坏锁：覆盖
    writeFileSync(lockPath, payload, { encoding: 'utf8' })
    reclaimed = true
  }

  return {
    path: lockPath,
    pid,
    reclaimed,
    release: () => {
      // 只删自己的锁：如果后来者已接管，不能删掉它的锁
      const holder = readHolderPid(lockPath)
      if (holder !== null && holder !== pid) return
      try {
        if (existsSync(lockPath)) unlinkSync(lockPath)
      } catch {
        // 释放失败无害（下次启动会按陈旧锁处理）
      }
    },
  }
}

function readHolderPid(lockPath: string): number | null {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, 'utf8')) as LockFile
    const pid = Number(parsed.pid)
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    // 空文件/半截写入/非 JSON：视为无效锁（按陈旧处理）
    return null
  }
}
