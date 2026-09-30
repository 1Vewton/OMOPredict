// IPC 契约单测：把「主进程处理器 → 信封 → preload 还原」串起来验证，
// 并断言抛出的错误形态正是前端 `toApiError` 支持的那种（frontend/src/api/transport.ts）。
import { describe, expect, it, vi } from 'vitest'
import {
  CHANNELS,
  INVALID_REQUEST,
  makeRpcHandler,
  toRpcError,
  unwrapEnvelope,
  type RpcEnvelope,
} from './channels'
import { createOmoApi, type IpcInvoker } from './preloadBridge'

/** 造一个"假 Host"：按方法返回结果或抛错。 */
function fakeHost(handlers: Record<string, (params?: unknown) => unknown>) {
  return async (method: string, params?: unknown): Promise<unknown> => {
    const handler = handlers[method]
    if (!handler) throw Object.assign(new Error(`方法不存在: ${method}`), { code: -32601 })
    return handler(params)
  }
}

/** 用假 Host 造一个完整的 IPC 调用链（主进程处理器 + preload 还原）。 */
function makeChain(handlers: Record<string, (params?: unknown) => unknown>) {
  const handle = makeRpcHandler(fakeHost(handlers))
  const calls: { channel: string; args: unknown[] }[] = []
  const ipc: IpcInvoker = {
    async invoke(channel, ...args) {
      calls.push({ channel, args })
      // 模拟 Electron 的跨进程边界：结构化克隆后只剩普通对象
      const envelope = await handle(args[0])
      return JSON.parse(JSON.stringify(envelope)) as RpcEnvelope
    },
  }
  return { api: createOmoApi(ipc), calls }
}

describe('主进程处理器 makeRpcHandler', () => {
  it('成功时包成 {ok:true,result}', async () => {
    const handle = makeRpcHandler(async () => ({ tasks: [] }))
    await expect(handle({ method: 'tasks.list' })).resolves.toEqual({
      ok: true,
      result: { tasks: [] },
    })
  })

  it('把 method 与 params 原样转给后端', async () => {
    const invoke = vi.fn(async () => 'ok')
    const handle = makeRpcHandler(invoke)
    await handle({ method: 'tasks.create', params: { kind: 'simulate' } })
    expect(invoke).toHaveBeenCalledWith('tasks.create', { kind: 'simulate' })
  })

  it('错误放进信封（code 保留 HTTP 语义），而不是 reject', async () => {
    const handle = makeRpcHandler(async () => {
      throw Object.assign(new Error('task not found'), { code: 404 })
    })
    await expect(handle({ method: 'tasks.get' })).resolves.toEqual({
      ok: false,
      error: { code: 404, message: 'task not found' },
    })
  })

  it('缺 method / 非法入参 → -32600', async () => {
    const handle = makeRpcHandler(async () => 'never')
    await expect(handle({})).resolves.toEqual({
      ok: false,
      error: { code: INVALID_REQUEST, message: '缺少 method' },
    })
    await expect(handle({ method: '   ' })).resolves.toMatchObject({ ok: false })
    await expect(handle(null)).resolves.toMatchObject({
      ok: false,
      error: { code: INVALID_REQUEST },
    })
  })

  it('普通 Error（无 code）→ code 0，消息保留', async () => {
    const handle = makeRpcHandler(async () => {
      throw new Error('后端未就绪（status=failed）')
    })
    await expect(handle({ method: 'tasks.list' })).resolves.toEqual({
      ok: false,
      error: { code: 0, message: '后端未就绪（status=failed）' },
    })
  })

  it('抛非 Error 值也能规整', async () => {
    const handle = makeRpcHandler(async () => {
      throw '字符串错误'
    })
    await expect(handle({ method: 'x' })).resolves.toEqual({
      ok: false,
      error: { code: 0, message: '字符串错误' },
    })
  })
})

describe('toRpcError', () => {
  it('保留非零 code', () => {
    expect(toRpcError(Object.assign(new Error('x'), { code: 401 }))).toEqual({
      code: 401,
      message: 'x',
    })
  })

  it('code 为 0 时仍用 Error 的 message', () => {
    expect(toRpcError(Object.assign(new Error('boom'), { code: 0 }))).toEqual({
      code: 0,
      message: 'boom',
    })
  })

  it('无 code 的 Error 与未知值都有兜底', () => {
    expect(toRpcError(new Error('plain'))).toEqual({ code: 0, message: 'plain' })
    expect(toRpcError(null)).toEqual({ code: 0, message: '调用失败' })
    expect(toRpcError(undefined)).toEqual({ code: 0, message: '调用失败' })
  })
})

