// 传输层单测（T9 / docs/desktop.md §7）：
//   1. 传输选择（window.omo 检测 + 覆盖）；
//   2. HTTP 方法→端点映射（含路径参数与是否带 body）；
//   3. IPC 错误归一化（三种错误形态 → ApiError）；
//   4. **同一套用例经两种传输**的载荷/结果一致性（§7 要求的前端部分）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setToken } from './token'
import {
  ApiError,
  activeTransport,
  httpTransport,
  ipcTransport,
  setTransport,
  toApiError,
  type RpcMethod,
  type RpcParams,
} from './transport'

interface FetchCall {
  url: string
  init: RequestInit
}

/** 用假的 fetch 捕获调用；返回捕获数组。 */
function stubFetch(status = 200, body: unknown = { ok: true }): FetchCall[] {
  const calls: FetchCall[] = []
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fn)
  return calls
}

/** 安装一个假的桌面桥（window.omo）。 */
function stubBridge(impl?: (method: string, params?: unknown) => Promise<unknown>) {
  const calls: { method: string; params: unknown }[] = []
  const rpc = vi.fn(async (method: string, params?: unknown) => {
    calls.push({ method, params })
    return impl ? await impl(method, params) : { ok: true }
  })
  ;(window as unknown as { omo?: unknown }).omo = { rpc }
  return calls
}

function clearBridge(): void {
  delete (window as unknown as { omo?: unknown }).omo
}

afterEach(() => {
  clearBridge()
  setTransport(null)
  setToken(null)
})

// ---------------------------------------------------------------- 传输选择

describe('activeTransport 传输选择', () => {
  it('无 window.omo 时使用 HTTP（Web/开发形态）', () => {
    expect(activeTransport().name).toBe('http')
  })

  it('存在 window.omo.rpc 时使用 IPC（桌面形态）', () => {
    stubBridge()
    expect(activeTransport().name).toBe('ipc')
  })

  it('window.omo 存在但 rpc 不是函数时回落 HTTP', () => {
    ;(window as unknown as { omo?: unknown }).omo = { rpc: 'not-a-function' }
    expect(activeTransport().name).toBe('http')
  })

  it('setTransport 覆盖优先于自动检测，传 null 恢复', () => {
    stubBridge()
    setTransport(httpTransport)
    expect(activeTransport().name).toBe('http')
    setTransport(null)
    expect(activeTransport().name).toBe('ipc')
  })
})

// ---------------------------------------------------------------- HTTP 映射

describe('httpTransport 方法→端点映射', () => {
  beforeEach(() => setToken(null))

  const cases: {
    method: RpcMethod
    params?: RpcParams
    verb: string
    url: string
    body?: unknown
  }[] = [
    { method: 'ping', verb: 'GET', url: '/health' },
    { method: 'meta', verb: 'GET', url: '/api/meta' },
    { method: 'tasks.list', verb: 'GET', url: '/api/tasks' },
    { method: 'tasks.get', params: { id: 'abc123' }, verb: 'GET', url: '/api/tasks/abc123' },
    { method: 'tasks.delete', params: { id: 'abc123' }, verb: 'DELETE', url: '/api/tasks/abc123' },
    {
      method: 'tasks.create',
      params: { kind: 'simulate', layers: [{ material: 'Ag', thickness_nm: 10 }] },
      verb: 'POST',
      url: '/api/tasks',
      body: { kind: 'simulate', layers: [{ material: 'Ag', thickness_nm: 10 }] },
    },
    {
      method: 'auth.login',
      params: { username: 'alice', password: 'secret12' },
      verb: 'POST',
      url: '/api/auth/login',
      body: { username: 'alice', password: 'secret12' },
    },
    { method: 'auth.me', verb: 'GET', url: '/api/auth/me' },
  ]

  for (const c of cases) {
    it(`${c.method} → ${c.verb} ${c.url}`, async () => {
      const calls = stubFetch()
      await httpTransport.invoke(c.method, c.params)
      expect(calls).toHaveLength(1)
      expect(calls[0].url).toBe(c.url)
      expect(calls[0].init.method).toBe(c.verb)
      // 带 body 的方法发送 params；路径参数方法不得发送 body
      if (c.body === undefined) {
        expect(calls[0].init.body).toBeUndefined()
      } else {
        expect(JSON.parse(String(calls[0].init.body))).toEqual(c.body)
      }
    })
  }

  it('有 token 时注入 Authorization 头，无 token 时不注入', async () => {
    const calls = stubFetch()
    await httpTransport.invoke('tasks.list')
    expect(calls[0].init.headers).not.toHaveProperty('Authorization')

    setToken('jwt-token')
    await httpTransport.invoke('tasks.list')
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-token')
  })

  it('缺少路径参数时报 ApiError，且不发请求', async () => {
    const calls = stubFetch()
    await expect(httpTransport.invoke('tasks.get', {})).rejects.toBeInstanceOf(ApiError)
    expect(calls).toHaveLength(0)
  })

  it('路径参数做 URL 编码', async () => {
    const calls = stubFetch()
    await httpTransport.invoke('tasks.get', { id: 'a/b c' })
    expect(calls[0].url).toBe('/api/tasks/a%2Fb%20c')
  })

  it('非 2xx 时用响应体的 error/detail 作为消息', async () => {
    stubFetch(404, { error: 'task not found' })
    await expect(httpTransport.invoke('tasks.get', { id: 'x' })).rejects.toMatchObject({
      status: 404,
      message: 'task not found',
    })
  })

  it('连接失败 → status 0 与友好提示', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down')
      }),
    )
    await expect(httpTransport.invoke('meta')).rejects.toMatchObject({
      status: 0,
      message: '无法连接服务器，请确认服务已启动',
    })
  })
})

