// 本地调试桥的单测（scripts/local-bridge-lib.mjs，由 scripts/start-local.ps1 与 scripts/local-bridge.mjs 使用）。
//
// 桥本身属于"桌面版无端口链路"的一部分（docs/desktop.md T9）：
// 浏览器 → HTTP → 桥 → Go --stdio（JSON-RPC）→ 引擎。它唯一的安全面是
// "能读到磁盘上的哪些文件"与"把哪些请求转发给后端"，所以这两件事都有专门用例。
//
// 被测模块是零依赖的 .mjs：从 scripts/ 直接 import，避免测试与实现两份。
import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'

import {
  BridgeRpcError,
  DEFAULT_CALL_TIMEOUT_MS,
  INVALID_PARAMS,
  JsonLinesClient,
  LOCAL_USER,
  METHOD_NOT_FOUND,
  createBridgeServer,
  mapRequest,
  mimeFor,
  resolveStaticFile,
  statusForError,
} from '../../../scripts/local-bridge-lib.mjs'

// ---------------------------------------------------------------- 路由映射

describe('mapRequest（REST ↔ RPC 映射）', () => {
  it('把健康检查与能力端点映射到 ping / meta', () => {
    expect(mapRequest('GET', '/health')).toEqual({ rpc: 'ping', status: 200 })
    expect(mapRequest('GET', '/api/meta')).toEqual({ rpc: 'meta', status: 200 })
  })

  it('任务端点映射到 tasks.*，创建用 202（与 HTTP 语义一致）', () => {
    expect(mapRequest('GET', '/api/tasks')).toEqual({ rpc: 'tasks.list', status: 200 })
    expect(mapRequest('POST', '/api/tasks', { kind: 'simulate' })).toEqual({
      rpc: 'tasks.create',
      params: { kind: 'simulate' },
      status: 202,
    })
    expect(mapRequest('GET', '/api/tasks/abc')).toEqual({
      rpc: 'tasks.get',
      params: { id: 'abc' },
      status: 200,
    })
    expect(mapRequest('DELETE', '/api/tasks/abc')).toEqual({
      rpc: 'tasks.delete',
      params: { id: 'abc' },
      status: 200,
    })
  })

  it('创建任务缺 body 时退化为空对象（而不是 undefined，后端会判非法）', () => {
    expect(mapRequest('POST', '/api/tasks', undefined)).toEqual({
      rpc: 'tasks.create',
      params: {},
      status: 202,
    })
  })

  it('单用户模式下认证端点回 401（桥跑的是 OMO_AUTH_MODE=none）', () => {
    expect(mapRequest('POST', '/api/auth/login')).toEqual({
      error: 'auth disabled in single-user (local) mode',
      status: 401,
    })
    expect(mapRequest('POST', '/api/auth/register')).toMatchObject({ status: 401 })
    // /api/auth/me 仍可用：由桥本地回答 local 用户，不打扰后端
    expect(mapRequest('GET', '/api/auth/me')).toEqual({ rpc: '__local_user', status: 200 })
  })

  it('任务端点不支持的方法返回 405 而不是静默 404', () => {
    expect(mapRequest('PUT', '/api/tasks/abc')).toMatchObject({ status: 405 })
  })

  it('非 API 路径返回 null（交给静态托管）', () => {
    expect(mapRequest('GET', '/')).toBeNull()
    expect(mapRequest('GET', '/design')).toBeNull()
    expect(mapRequest('GET', '/assets/index-abc.js')).toBeNull()
  })

  it('LOCAL_USER 与后端 single-user 约定一致', () => {
    expect(LOCAL_USER).toEqual({ id: 'local', username: 'local' })
  })
})

// ---------------------------------------------------------------- 静态托管与穿越防护

