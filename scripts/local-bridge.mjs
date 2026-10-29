#!/usr/bin/env node
// OMOPredict local debug bridge - CLI entry point (docs/desktop.md T9, scripts/start-local.ps1).
//
// Spawns the Go middleware in `--stdio` mode (single-user, engine over stdio) and exposes it as a
// plain HTTP origin on 127.0.0.1, also serving frontend/dist. Result: the full no-port process
// tree can be driven from an ordinary browser, with no Electron and no Vite in the loop.
//
//   browser --HTTP--> this bridge --stdio JSON-RPC--> Go --stdio JSON-RPC--> Python engine
//
// Logs go to stderr so stdout stays free (the same discipline the whole stdio design follows).
//
// NOTE: dependency-free by design; see scripts/local-bridge-lib.mjs for the testable core.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { platform } from 'node:process'
import { fileURLToPath } from 'node:url'

import { JsonLinesClient, createBridgeServer, resolveStaticFile } from './local-bridge-lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')

/** Parse `--flag value` / `--flag=value` / `--bool` arguments. */
function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) {
      out._.push(token)
      continue
    }
    const eq = token.indexOf('=')
    if (eq > 0) {
      out[token.slice(2, eq)] = token.slice(eq + 1)
      continue
    }
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      out[key] = true
    } else {
      out[key] = next
      i += 1
    }
  }
  return out
}

const USAGE = `OMOPredict local debug bridge (HTTP -> Go --stdio -> engine)

Usage: node scripts/local-bridge.mjs --backend <omopredict(.exe)> --dist <frontend/dist> [options]

Options:
  --backend <path>    Go backend executable (required; or env OMO_BACKEND_EXE)
  --dist <dir>        renderer dist directory (required; or env OMO_DIST_DIR)
  --port <n>          HTTP port (default 8787; 0 = pick a free one and print it)
  --host <addr>       bind address (default 127.0.0.1; this is a debug tool)
  --data-dir <dir>    where the SQLite file lives (required; SQLite will not create it)
  --cwd <dir>         working directory for the backend (default: repo root)
  --python <exe>      interpreter for the engine (sets OMO_ENGINE_CMD to "<exe> -m omo.rpc")
  --engine-cmd <cmd>  explicit OMO_ENGINE_CMD (takes precedence over --python)
  --timeout <ms>      per-RPC timeout (default 120000)
  --open              open a browser once listening
  -h, --help          this text

Values that may contain spaces or quotes (paths, the engine command) can also be supplied via the
environment - OMO_BACKEND_EXE, OMO_DIST_DIR, OMO_ENGINE_CMD - which is how start-local.ps1 passes
them: Start-Process re-parses its argument list and eats the inner quotes of such a value.
`

function fail(message) {
  process.stderr.write(`[bridge] ${message}\n`)
  process.exit(1)
}

/** Best-effort browser launch; failure is not fatal (the URL is printed anyway). */
function openBrowser(url) {
  const command =
    platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]]
  try {
    const opener = spawn(command[0], command[1], { stdio: 'ignore', detached: true })
    opener.on('error', () => {})
    opener.unref()
  } catch {
    // ignore: the user can click the URL above
  }
}

const args = parseArgs(process.argv.slice(2))
if (args.help || args.h) {
  process.stdout.write(USAGE)
  process.exit(0)
}

// Values that may contain spaces or quotes (paths, the engine command) can be supplied through
// the environment instead of argv: Start-Process re-parses its -ArgumentList string, which eats
// the inner quotes of such a value. The flags below still win, so both ways remain usable.
const fromEnv = (key) => {
  const value = process.env[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : ''
}

const backendArg = typeof args.backend === 'string' ? args.backend : fromEnv('OMO_BACKEND_EXE')
const distArg = typeof args.dist === 'string' ? args.dist : fromEnv('OMO_DIST_DIR')
const backend = backendArg === '' ? '' : resolve(backendArg)
const distDir = distArg === '' ? '' : resolve(distArg)
const dataDir = typeof args['data-dir'] === 'string' ? resolve(args['data-dir']) : ''
const host = typeof args.host === 'string' ? args.host : '127.0.0.1'
const port = args.port === undefined ? 8787 : Number(args.port)
const timeoutMs = args.timeout === undefined ? undefined : Number(args.timeout)
const backendCwd = typeof args.cwd === 'string' ? resolve(args.cwd) : REPO_ROOT

if (backend === '') fail('missing --backend (or OMO_BACKEND_EXE; see --help)')
if (distDir === '') fail('missing --dist (see --help)')
if (dataDir === '') fail('missing --data-dir (see --help)')
if (!existsSync(backend)) fail(`backend executable not found: ${backend}`)
if (!existsSync(dataDir)) fail(`data directory does not exist: ${dataDir} (create it first)`)
if (!existsSync(join(distDir, 'index.html'))) {
  fail(`renderer not built: ${join(distDir, 'index.html')} missing (run "cd frontend && pnpm build")`)
}
if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`bad --port: ${String(args.port)}`)

