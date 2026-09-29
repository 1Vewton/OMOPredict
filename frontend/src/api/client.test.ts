// client.ts 的横切关注点：401 归一化处理（两种传输共用同一入口）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { invoke } from './client'
import { getToken, setToken } from './token'
import { ApiError, setTransport, type RpcMethod, type RpcParams, type Transport } from './transport'

/** 用假传输替换当前传输，便于直接驱动 client 的横切逻辑。 */
function useFakeTransport(impl: (method: string, params?: unknown) => Promise<unknown>): void {
  const fake: Transport = {
    name: 'ipc',
    // 测试替身：参数原样透传给 impl，返回值按调用方的期望类型断言
    invoke: <T>(method: RpcMethod, params?: RpcParams) => impl(method, params) as Promise<T>,
  }
  setTransport(fake)
}

afterEach(() => {
  setTransport(null)
  setToken(null)
})

describe('client.invoke', () => {
  it('401：清除本地凭证并广播 omo:unauthorized（App.vue 据此决定是否跳登录页）', async () => {
    setToken('stale-token')
    const received: Event[] = []
    const listener = (e: Event) => received.push(e)
    window.addEventListener('omo:unauthorized', listener)

    useFakeTransport(async () => {
      throw new ApiError(401, 'token 已过期')
    })

    await expect(invoke('tasks.list')).rejects.toMatchObject({ status: 401 })
    expect(getToken()).toBeNull()
    expect(received).toHaveLength(1)

    window.removeEventListener('omo:unauthorized', listener)
  })

  it('非 401 错误：不动凭证、不广播（如 404 / 422）', async () => {
    setToken('good-token')
    const listener = vi.fn()
    window.addEventListener('omo:unauthorized', listener)

    useFakeTransport(async () => {
      throw new ApiError(404, 'task not found')
    })

    await expect(invoke('tasks.get', { id: 'x' })).rejects.toMatchObject({ status: 404 })
    expect(getToken()).toBe('good-token')
    expect(listener).not.toHaveBeenCalled()

    window.removeEventListener('omo:unauthorized', listener)
  })

  it('传输抛出的非 ApiError 也被归一化后抛出', async () => {
    useFakeTransport(async () => {
      throw new Error('socket closed')
    })
    await expect(invoke('meta')).rejects.toBeInstanceOf(ApiError)
    await expect(invoke('meta')).rejects.toMatchObject({ status: 0, message: 'socket closed' })
  })

  it('成功时透传结果与方法名、参数', async () => {
    const seen: { method: string; params: unknown }[] = []
    useFakeTransport(async (method, params) => {
      seen.push({ method, params })
      return { ok: true }
    })

    await expect(invoke('tasks.delete', { id: 'abc' })).resolves.toEqual({ ok: true })
    expect(seen).toEqual([{ method: 'tasks.delete', params: { id: 'abc' } }])
  })
})