describe('resolveStaticFile（渲染产物托管）', () => {
  /** 依赖注入：只把 /index.html 与 /assets/app.js 当作存在。 */
  const deps = {
    platform: 'linux',
    exists: (p: string) =>
      p.endsWith('/index.html') || p.endsWith('/assets/app.js'),
    isFile: () => true,
  }
  const root = '/srv/dist'

  it('命中真实文件时返回文件与 MIME', () => {
    const asset = resolveStaticFile('/assets/app.js', root, deps)
    expect(asset).toMatchObject({
      filePath: '/srv/dist/assets/app.js',
      mimeType: 'text/javascript; charset=utf-8',
      spaFallback: false,
    })
  })

  it('未知路径回退 index.html（SPA 深链）', () => {
    const asset = resolveStaticFile('/optimize', root, deps)
    expect(asset).toMatchObject({ filePath: '/srv/dist/index.html', spaFallback: true })
  })

  // 这两个平台分别代表"分隔符是 /"与"分隔符是 \\"。之前那组穿越用例只跑 linux，
  // 于是 Windows 形态的写法全靠一条"POSIX 下拒反斜杠"的特判挡着，从未在 win32 语义下验过
  // —— 这就是"穿越被 SPA 回退掩盖"当初没被测出来的原因。两条路径都要跑同一张表。
  const PLATFORMS = [
    { platform: 'linux', root: '/srv/dist' },
    { platform: 'win32', root: 'C:\\app\\resources\\dist' },
  ] as const

  describe.each(PLATFORMS)('跨平台一致（$platform）', ({ platform, root: platformRoot }) => {
    const platformDeps = {
      platform,
      exists: (p: string) =>
        p.endsWith('/index.html') || p.endsWith('\\index.html') || p.endsWith('/assets/app.js'),
      isFile: () => true,
    }

    it('穿越意图一律 null，绝不落进 SPA 回退', () => {
      // 每条都含点段（"." 或 ".."）：不管最终是否恰好仍在 root 内，都必须被拒。
      // 用 SPA 回退"接住"它们等于用 200 + index.html 回应一次穿越尝试。
      for (const attempt of [
        '/../../etc/passwd',
        '/..%2f..%2fetc/passwd',
        '/%2e%2e%2f%2e%2e%2fetc/passwd',
        '/assets/../../../../etc/passwd',
        '/..%5c..%5cwindows%5cwin.ini',
        '/%2e%2e%5c%2e%2e%5cwindows%5cwin.ini',
        '/assets\\..\\..\\..\\etc\\passwd',
        '/%2e%2e',
        '/..',
        // 这些在旧实现里会被 resolve 折叠回 root 内，从而"成功"回退 index.html
        '/a/../design',
        '/a/./optimize',
        '/a/..',
        '/assets/../index.html',
      ]) {
        expect(resolveStaticFile(attempt, platformRoot, platformDeps), attempt).toBeNull()
      }
    })

    it('含点的文件名不被误伤（只有点段才拒，点号是普通字符）', () => {
      // 点号不是点段：v0.1.0.json / app.min.js 必须照常解析（不存在则正常回退，而不是被拒）
      for (const ok of ['/v0.1.0.json', '/assets/app.min.js', '/a.b/c.d']) {
        const asset = resolveStaticFile(ok, platformRoot, platformDeps)
        expect(asset, ok).not.toBeNull()
        expect(asset!.spaFallback, ok).toBe(true) // 测试环境里这些文件不存在，回退是正确行为
      }
    })

    it('反斜杠只在 win32 上当分隔符，不会因此被误判为穿越或拒绝', () => {
      // POSIX 上 "a\b" 是对等的一个文件名；win32 上是两层。两者都不是点段，都不该返回 null。
      const result = resolveStaticFile('/a%5cb', platformRoot, platformDeps)
      expect(result, '\\ 不应导致 null').not.toBeNull()
      expect(result!.spaFallback).toBe(true)
    })
  })

  it('Windows 盘符绝对路径被拦（段级检查看不到，靠越界兜底）', () => {
    // 不以分隔符打头，段级检查无从发现；解析到 C:\Windows 后必须被"必须在 root 内"拦住。
    expect(
      resolveStaticFile('/C:%5cWindows%5cwin.ini', 'C:\\app\\resources\\dist', {
        platform: 'win32',
        exists: () => true,
        isFile: () => true,
      }),
    ).toBeNull()
  })

  it('挡住非法编码与 NUL 字节（与平台无关）', () => {
    for (const attempt of ['/assets/app.js%00.png', '/%ZZ']) {
      expect(resolveStaticFile(attempt, root, deps), attempt).toBeNull()
    }
  })

  it('未构建（缺 index.html）时返回 null，让调用方回 404', () => {
    expect(resolveStaticFile('/design', root, { ...deps, exists: () => false })).toBeNull()
  })

  it('mimeFor 未知扩展名回退 octet-stream', () => {
    expect(mimeFor('/a/b.bin')).toBe('application/octet-stream')
    expect(mimeFor('/a/noext')).toBe('application/octet-stream')
    expect(mimeFor('/a/b.HTML')).toBe('text/html; charset=utf-8')
  })
})

// ---------------------------------------------------------------- JSON-Lines 客户端

