// 诊断信息导出（docs/desktop.md D7："导出诊断信息（logs + db 副本 + 版本）"）。
//
// 本模块只负责**构造可序列化的诊断对象**与文件名；写盘/打开目录由主进程做。
//
// 安全要点：环境变量里可能含密钥（`OMO_JWT_SECRET`、token 等），
// 诊断包是要发给别人看的，**必须脱敏**——这条有用例守护。
import { basename } from 'node:path'

export interface DiagnosticsInput {
  /** 版本集合（app / electron / node / chrome / 后端 / 引擎） */
  versions: Record<string, string>
  paths: { dataDir: string; logsDir: string; dbPath: string }
  /** 后端状态（ready / failed / …）与 pid */
  backendStatus: string
  backendPid?: number
  /** 引擎来源与注入给它的环境（会被脱敏） */
  engine: { source: string; env: Record<string, string> }
  /** 后端 stderr 尾部（排障最关键的一段） */
  backendStderrTail?: string
  /** 其它补充字段（如 taskCount） */
  extra?: Record<string, unknown>
  now?: Date
}

/** 需要脱敏的环境变量名（大小写不敏感的子串匹配）。 */
const SECRET_PATTERN = /secret|token|password|passwd|credential|apikey|api_key/i

/** 脱敏后的占位符。 */
const REDACTED = '***REDACTED***'

/** 对键值集合脱敏：键名命中敏感词则值替换为占位符。 */
export function redactEnv(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    out[key] = SECRET_PATTERN.test(key) ? REDACTED : value
  }
  return out
}

/** `diagnostics-YYYYMMDD-HHmmss.json`（本地时间，便于按时间找）。 */
export function diagnosticsFileName(now: Date = new Date()): string {
  const two = (n: number): string => (n < 10 ? `0${n}` : String(n))
  return (
    `diagnostics-${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}` +
    `-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}.json`
  )
}

/**
 * 构造诊断对象（JSON 可序列化）。
 *
 * 参数:
 *   input.versions          版本集合（各层一起给，便于对齐排障）
 *   input.paths             数据/日志/数据库路径
 *   input.backendStatus     后端状态与 pid
 *   input.engine            引擎来源与其环境（**脱敏后写入**）
 *   input.backendStderrTail 后端 stderr 尾部
 *   input.now               时间源（测试用）
 *
 * 返回:
 *   可直接 `JSON.stringify` 的对象
 */
export function buildDiagnostics(input: DiagnosticsInput): Record<string, unknown> {
  const now = input.now ?? new Date()
  return {
    generatedAt: now.toISOString(),
    app: 'OMOPredict Desktop',
    versions: { ...input.versions },
    paths: {
      dataDir: input.paths.dataDir,
      logsDir: input.paths.logsDir,
      db: basename(input.paths.dbPath),
    },
    backend: {
      status: input.backendStatus,
      ...(input.backendPid !== undefined ? { pid: input.backendPid } : {}),
    },
    engine: {
      source: input.engine.source,
      env: redactEnv(input.engine.env),
    },
    ...(input.backendStderrTail ? { backendStderrTail: tail(input.backendStderrTail) } : {}),
    ...(input.extra ?? {}),
  }
}

/** 只保留尾部若干行：诊断包不该被日志淹没。 */
function tail(text: string, lines = 40): string {
  const all = text.split(/\r?\n/).filter((l) => l.length > 0)
  return all.slice(Math.max(0, all.length - lines)).join('\n')
}
