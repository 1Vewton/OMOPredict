// OMOPredict local debug bridge: HTTP <-> stdio JSON-RPC.
//
// Why this exists (docs/desktop.md T9, scripts/start-local.ps1):
// the desktop shape never listens on a port - Go runs `--stdio` and talks JSON-RPC to the Python
// engine over pipes. That is exactly what makes the desktop shape safe, and exactly what makes it
// impossible to point a browser at it. This bridge is the missing adapter: it owns the only HTTP
// port in the process tree, translates each REST-ish request into one JSON-RPC call to Go
// (`internal/rpc` method names), and serves frontend/dist so the whole app can be driven from a
// normal browser with no Electron involved.
//
// It is a DEBUG TOOL, not a production server:
//   - it only ever talks to a child process it spawned itself (never a remote host);
//   - it binds 127.0.0.1 by default;
//   - the route table below is a closed whitelist - there is no generic proxy/forward feature.
//
// The generic half of this file (JsonLinesClient, resolveStaticFile, mapRequest) is deliberately
// free of process/network side effects so desktop/src/shell/localBridge.test.ts can unit-test it.
//
// NOTE: this file is dependency-free on purpose - a debug helper must run on a bare Node install.
// It lives next to its CLI entry point (scripts/local-bridge.mjs) rather than in a sub-directory,
// because .gitignore carries a blanket `lib/` rule (line 17, inherited from the Python template)
// that would silently swallow it.

import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { posix, win32 } from 'node:path'

// ---------------------------------------------------------------- protocol constants

/** JSON-RPC reserved error codes (same family as Go `internal/rpc`). */
export const PARSE_ERROR = -32700
export const INVALID_REQUEST = -32600
export const METHOD_NOT_FOUND = -32601
export const INVALID_PARAMS = -32602

/** Single-line ceiling; must match the Go side (16 MiB) or long optimize reports get split. */
export const MAX_LINE_BYTES = 16 * 1024 * 1024

/** Default per-call timeout: a full optimize sweep can take a while. */
export const DEFAULT_CALL_TIMEOUT_MS = 120_000

// ---------------------------------------------------------------- statics