// ---------------------------------------------------------------- IPC 错误归一化

describe('toApiError 错误归一化', () => {
  it('原样返回 ApiError', () => {
    const e = new ApiError(422, 'x')
    expect(toApiError(e)).toBe(e)
  })

  it('{code, message} → ApiError', () => {
    expect(toApiError({ code: 404, message: 'task not found' })).toMatchObject({
      status: 404,
      message: 'task not found',
    })
  })

  it('JSON-RPC {error:{code,message}} → ApiError', () => {
    expect(toApiError({ error: { code: 422, message: '层厚非法' } })).toMatchObject({
      status: 422,
      message: '层厚非法',
    })
  })

  it('Error 且带 code → 用该 code', () => {
    const e = Object.assign(new Error('unauthorized'), { code: 401 })
    expect(toApiError(e)).toMatchObject({ status: 401, message: 'unauthorized' })
  })

  it('普通 Error → status 0', () => {
    expect(toApiError(new Error('boom'))).toMatchObject({ status: 0, message: 'boom' })
  })

  it('有 code 但无消息时给出兜底文案', () => {
    expect(toApiError({ code: 500 }).message).toContain('500')
  })

  it('未知值 → 兜底 ApiError', () => {
    expect(toApiError(null)).toMatchObject({ status: 0 })
  })
})

describe('ipcTransport', () => {
  it('window.omo 未注入时报错（不会静默回落到 HTTP）', async () => {
    await expect(ipcTransport.invoke('meta')).rejects.toMatchObject({
      status: 0,
    })
  })

  it('桥接层的 reject 被归一化为 ApiError', async () => {
    stubBridge(async () => {
      throw { error: { code: 404, message: 'task not found' } }
    })
    await expect(ipcTransport.invoke('tasks.get', { id: 'x' })).rejects.toMatchObject({
      status: 404,
      message: 'task not found',
    })
  })

  it('成功时原样返回结果', async () => {
    stubBridge(async () => ({ tasks: [] }))
    await expect(ipcTransport.invoke('tasks.list')).resolves.toEqual({ tasks: [] })
  })
})

// ---------------------------------------------------------------- 契约一致性（§7 必做）

describe('两种传输的载荷与结果一致性', () => {
  const cases: { method: RpcMethod; params?: RpcParams }[] = [
    { method: 'meta' },
    { method: 'ping' },
    { method: 'tasks.list' },
    { method: 'tasks.get', params: { id: 'abc123' } },
    { method: 'tasks.delete', params: { id: 'abc123' } },
    { method: 'tasks.create', params: { kind: 'optimize', optimize: { target: {} } } },
    { method: 'auth.login', params: { username: 'alice', password: 'secret12' } },
  ]

  for (const c of cases) {
    it(`${c.method}：IPC 收到的 (method, params) 与 HTTP 编码的一致`, async () => {
      const payload = { result: c.method }

      // HTTP 侧：捕获请求
      const calls = stubFetch(200, payload)
      const viaHttp = await httpTransport.invoke(c.method, c.params)
      const httpCall = calls[0]

      // IPC 侧：捕获调用
      const bridgeCalls = stubBridge(async () => payload)
      const viaIpc = await ipcTransport.invoke(c.method, c.params)

      // 1) 两种传输返回相同结果（上层无需分支）
      expect(viaIpc).toEqual(viaHttp)

      // 2) IPC 原样收到方法名与参数
      expect(bridgeCalls).toEqual([{ method: c.method, params: c.params }])

      // 3) HTTP 把同一份参数编码进 path 或 body，二者必居其一
      const hasBody = httpCall.init.body !== undefined
      const bodyCarriesParams = hasBody && JSON.parse(String(httpCall.init.body))
      if (c.params === undefined) {
        expect(hasBody).toBe(false)
        expect(httpCall.url).not.toContain('undefined')
      } else if (hasBody) {
        expect(bodyCarriesParams).toEqual(c.params)
      } else {
        // 无 body → 参数必须体现在路径里（如 /api/tasks/{id}）
        expect(httpCall.url).toContain(String(c.params.id))
      }
    })
  }
})