// ---- child environment -------------------------------------------------------
// OMO_AUTH_MODE=none is what makes the browser experience login-free; it is safe here because the
// bridge is the only client and it binds loopback.
const childEnv = {
  ...process.env,
  OMO_AUTH_MODE: 'none',
  OMO_ENGINE_TRANSPORT: 'stdio',
  OMO_DB_DRIVER: 'sqlite',
  OMO_DB_DSN: join(dataDir, 'start-local.db'),
  // The authoritative setting is where Go actually spawns the engine
  // (server/internal/task/engine_stdio.go: engineEncodingEnv) - that is the only environment
  // boundary that reaches the grandchild. Setting it here as well is belt and braces: this
  // process is Go's parent, and without it Python on Windows encodes stderr with the ANSI code
  // page, so engine lines land in the log as mojibake while the Go lines next to them are fine
  // (HANDOVER 6.37).
  PYTHONUTF8: '1',
  PYTHONIOENCODING: 'utf-8',
}

const explicitEngineCmd = typeof args['engine-cmd'] === 'string' ? args['engine-cmd'] : ''
const pythonExe = typeof args.python === 'string' ? args.python : ''
const inheritedEngineCmd = fromEnv('OMO_ENGINE_CMD')
if (explicitEngineCmd !== '') {
  childEnv.OMO_ENGINE_CMD = explicitEngineCmd
} else if (pythonExe !== '') {
  // Quoted: the Go resolver splits on whitespace and honours double quotes, so a Python living
  // under "C:\Program Files\..." stays one argument.
  childEnv.OMO_ENGINE_CMD = `"${resolve(pythonExe)}" -m omo.rpc`
} else if (inheritedEngineCmd !== '') {
  // Keep the caller's value (start-local passes it this way to dodge argv re-quoting);
  // childEnv already inherited it, this just makes the intent explicit.
  childEnv.OMO_ENGINE_CMD = inheritedEngineCmd
}

process.stderr.write(`[bridge] backend : ${backend} --stdio\n`)
process.stderr.write(`[bridge] cwd     : ${backendCwd}\n`)
process.stderr.write(`[bridge] renderer: ${distDir}\n`)
process.stderr.write(`[bridge] data    : ${childEnv.OMO_DB_DSN}\n`)
process.stderr.write(
  `[bridge] engine  : ${childEnv.OMO_ENGINE_CMD ?? '(Go will discover it: sidecar -> uv -> python)'}\n`,
)

const child = spawn(backend, ['--stdio'], {
  cwd: backendCwd,
  env: childEnv,
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
})

// Backend logs belong in the bridge's stderr (Go already writes them there on purpose).
child.stderr.setEncoding('utf8')
let stderrTail = ''
child.stderr.on('data', (chunk) => {
  process.stderr.write(chunk)
  stderrTail = (stderrTail + chunk).slice(-4000)
})

let exiting = false

const client = new JsonLinesClient(
  {
    write: (line) =>
      new Promise((resolveWrite, rejectWrite) => {
        if (!child.stdin.writable) {
          rejectWrite(new Error('backend stdin 不可写（进程可能已退出）'))
          return
        }
        child.stdin.write(line, (err) => (err ? rejectWrite(err) : resolveWrite()))
      }),
  },
  {
    timeoutMs,
    onProtocolError: (message) => process.stderr.write(`[bridge] protocol: ${message}\n`),
  },
)

child.stdout.on('data', (chunk) => client.acceptChunk(chunk))

child.on('error', (e) => {
  process.stderr.write(`[bridge] failed to start backend: ${e.message}\n`)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  client.failAll(`backend exited (code=${code ?? 'null'} signal=${signal ?? 'null'})`)
  if (exiting) return
  process.stderr.write(
    `[bridge] backend exited early (code=${code ?? 'null'} signal=${signal ?? 'null'}); last log lines:\n` +
      stderrTail.split(/\r?\n/).filter((l) => l.length > 0).slice(-10).join('\n') +
      '\n',
  )
  process.exit(1)
})

// ---- HTTP -------------------------------------------------------------------

const probe = resolveStaticFile('/index.html', distDir)
if (probe === null) fail(`renderer dist looks unusable: ${distDir}`)

const server = createBridgeServer({
  client,
  distDir,
  log: (message) => process.stderr.write(`[bridge] ${message}\n`),
})

server.on('error', (e) => {
  process.stderr.write(`[bridge] listen failed: ${e.message}\n`)
  process.exit(1)
})

server.listen(port, host, () => {
  const address = server.address()
  const actualPort = typeof address === 'object' && address !== null ? address.port : port
  const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${actualPort}/`
  process.stderr.write(`[bridge] listening on ${url}\n`)
  process.stderr.write('[bridge] Ctrl+C to stop (the backend is shut down with the bridge)\n')
  if (args.open === true) openBrowser(url)
})

// ---- shutdown ---------------------------------------------------------------

function shutdown(reason) {
  if (exiting) return
  exiting = true
  process.stderr.write(`[bridge] shutting down (${reason})\n`)
  client.shutdown()
  // Closing stdin is the graceful signal the Go side expects (it exits on EOF).
  try {
    child.stdin.end()
  } catch {
    // already gone
  }
  server.close(() => {})
  server.closeAllConnections?.()
  const killer = setTimeout(() => {
    process.stderr.write('[bridge] backend did not exit in 3s; killing it\n')
    child.kill()
    setTimeout(() => process.exit(0), 500).unref()
  }, 3000)
  killer.unref()
  child.once('exit', () => {
    clearTimeout(killer)
    process.exit(0)
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
