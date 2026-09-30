// 渲染进程资源如何加载（docs/desktop.md D2）：自定义协议 `app://omo/…` + SPA 回退。
//
// 为什么不用 file://：`createWebHistory` 路由下 file:// 的相对路径与 SPA 回退都很别扭，
// 且 file:// 的源与权限模型更难收紧。
//
// 本模块是**安全敏感**的：它决定"渲染进程能读到磁盘上的哪些文件"，
// 因此目录穿越（含百分号编码变体）必须被挡住，并有专门用例覆盖。
import { existsSync } from 'node:fs'
import { posix, win32 } from 'node:path'

/** 自定义协议名与主机（`app://omo/...`）。 */
export const APP_SCHEME = 'app'
export const APP_HOST = 'omo'

/**
 * 渲染进程的 CSP（docs/desktop.md D11）。
 *
 * `connect-src 'none'` 是**强读要求**的体现：桌面形态全程走 IPC，渲染进程不该有任何网络能力。
 * `style-src` 允许 inline 是因为 Vue/ECharts 会写行内样式。
 */
export const CSP =
  "default-src 'self' app:; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self' data:; connect-src 'none'; object-src 'none'; " +
  "base-uri 'none'; form-action 'none'"

/** 需要回给渲染进程的响应头（安全头集中在此，便于单测）。 */
export const RESPONSE_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
}

/** 扩展名 → MIME（够用即可；未命中回退 application/octet-stream）。 */
export const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
}

/** 按扩展名取 MIME。 */
export function mimeFor(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  if (dot < 0) return 'application/octet-stream'
  return MIME_TYPES[filePath.slice(dot).toLowerCase()] ?? 'application/octet-stream'
}

/** 解析结果。 */
export interface ResolvedAsset {
  /** 磁盘绝对路径 */
  filePath: string
  mimeType: string
  /** 是否走了 SPA 回退（未知路径 → index.html） */
  spaFallback: boolean
}

export interface ResolveDeps {
  exists?: (path: string) => boolean
  platform?: NodeJS.Platform
}

/**
 * 把 `app://omo/<path>` 解析成磁盘文件。
 *
 * 规则（D2）：
 *   1. 只接受 `app://omo` 的请求，其它协议/主机一律返回 null（调用方回 4xx）；
 *   2. 路径先百分号解码再规范化，**规范化后必须仍在 distDir 内**（挡目录穿越）；
 *   3. 命中真实文件则直接返回；
 *   4. 未命中则回退 `index.html`（保持 `createWebHistory` 的深链可用）；
 *   5. `index.html` 也不存在（未构建）时返回 null。
 *
 * 返回 null 表示"不应由本协议提供"。
 */
export function resolveAppRequest(
  url: string,
  distDir: string,
  deps: ResolveDeps = {},
): ResolvedAsset | null {
  const platform = deps.platform ?? process.platform
  const p = platform === 'win32' ? win32 : posix
  const exists = deps.exists ?? existsSync

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${APP_SCHEME}:` || parsed.hostname !== APP_HOST) return null

  let pathname: string
  try {
    pathname = decodeURIComponent(parsed.pathname)
  } catch {
    return null // 非法百分号编码
  }
  if (pathname.includes('\0')) return null

  const relative = pathname.replace(/^[/\\]+/, '')
  const root = p.resolve(distDir)
  const candidate = relative.length === 0 ? root : p.resolve(root, relative)
  // 目录穿越防护：解析后必须落在 root 内（root 本身允许，代表 index.html 的目录请求）
  const rootWithSep = root.endsWith(p.sep) ? root : `${root}${p.sep}`
  if (candidate !== root && !candidate.startsWith(rootWithSep)) return null

  if (relative.length > 0) {
    // 显式请求目录时也走 SPA 回退，避免把目录当文件读
    const isDirLike = relative.endsWith('/') || relative.endsWith('\\')
    if (!isDirLike && exists(candidate)) {
      return { filePath: candidate, mimeType: mimeFor(candidate), spaFallback: false }
    }
  }

  const index = p.join(root, 'index.html')
  if (!exists(index)) return null
  return { filePath: index, mimeType: MIME_TYPES['.html'], spaFallback: true }
}