describe('unwrapEnvelope（preload 侧还原）', () => {
  it('ok:true → 返回结果', () => {
    expect(unwrapEnvelope({ ok: true, result: { a: 1 } })).toEqual({ a: 1 })
    expect(unwrapEnvelope({ ok: true, result: null })).toBeNull()
  })

  it('ok:false → 抛 {code,message}（前端 toApiError 直接支持该形态）', () => {
    expect(() => unwrapEnvelope({ ok: false, error: { code: 422, message: '层厚非法' } })).toThrow()
    try {
      unwrapEnvelope({ ok: false, error: { code: 422, message: '层厚非法' } })
    } catch (e) {
      expect(e).toEqual({ code: 422, message: '层厚非法' })
      // 关键：不是 Error 实例也会被前端归一化（toApiError 接受 {code,message}）
      expect(e instanceof Error).toBe(false)
    }
  })

  it('畸形信封也给出可用错误', () => {
    try {
      unwrapEnvelope(undefined)
    } catch (e) {
      expect(e).toEqual({ code: 0, message: '调用失败' })
    }
    try {
      unwrapEnvelope({ ok: false, error: { message: '只有消息' } })
    } catch (e) {
      expect(e).toEqual({ code: 0, message: '只有消息' })
    }
  })
})

describe('createOmoApi（window.omo 的形态）', () => {
  it('只暴露白名单方法，不泄漏 ipcRenderer', () => {
    const api = createOmoApi({ invoke: async () => ({ ok: true, result: null }) })
    expect(Object.keys(api).sort()).toEqual(['openDataDir', 'openLogDir', 'rpc'])
    expect((api as unknown as Record<string, unknown>).invoke).toBeUndefined()
  })

  it('rpc 走 omo:rpc 通道并带上 {method, params}', async () => {
    const invoke = vi.fn(async (_channel: string) => ({ ok: true, result: { id: 't1' } }))
    const api = createOmoApi({ invoke })
    await expect(api.rpc('tasks.create', { kind: 'simulate' })).resolves.toEqual({ id: 't1' })
    expect(invoke).toHaveBeenCalledWith(CHANNELS.rpc, {
      method: 'tasks.create',
      params: { kind: 'simulate' },
    })
  })

  it('method 非法时本地就报错（不必往返一次）', async () => {
    const invoke = vi.fn(async (_channel: string) => undefined)
    const api = createOmoApi({ invoke })
    await expect(api.rpc('')).rejects.toEqual({ code: 0, message: 'method 需为非空字符串' })
    await expect(api.rpc(undefined as unknown as string)).rejects.toBeTruthy()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('openLogDir / openDataDir 打到各自通道', async () => {
    const invoke = vi.fn(async (_channel: string) => '')
    const api = createOmoApi({ invoke })
    await api.openLogDir()
    await api.openDataDir()
    expect(invoke.mock.calls.map((c) => c[0])).toEqual([CHANNELS.openLogDir, CHANNELS.openDataDir])
  })
})

describe('端到端：主进程处理器 + preload 还原（T5 契约闭环）', () => {
  it('成功路径：结果与 REST 响应体一致地到达渲染进程', async () => {
    const { api, calls } = makeChain({
      'tasks.list': () => ({ tasks: [{ id: 'a', status: 'succeeded' }] }),
    })
    await expect(api.rpc('tasks.list')).resolves.toEqual({
      tasks: [{ id: 'a', status: 'succeeded' }],
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].channel).toBe(CHANNELS.rpc)
  })

  it('失败路径：404 的 code 与消息原样穿过跨进程边界', async () => {
    const { api } = makeChain({
      'tasks.get': () => {
        throw Object.assign(new Error('task not found'), { code: 404 })
      },
    })
    await expect(api.rpc('tasks.get', { id: 'nope' })).rejects.toEqual({
      code: 404,
      message: 'task not found',
    })
  })

  it('后端崩溃：code 0 + 可读消息（前端按"连接失败"展示）', async () => {
    const { api } = makeChain({
      'tasks.create': () => {
        throw Object.assign(new Error('后端未就绪（status=failed）'), { code: 0 })
      },
    })
    await expect(api.rpc('tasks.create', {})).rejects.toEqual({
      code: 0,
      message: '后端未就绪（status=failed）',
    })
  })

  it('422 领域校验错误（引擎拒绝）也保持语义', async () => {
    const { api } = makeChain({
      'tasks.create': () => {
        throw Object.assign(new Error('第 1 层：材料未知'), { code: 422 })
      },
    })
    await expect(api.rpc('tasks.create', {})).rejects.toEqual({
      code: 422,
      message: '第 1 层：材料未知',
    })
  })

  it('未实现的通道方法（-32601）不吞掉，交给渲染进程显示', async () => {
    const { api } = makeChain({})
    await expect(api.rpc('nope')).rejects.toMatchObject({ code: -32601 })
  })
})