describe('JsonLinesClient', () => {
  /** 收集写出的行；写行为可注入以便断言请求报文。 */
  function makeClient(opts: Record<string, unknown> = {}) {
    const written: string[] = []
    const errors: string[] = []
    const client = new JsonLinesClient(
      { write: (line: string) => void written.push(line) },
      { onProtocolError: (m: string) => void errors.push(m), ...opts },
    )
    return { client, written, errors }
  }

  it('发出 JSON-RPC 2.0 行并按 id 关联结果', async () => {
    const { client, written } = makeClient()
    const promise = client.request('ping', {})
    const sent = JSON.parse(written[0] as string)
    expect(sent).toMatchObject({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} })

    client.acceptLine(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { status: 'ok' } }))
    await expect(promise).resolves.toEqual({ status: 'ok' })
    expect(client.pendingCount).toBe(0)
  })

  it('乱序响应也能正确关联（id 而非顺序）', async () => {
    const { client } = makeClient()
    const first = client.request('tasks.list', {})
    const second = client.request('meta', {})

    client.acceptLine(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { auth_mode: 'none' } }))
    client.acceptLine(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tasks: [] } }))

    await expect(second).resolves.toEqual({ auth_mode: 'none' })
    await expect(first).resolves.toEqual({ tasks: [] })
  })

  it('按行分帧：半行要先缓冲（跨 chunk），CRLF 也要认', async () => {
    const { client } = makeClient()
    const promise = client.request('ping', {})
    const line = JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'ok' })

    client.acceptChunk(line.slice(0, 10))
    expect(client.pendingCount).toBe(1) // 还没收到完整行
    client.acceptChunk(`${line.slice(10)}\r\n`)

    await expect(promise).resolves.toBe('ok')
  })

  it('把 RPC error 转成带 code 的 BridgeRpcError（HTTP 语义码要保住）', async () => {
    const { client } = makeClient()
    const promise = client.request('tasks.get', { id: 'nope' })
    client.acceptLine(
      JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: 404, message: 'task not found' } }),
    )

    await expect(promise).rejects.toBeInstanceOf(BridgeRpcError)
    await expect(promise).rejects.toMatchObject({ code: 404, message: 'task not found' })
  })

  it('非法行/未知 id 只报协议错误，不影响在途请求（stdout 污染不能致命）', async () => {
    const { client, errors } = makeClient()
    const promise = client.request('ping', {})

    client.acceptLine('Warning: something printed to stdout')
    client.acceptLine(JSON.stringify({ jsonrpc: '2.0', id: 999, result: 'stray' }))
    client.acceptLine('[1,2,3]')
    expect(errors.length).toBe(3)
    expect(client.pendingCount).toBe(1)

    client.acceptLine(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'ok' }))
    await expect(promise).resolves.toBe('ok')
  })

  it('忽略通知（无 id），不当成响应', async () => {
    const { client, errors } = makeClient()
    client.acceptLine(JSON.stringify({ jsonrpc: '2.0', method: 'progress', params: { done: 1 } }))
    expect(errors).toEqual([])
    expect(client.pendingCount).toBe(0)
  })

  it('failAll 让在途请求立刻失败（后端退出时不干等超时）', async () => {
    const { client } = makeClient()
    const promise = client.request('optimize', {})
    client.failAll('backend exited')

    await expect(promise).rejects.toMatchObject({ message: 'backend exited' })
    expect(client.pendingCount).toBe(0)
  })

  it('超时可覆盖，且默认超时足够跑完一次反推扫描', async () => {
    const { client } = makeClient({ timeoutMs: 20 })
    await expect(client.request('optimize', {})).rejects.toMatchObject({
      code: 0,
      message: expect.stringContaining('超时'),
    })
    expect(DEFAULT_CALL_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000)
  })

  it('关闭后拒绝新调用，写入失败也会立即失败而不是悬挂', async () => {
    const { client } = makeClient()
    client.shutdown()
    await expect(client.request('ping', {})).rejects.toMatchObject({ code: 0 })

    const failing = new JsonLinesClient(
      {
        write: () => {
          throw new Error('stdin closed')
        },
      },
      {},
    )
    await expect(failing.request('ping', {})).rejects.toMatchObject({
      message: expect.stringContaining('写入 ping 请求失败'),
    })
    expect(failing.pendingCount).toBe(0)
  })
})

describe('statusForError', () => {
  it('保留 HTTP 语义码，协议码折算，传输失败算 502', () => {
    expect(statusForError({ code: 404 })).toBe(404)
    expect(statusForError({ code: 401 })).toBe(401)
    expect(statusForError({ code: 422 })).toBe(422)
    expect(statusForError({ code: INVALID_PARAMS })).toBe(400)
    expect(statusForError({ code: METHOD_NOT_FOUND })).toBe(501)
    expect(statusForError({ code: 0 })).toBe(502)
    expect(statusForError(undefined)).toBe(502)
  })
})

// ---------------------------------------------------------------- 端到端（真 HTTP server）