/** Extension -> Content-Type. Kept next to the desktop shell's table (same set, plain object). */
export const MIME_TYPES = {
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

/**
 * Content-Type for a path (unknown extensions fall back to application/octet-stream).
 *
 * @param {string} filePath
 * @returns {string}
 */
export function mimeFor(filePath) {
  const dot = filePath.lastIndexOf('.')
  if (dot < 0) return 'application/octet-stream'
  return MIME_TYPES[filePath.slice(dot).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Resolve a URL pathname to a file inside the renderer dist directory.
 *
 * Security: this decides which files the browser can read, so path traversal must be blocked,
 * including percent-encoded variants (`%2e%2e%2f`) and NUL bytes.
 *
 * The rule is **intent**, not outcome: any path that needs `.`/`..` normalisation is refused
 * outright, *before* resolving. Deciding purely by "does the resolved path stay under the root"
 * is not enough - `/a/../design` and `/a/..` normalise back inside the root, so such requests would
 * fall through to the SPA fallback and get a 200 with index.html. That is a traversal attempt being
 * answered successfully, and it is platform-dependent besides: on win32 the segments fold away
 * inside the root, while on POSIX the same spelling can be a literal filename. Checking the
 * decoded segments is the same answer on every platform.
 *
 * Backslashes keep their host semantics: on Windows they separate segments (and the ".." check
 * catches them), elsewhere they are ordinary filename characters and never escape anything - which
 * is why a path containing a backslash must not be mistaken for a traversal attempt there.
 *
 * Unknown paths fall back to `index.html` (SPA deep links); no fallback and no file -> null so the
 * caller can answer 404 instead of pretending.
 *
 * @param {string} pathname   raw URL pathname (still percent-encoded)
 * @param {string} rootDir    renderer dist directory
 * @param {{ exists?: (p: string) => boolean, isFile?: (p: string) => boolean, platform?: string }} [deps]
 * @returns {{ filePath: string, mimeType: string, spaFallback: boolean } | null}
 */
export function resolveStaticFile(pathname, rootDir, deps = {}) {
  const platform = deps.platform ?? process.platform
  const p = platform === 'win32' ? win32 : posix
  const exists = deps.exists ?? existsSync
  const isFile = deps.isFile ?? ((candidate) => statSync(candidate).isFile())

  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null // malformed percent-encoding
  }
  if (decoded.includes('\0')) return null

  // Traversal intent: refuse any dot-segment instead of resolving it and asking whether the
  // result escaped. See the doc comment above for why outcome-based checking is not enough,
  // and HANDOVER 6.36 for how the first, weaker version of this guard hid the problem.
  //
  // The check is separator-agnostic on purpose: "/..%5c..%5cwindows" is one literal filename on
  // POSIX and two ".." segments on Windows, but it is the same intent either way, and the answer
  // must not depend on which host happens to serve it. A dot in the *middle* of a segment
  // ("app.min.js", "v0.1.0.json") is an ordinary character and stays allowed.
  if (decoded.split(/[/\\]/).some((segment) => segment === '..' || segment === '.')) {
    return null
  }

  // From here on, only the host's real separator matters for resolution.
  const root = p.resolve(rootDir)
  const relative = decoded.replace(/^[/\\]+/, '')
  const candidate = relative.length === 0 ? root : p.resolve(root, relative)

  // Belt and braces: the resolved path must still live under root (catches platform-specific
  // spellings the segment check above cannot see, e.g. a Windows drive-relative path).
  const rootWithSep = root.endsWith(p.sep) ? root : `${root}${p.sep}`
  if (candidate !== root && !candidate.startsWith(rootWithSep)) return null

  if (relative.length > 0 && !relative.endsWith('/') && !relative.endsWith('\\')) {
    try {
      if (exists(candidate) && isFile(candidate)) {
        return { filePath: candidate, mimeType: mimeFor(candidate), spaFallback: false }
      }
    } catch {
      // fall through to the SPA fallback
    }
  }

  const index = p.join(root, 'index.html')
  if (!exists(index)) return null
  return { filePath: index, mimeType: MIME_TYPES['.html'], spaFallback: true }
}

/**
 * Map one decoded HTTP request onto a `internal/rpc` method + params.
 *
 * Pure function: no I/O, so the whole REST<->RPC mapping is unit-testable. Returning null means
 * "not ours" (caller answers 404); a `{ error, status }` result means the request was ours but
 * ill-formed (missing path parameter etc.).
 *
 * @param {string} method     HTTP verb (already upper-cased)
 * @param {string} pathname   decoded pathname, e.g. `/api/tasks/abc`
 * @param {unknown} body      parsed JSON body (undefined for GET/DELETE)
 * @returns {{ rpc: string, params?: unknown, status: number } | { error: string, status: number } | null}
 */
export function mapRequest(method, pathname, body) {
  const segments = pathname.split('/').filter((s) => s.length > 0)

  if (method === 'GET' && pathname === '/health') {
    return { rpc: 'ping', status: 200 }
  }
  if (method === 'GET' && pathname === '/api/meta') {
    return { rpc: 'meta', status: 200 }
  }
  if (method === 'GET' && pathname === '/api/tasks') {
    return { rpc: 'tasks.list', status: 200 }
  }
  if (method === 'POST' && pathname === '/api/tasks') {
    return { rpc: 'tasks.create', params: body ?? {}, status: 202 }
  }
  if (segments[0] === 'api' && segments[1] === 'tasks' && segments.length === 3) {
    const id = segments[2]
    if (id.length === 0) return { error: 'missing task id', status: 400 }
    if (method === 'GET') return { rpc: 'tasks.get', params: { id }, status: 200 }
    if (method === 'DELETE') return { rpc: 'tasks.delete', params: { id }, status: 200 }
    return { error: `method ${method} not allowed on /api/tasks/{id}`, status: 405 }
  }
  // Auth endpoints exist in the contract but are disabled in single-user mode; the bridge runs the
  // backend with OMO_AUTH_MODE=none, so it mirrors the HTTP behaviour instead of 404ing.
  if (method === 'GET' && pathname === '/api/auth/me') {
    return { rpc: '__local_user', status: 200 }
  }
  if (method === 'POST' && (pathname === '/api/auth/login' || pathname === '/api/auth/register')) {
    return { error: 'auth disabled in single-user (local) mode', status: 401 }
  }

  return null
}

// ---------------------------------------------------------------- JSON-Lines client

/** Error carrying an HTTP-ish status code (the code space `docs/api/rpc.md` defines). */
export class BridgeRpcError extends Error {
  /**
   * @param {number} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message)
    this.name = 'BridgeRpcError'
    this.code = code
  }
}

/**
 * Minimal newline-delimited JSON-RPC client over one duplex stream pair.
 *
 * Correlates responses by id, so out-of-order replies are safe; fans protocol noise out through
 * `onProtocolError` instead of throwing, because the peer's stdout must never be able to take the
 * bridge down (the Go side already learnt this lesson the hard way - HANDOVER 6.15).
 */
export class JsonLinesClient {
  /**
   * @param {{ write: (line: string) => unknown }} io
   * @param {{ timeoutMs?: number, onProtocolError?: (message: string) => void }} [opts]
   */
  constructor(io, opts = {}) {
    this.io = io
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS
    this.onProtocolError = opts.onProtocolError ?? (() => {})
    /** @type {Map<number, { resolve: (v: unknown) => void, reject: (e: Error) => void, timer: NodeJS.Timeout }>} */
    this.pending = new Map()
    this.nextId = 1
    this.closed = false
    this.buffer = ''
  }

  get pendingCount() {
    return this.pending.size
  }

  /**
   * Send one request and await its result.
   *
   * @param {string} method
   * @param {unknown} [params]
   * @param {{ timeoutMs?: number }} [callOpts]
   * @returns {Promise<unknown>}
   */
  async request(method, params, callOpts = {}) {
    if (this.closed) throw new BridgeRpcError(0, 'backend 连接已关闭')
    const id = this.nextId++
    const timeoutMs = callOpts.timeoutMs ?? this.timeoutMs
    const line = JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} })

    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new BridgeRpcError(0, `${method} 调用超时（${timeoutMs}ms）`))
      }, timeoutMs)
      if (typeof timer.unref === 'function') timer.unref()
      this.pending.set(id, { resolve, reject, timer })
    })

    try {
      await this.io.write(`${line}\n`)
    } catch (e) {
      const entry = this.pending.get(id)
      if (entry) {
        clearTimeout(entry.timer)
        this.pending.delete(id)
      }
      throw new BridgeRpcError(0, `写入 ${method} 请求失败: ${/** @type {Error} */ (e).message}`)
    }
    return await promise
  }

  /**
   * Feed a chunk of stdout; must tolerate partial lines and CRLF.
   *
   * @param {Buffer | string} chunk
   */
  acceptChunk(chunk) {
    this.buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk
    for (;;) {
      const newline = this.buffer.indexOf('\n')
      if (newline < 0) break
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (line.length > 0) this.acceptLine(line)
    }
    // A never-terminated line would grow without bound: drop it and say so.
    if (this.buffer.length > MAX_LINE_BYTES) {
      this.buffer = ''
      this.onProtocolError('响应行超过上限且未结束，已丢弃')
    }
  }

  /**
   * Handle one complete response line.
   *
   * @param {string} line
   */
  acceptLine(line) {
    let msg
    try {
      msg = JSON.parse(line)
    } catch (e) {
      // stdout may carry stray prints from a library; keep going (HANDOVER 6.15).
      this.onProtocolError(`非法 JSON 行: ${/** @type {Error} */ (e).message}`)
      return
    }
    if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) {
      this.onProtocolError('报文不是 JSON 对象')
      return
    }
    const id = msg.id
    if (id === undefined || id === null) return // notification: not consumed here
    if (typeof id !== 'number') {
      this.onProtocolError(`响应 id 非数值: ${String(id)}`)
      return
    }
    const entry = this.pending.get(id)
    if (!entry) {
      this.onProtocolError(`收到未知 id 的响应（id=${id}）`)
      return
    }
    clearTimeout(entry.timer)
    this.pending.delete(id)
    if (msg.error) {
      const code = typeof msg.error.code === 'number' ? msg.error.code : 0
      const message = typeof msg.error.message === 'string' ? msg.error.message : 'RPC 错误'
      entry.reject(new BridgeRpcError(code, message))
      return
    }
    entry.resolve(msg.result)
  }

  /**
   * Fail every in-flight call (peer exited / stream closed). Beats waiting out the timeout.
   *
   * @param {string} message
   */
  failAll(message) {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer)
      this.pending.delete(id)
      entry.reject(new BridgeRpcError(0, message))
    }
  }

  /** Stop accepting new calls but let in-flight ones settle. */
  shutdown() {
    this.closed = true
  }
}

