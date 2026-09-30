import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CALL_TIMEOUT_MS,
  INVALID_REQUEST,
  METHOD_NOT_FOUND,
  RpcCallError,
  RpcClient,
  type RpcProtocolError,
} from './rpc'

/** 收集写出的行（假 io）。 */
function collectingIo() {
  const written: string[] = []
  return {
    written,
    io: {
      write: (line: string) => {
        written.push(line)
      },
    },
  }
}

/** 取出第 n 次调用写出的报文（解析为对象）。 */
function sent(written: string[], index = 0): { id: number; method: string; params: unknown } {
  return JSON.parse(written[index]) as { id: number; method: string; params: unknown }
}

describe('RpcClient', () => {
  it('默认超时常量与 Go 侧一致（60s）', () => {
    expect(DEFAULT_CALL_TIMEOUT_MS).toBe(60_000)
  })

  it('调用写出合法 JSON-RPC 2.0 行，并按 id 关联结果', async () => {
    const { written, io } = collectingIo()
    const client = new RpcClient(io)

    const p = client.call<{ tasks: unknown[] }>('tasks.list')
    expect(written).toHaveLength(1)
    const req = sent(written)
    expect(req.method).toBe('tasks.list')
    expect(req.params).toEqual({})
    expect(JSON.parse(written[0])).toMatchObject({ jsonrpc: '2.0' })
    expect(written[0].endsWith('\n')).toBe(true)

    client.acceptLine(`{"jsonrpc":"2.0","id":${req.id},"result":{"tasks":[]}}`)
    await expect(p).resolves.toEqual({ tasks: [] })
    expect(client.pendingCount).toBe(0)
  })

  it('参数原样透传（含嵌套对象）', async () => {
    const { written, io } = collectingIo()
    const client = new RpcClient(io)
    const params = { kind: 'simulate', layers: [{ material: 'Ag', thickness_nm: 10 }] }
    void client.call('tasks.create', params)
    expect(sent(written).params).toEqual(params)
  })

  it('乱序响应按 id 正确分发', async () => {
    const { written, io } = collectingIo()
    const client = new RpcClient(io)
    const p1 = client.call<string>('a')
    const p2 = client.call<string>('b')
    const id1 = sent(written, 0).id
    const id2 = sent(written, 1).id

    client.acceptLine(`{"jsonrpc":"2.0","id":${id2},"result":"second"}`)
    client.acceptLine(`{"jsonrpc":"2.0","id":${id1},"result":"first"}`)

    await expect(p2).resolves.toBe('second')
    await expect(p1).resolves.toBe('first')
  })

  it('error 报文转成 RpcCallError，并保留 HTTP 语义码与消息', async () => {
    const { written, io } = collectingIo()
    const client = new RpcClient(io)
    const p = client.call('boom')
    client.acceptLine(
      `{"jsonrpc":"2.0","id":${sent(written).id},"error":{"code":422,"message":"层厚非法"}}`,
    )
    await expect(p).rejects.toMatchObject({ code: 422, message: '层厚非法' })
    await expect(p).rejects.toBeInstanceOf(RpcCallError)
  })

  it('协议错误码（-32601 方法不存在）同样透传', async () => {
    const { written, io } = collectingIo()
    const client = new RpcClient(io)
    const p = client.call('nope')
    client.acceptLine(
      `{"jsonrpc":"2.0","id":${sent(written).id},"error":{"code":${METHOD_NOT_FOUND},"message":"方法不存在: nope"}}`,
    )
    await expect(p).rejects.toMatchObject({ code: METHOD_NOT_FOUND })
  })

  it('通知（无 id）交给 onNotification，不影响在途请求', async () => {
    const { written, io } = collectingIo()
    const notifications: { method: string; params: unknown }[] = []
    const client = new RpcClient(io, {
      onNotification: (method, params) => notifications.push({ method, params }),
    })
    const p = client.call('notify')
    client.acceptLine('{"jsonrpc":"2.0","method":"progress","params":{"done":1,"total":2}}')
    client.acceptLine(`{"jsonrpc":"2.0","id":${sent(written).id},"result":{"ok":true}}`)

    await expect(p).resolves.toEqual({ ok: true })
    expect(notifications).toEqual([{ method: 'progress', params: { done: 1, total: 2 } }])
  })

  it('非法 JSON 行只产生协议错误（stdout 被污染时不崩、不影响在途请求）', async () => {
    const { written, io } = collectingIo()
    const errors: RpcProtocolError[] = []
    const client = new RpcClient(io, { onProtocolError: (e) => errors.push(e) })
    const p = client.call('ping')

    client.acceptLine('这不是 JSON')
    client.acceptLine('')
    client.acceptLine(`{"jsonrpc":"2.0","id":${sent(written).id},"result":{"status":"ok"}}`)

    await expect(p).resolves.toEqual({ status: 'ok' })
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('非法 JSON')
  })

  it('未知 id 与非法报文只上报协议错误', () => {
    const { io } = collectingIo()
    const errors: RpcProtocolError[] = []
    const client = new RpcClient(io, { onProtocolError: (e) => errors.push(e) })

    client.acceptLine('{"jsonrpc":"2.0","id":999,"result":{}}')
    client.acceptLine('[1,2,3]')
    client.acceptLine('{"jsonrpc":"2.0","id":"abc","result":{}}')

    expect(errors.map((e) => e.message)).toEqual([
      '收到未知 id 的响应（id=999）',
      '报文不是 JSON 对象',
      '响应 id 非数值: abc',
    ])
  })

  it('超时抛 RpcCallError（code 0），并从在途表移除', async () => {
    const { io } = collectingIo()
    const client = new RpcClient(io, { timeoutMs: 20 })
    await expect(client.call('slow')).rejects.toMatchObject({ code: 0 })
    await expect(client.call('slow')).rejects.toThrow(/超时/)
    expect(client.pendingCount).toBe(0)
  })

  it('每次调用可覆盖超时（大规模反推需要更久）', async () => {
    const { written, io } = collectingIo()
    const client = new RpcClient(io, { timeoutMs: 10 })
    const p = client.call('optimize', {}, { timeoutMs: 200 })
    setTimeout(() => {
      client.acceptLine(`{"jsonrpc":"2.0","id":${sent(written).id},"result":{"n_scanned":4096}}`)
    }, 40)
    await expect(p).resolves.toEqual({ n_scanned: 4096 })
  })

  it('failPending 让在途请求立即失败（后端崩溃时不该干等超时）', async () => {
    const { io } = collectingIo()
    const client = new RpcClient(io, { timeoutMs: 5_000 })
    const p1 = client.call('a')
    const p2 = client.call('b')
    const boom = new Error('后端进程异常退出')
    client.failPending(boom)

    await expect(p1).rejects.toBe(boom)
    await expect(p2).rejects.toBe(boom)
    expect(client.pendingCount).toBe(0)
  })

  it('写入失败时抛错并清掉该请求（不泄漏 pending）', async () => {
    const client = new RpcClient({
      write: () => {
        throw new Error('EPIPE')
      },
    })
    await expect(client.call('ping')).rejects.toThrow(/写入 ping 请求失败/)
    expect(client.pendingCount).toBe(0)
  })

  it('close 后拒绝新调用，并让在途请求失败', async () => {
    const { io } = collectingIo()
    const client = new RpcClient(io)
    const p = client.call('a')
    client.close()
    await expect(p).rejects.toMatchObject({ code: 0 })
    await expect(client.call('b')).rejects.toThrow(/已关闭/)
  })

  it('接受 Buffer（子进程 stdout 直接喂给 acceptLine）', async () => {
    const { written, io } = collectingIo()
    const client = new RpcClient(io)
    const p = client.call('ping')
    client.acceptLine(
      Buffer.from(`{"jsonrpc":"2.0","id":${sent(written).id},"result":{"status":"ok"}}\n`, 'utf8'),
    )
    await expect(p).resolves.toEqual({ status: 'ok' })
  })

  it('id 自增且不重复（并发调用互不串号）', async () => {
    const { written, io } = collectingIo()
    const client = new RpcClient(io)
    void client.call('a')
    void client.call('b')
    void client.call('c')
    const ids = written.map((_, i) => sent(written, i).id)
    expect(new Set(ids).size).toBe(3)
    expect(INVALID_REQUEST).toBe(-32600)
  })

  it('resolve 后不再重复结算（同一 id 第二次到达只记协议错误）', async () => {
    const { written, io } = collectingIo()
    const errors: RpcProtocolError[] = []
    const client = new RpcClient(io, { onProtocolError: (e) => errors.push(e) })
    const p = client.call<number>('once')
    const id = sent(written).id
    client.acceptLine(`{"jsonrpc":"2.0","id":${id},"result":1}`)
    client.acceptLine(`{"jsonrpc":"2.0","id":${id},"result":2}`)
    await expect(p).resolves.toBe(1)
    expect(errors).toHaveLength(1)
  })

  it('不计时泄漏：正常返回后不再有定时器触发', async () => {
    vi.useFakeTimers()
    try {
      const { written, io } = collectingIo()
      const client = new RpcClient(io, { timeoutMs: 100 })
      const p = client.call('a')
      client.acceptLine(`{"jsonrpc":"2.0","id":${sent(written).id},"result":"ok"}`)
      await expect(p).resolves.toBe('ok')
      // 若定时器未清除，这里推进时间会抛出未处理的超时 rejection
      vi.advanceTimersByTime(1_000)
    } finally {
      vi.useRealTimers()
    }
  })
})