describe('createBridgeServer（真 HTTP 往返）', () => {
  /** 起一个用假 client 的桥，返回基址与关闭函数。 */
  async function startBridge(options: {
    calls?: Array<{ method: string; params: unknown }>
    respond?: (method: string) => unknown
    distDir?: string
  }) {
    const calls = options.calls ?? []
    const client = {
      request: async (method: string, params?: unknown) => {
        calls.push({ method, params })
        if (options.respond) {
          const out = options.respond(method)
          if (out instanceof Error) throw out
          return out
        }
        return { method }
      },
    }
    const server = createBridgeServer({
      client,
      distDir: options.distDir ?? 'D:/nonexistent-dist-for-routing-tests',
      resolveStatic: () => null, // 静态部分由上面的单测覆盖，这里只验 API 路径
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    return {
      calls,
      base: `http://127.0.0.1:${port}`,
      close: () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections?.()
          server.close(() => resolve())
        }),
    }
  }

  let closer: (() => Promise<void>) | null = null
  afterEach(async () => {
    if (closer) {
      await closer()
      closer = null
    }
  })

  it('GET 转发到 RPC 并原样回传结果', async () => {
    const bridge = await startBridge({ respond: () => ({ auth_mode: 'none' }) })
    closer = bridge.close

    const resp = await fetch(`${bridge.base}/api/meta`)
    expect(resp.status).toBe(200)
    expect(await resp.json()).toEqual({ auth_mode: 'none' })
    expect(bridge.calls).toEqual([{ method: 'meta', params: undefined }])
  })

  it('POST 先解析 body 再作为 params 转发，返回 202', async () => {
    const bridge = await startBridge({ respond: () => ({ id: 't1', kind: 'simulate' }) })
    closer = bridge.close

    const resp = await fetch(`${bridge.base}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'simulate', layers: [{ material: 'Ag', thickness_nm: 10 }] }),
    })
    expect(resp.status).toBe(202)
    expect(bridge.calls[0]).toMatchObject({
      method: 'tasks.create',
      params: { kind: 'simulate' },
    })
  })

  it('DELETE 把路径参数当 params 传给 tasks.delete', async () => {
    const bridge = await startBridge({ respond: () => ({ id: 't1', deleted: true }) })
    closer = bridge.close

    const resp = await fetch(`${bridge.base}/api/tasks/t1`, { method: 'DELETE' })
    expect(await resp.json()).toEqual({ id: 't1', deleted: true })
    expect(bridge.calls[0]).toEqual({ method: 'tasks.delete', params: { id: 't1' } })
  })

  it('RPC 错误码原样变成 HTTP 状态码（前端的 401/404 分支依赖它）', async () => {
    const bridge = await startBridge({
      respond: () => new BridgeRpcError(404, 'task not found'),
    })
    closer = bridge.close

    const resp = await fetch(`${bridge.base}/api/tasks/nope`)
    expect(resp.status).toBe(404)
    expect(await resp.json()).toEqual({ error: 'task not found' })
  })

  it('后端传输失败算 502（而不是假装 200）', async () => {
    const bridge = await startBridge({ respond: () => new BridgeRpcError(0, 'backend exited') })
    closer = bridge.close

    expect((await fetch(`${bridge.base}/api/tasks`)).status).toBe(502)
  })

  it('未知 /api 路径回 404 JSON，不会掉进 SPA 回退', async () => {
    const bridge = await startBridge({})
    closer = bridge.close

    const resp = await fetch(`${bridge.base}/api/no/such/endpoint`)
    expect(resp.status).toBe(404)
    expect(await resp.json()).toMatchObject({ error: expect.stringContaining('no such endpoint') })
    expect(bridge.calls).toEqual([])
  })

  it('非法 JSON body 回 400，且不会把坏请求发给后端', async () => {
    const bridge = await startBridge({})
    closer = bridge.close

    const resp = await fetch(`${bridge.base}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    })
    expect(resp.status).toBe(400)
    expect(bridge.calls).toEqual([])
  })

  it('认证端点在单用户模式下回 401（与 HTTP 形态一致）', async () => {
    const bridge = await startBridge({})
    closer = bridge.close

    expect((await fetch(`${bridge.base}/api/auth/login`, { method: 'POST' })).status).toBe(401)
    expect(bridge.calls).toEqual([])
  })

  it('/api/auth/me 由桥本地回答 local 用户', async () => {
    const bridge = await startBridge({})
    closer = bridge.close

    const resp = await fetch(`${bridge.base}/api/auth/me`)
    expect(await resp.json()).toEqual({ id: 'local', username: 'local' })
    expect(bridge.calls).toEqual([])
  })

  it('静态 404 是 JSON（便于浏览器/curl 看清原因）', async () => {
    const bridge = await startBridge({})
    closer = bridge.close

    const resp = await fetch(`${bridge.base}/`)
    expect(resp.status).toBe(404)
    expect(resp.headers.get('content-type')).toContain('application/json')
  })
})

// 用真 http 模块也只是为了确保 createServer 的用法没写错（上方用例走的是真网络）。
describe('createServer 可用', () => {
  it('createServer 返回可监听的 server', () => {
    const server = createServer()
    expect(typeof server.listen).toBe('function')
    server.close()
  })
})