// ---------------------------------------------------------------- response helpers

/** Cheap safety headers; there is no cache to speak of in a debug bridge. */
export const COMMON_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
}

/** The single-user row returned by `GET /api/auth/me` without a call to Go. */
export const LOCAL_USER = { id: 'local', username: 'local' }

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 */
export function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  res.writeHead(status, {
    ...COMMON_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
  })
  res.end(body)
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} message
 */
export function sendError(res, status, message) {
  sendJson(res, status, { error: message })
}

/**
 * Read and JSON-parse a request body (empty body -> undefined).
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<unknown>}
 */
export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_LINE_BYTES) {
        reject(new BridgeRpcError(413, '请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text.length === 0) {
        resolve(undefined)
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch (e) {
        reject(new BridgeRpcError(400, `请求体不是合法 JSON: ${/** @type {Error} */ (e).message}`))
      }
    })
    req.on('error', reject)
  })
}

/** Status for a bridge/RPC failure: keep the RPC code when it is a real HTTP-ish code. */
export function statusForError(e) {
  const code = typeof e?.code === 'number' ? e.code : 0
  if (code >= 400 && code <= 599) return code
  if (code === INVALID_PARAMS) return 400
  if (code === METHOD_NOT_FOUND) return 501
  if (code === PARSE_ERROR || code === INVALID_REQUEST) return 400
  // 0 (timeout / transport) and anything else: the backend did not answer us properly.
  return 502
}

