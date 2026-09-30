// 文件日志（docs/desktop.md D7）：按天命名、保留 N 天、同时回显到进程 stderr。
//
// 为什么不用现成库：需要"注入时间源以便测轮转"且要零额外依赖（桌面包体积敏感）。
// 写文件用同步 append：日志量小，同步避免退出时丢最后几行（排障场景最重要的是尾部）。
import { appendFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** 三段日志各写一个文件（host / backend / engine）。 */
export type LogName = 'host' | 'backend' | 'engine'

export interface LoggerOptions {
  /** 日志目录（不存在会创建） */
  dir: string
  /** 文件前缀，最终为 `<name>-YYYY-MM-DD.log` */
  name: string
  /** 保留天数（默认 7，D7） */
  retentionDays?: number
  /** 时间源（可注入以便测轮转） */
  now?: () => Date
  /** 每行的回显出口（默认 process.stderr；传 null 关闭） */
  echo?: ((line: string) => void) | null
}

export interface Logger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
  /** 当前日志文件路径（随时钟变化） */
  currentFile(): string
  /** 删除超出保留期的日志文件，返回删除数量 */
  prune(): number
  /** 关闭（本实现为 no-op，保留以便将来换异步写入） */
  close(): void
}

function two(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** `YYYY-MM-DD`（本地时区，便于用户按"今天"找日志）。 */
export function dateStamp(d: Date): string {
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

/** 构造 `YYYY-MM-DD HH:mm:ss.SSS` 时间戳。 */
export function timeStamp(d: Date): string {
  return `${dateStamp(d)} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${String(
    d.getMilliseconds(),
  ).padStart(3, '0')}`
}

/**
 * 创建文件日志。
 *
 * 参数:
 *   opts.dir      日志目录（自动创建）
 *   opts.name     文件前缀（host / backend / engine）
 *   opts.retentionDays 保留天数，默认 7
 *   opts.now      时间源（测试用）
 *   opts.echo     回显出口，默认 process.stderr
 */
export function createFileLogger(opts: LoggerOptions): Logger {
  const retentionDays = opts.retentionDays ?? 7
  const now = opts.now ?? (() => new Date())
  const echo =
    opts.echo === undefined ? (line: string) => process.stderr.write(`${line}\n`) : opts.echo

  const fileFor = (d: Date) => join(opts.dir, `${opts.name}-${dateStamp(d)}.log`)
  // 目录不可用时退化为"仅回显"：日志本身出问题不该让应用起不来
  let dirUsable = true
  try {
    mkdirSync(opts.dir, { recursive: true })
  } catch {
    dirUsable = false
    echo?.(`[logger] 无法创建日志目录 ${opts.dir}，本次仅回显到 stderr`)
  }

  const logger: Logger = {
    info: (m) => write('INFO', m),
    warn: (m) => write('WARN', m),
    error: (m) => write('ERROR', m),
    currentFile: () => fileFor(now()),
    prune: () => (dirUsable ? pruneLogs(opts.dir, opts.name, retentionDays, now()) : 0),
    close: () => {},
  }

  function write(level: string, message: string): void {
    const line = `${timeStamp(now())} ${level} ${message}`
    if (!dirUsable) {
      echo?.(line)
      return
    }
    try {
      appendFileSync(fileFor(now()), `${line}\n`, 'utf8')
    } catch (e) {
      // 磁盘/权限问题不得让应用崩掉：回显到 stderr 即可
      echo?.(`${line}  [日志写入失败: ${(e as Error).message}]`)
      return
    }
    echo?.(line)
  }

  logger.prune()
  return logger
}

/** 删除同一前缀下过期的日志文件（按文件名中的日期判断，不依赖 mtime）。 */
export function pruneLogs(dir: string, name: string, retentionDays: number, now: Date): number {
  const prefix = `${name}-`
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000)
  const cutoffStamp = dateStamp(cutoff)
  let removed = 0
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return 0
  }
  for (const entry of entries) {
    if (!entry.startsWith(prefix) || !entry.endsWith('.log')) continue
    const stamp = entry.slice(prefix.length, entry.length - '.log'.length)
    // 文件名日期是字典序可比（YYYY-MM-DD），早于 cutoff 即过期
    if (!/^\d{4}-\d{2}-\d{2}$/.test(stamp) || stamp >= cutoffStamp) continue
    try {
      rmSync(join(dir, entry), { force: true })
      removed++
    } catch {
      // 被占用等情况：忽略（下次启动再试）
    }
  }
  return removed
}