// ---------------------------------------------------------------- server

/**
 * Build the bridge's HTTP handler around an RPC client and a static directory.
 *
 * @param {{ client: { request: (m: string, p?: unknown) => Promise<unknown> }, distDir: string,
 *           log?: (msg: string) => void,
 *           resolveStatic?: typeof resolveStaticFile }} opts
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void}
 */
export function createBridgeHandler(opts) {
  const log = opts.log ?? (() => {})
  const resolveStatic = opts.resolveStatic ?? resolveStaticFile

  return function handle(req, res) {
    const method = (req.method ?? 'GET').toUpperCase()
    const rawUrl = req.url ?? '/'
    const queryAt = rawUrl.indexOf('?')
    const rawPath = queryAt < 0 ? rawUrl : rawUrl.slice(0, queryAt)

    let pathname
    try {
      pathname = decodeURIComponent(rawPath)
    } catch {
      sendError(res, 400, '路径编码非法')
      return
    }

    // Decide first whether this path belongs to the API at all; that keeps a stray
    // "/api/unknown" from silently falling through to the SPA and returning HTML to fetch().
    const known = mapRequest(method, pathname, undefined)
    const isApiPath = known !== null || pathname.startsWith('/api/')

    if (isApiPath) {
      const wantsBody = method === 'POST'
      const bodyPromise = wantsBody ? readJsonBody(req) : Promise.resolve(undefined)

      bodyPromise
        .then(async (body) => {
          const mapped = mapRequest(method, pathname, body)
          if (mapped === null) {
            sendError(res, 404, `no such endpoint: ${pathname}`)
            return
          }
          if ('error' in mapped) {
            sendError(res, mapped.status, mapped.error)
            return
          }
          if (mapped.rpc === '__local_user') {
            sendJson(res, 200, LOCAL_USER)
            return
          }
          try {
            const result = await opts.client.request(mapped.rpc, mapped.params)
            sendJson(res, mapped.status, result)
          } catch (e) {
            const status = statusForError(e)
            log(`${method} ${pathname} -> ${status}: ${e.message}`)
            sendError(res, status, e.message)
          }
        })
        .catch((e) => {
          sendError(res, statusForError(e), e.message)
        })
      return
    }

    if (method !== 'GET' && method !== 'HEAD') {
      sendError(res, 405, `method ${method} not allowed`)
      return
    }

    const asset = resolveStatic(pathname, opts.distDir)
    if (asset === null) {
      // Either the renderer was never built or the path escaped the root - both are 404 here,
      // and the console explains which (the bridge logs the reason on startup).
      sendError(res, 404, `not found: ${pathname}`)
      return
    }

    /** @type {import('node:fs').Stats} */
    let stats
    try {
      stats = statSync(asset.filePath)
    } catch {
      sendError(res, 404, `not found: ${pathname}`)
      return
    }
    res.writeHead(200, {
      ...COMMON_HEADERS,
      'Content-Type': asset.mimeType,
      'Content-Length': String(stats.size),
    })
    if (method === 'HEAD') {
      res.end()
      return
    }
    const stream = createReadStream(asset.filePath)
    stream.on('error', () => res.destroy())
    stream.pipe(res)
  }
}

/**
 * Create (but do not start) the bridge HTTP server.
 *
 * @param {Parameters<typeof createBridgeHandler>[0]} opts
 * @returns {import('node:http').Server}
 */
export function createBridgeServer(opts) {
  const handler = createBridgeHandler(opts)
  return createServer((req, res) => {
    try {
      handler(req, res)
    } catch (e) {
      sendError(res, 500, `bridge internal error: ${e.message}`)
    }
  })
}
