// 统一调用入口：把「传输选择」与「跨传输的横切关注点」收在一处。
//
// 各业务 api 模块（auth / tasks / meta）只调用 invoke()，不直接碰 transport，
// 这样以后新增传输（如 WebSocket）或调整 401 策略都只改本文件。

import { setToken } from './token'
import { activeTransport, toApiError, type RpcMethod, type RpcParams } from './transport'
import { ApiError } from './http'

/**
 * 调用一个 RPC 方法/端点。
 *
 * 401 语义对两种传输一致：清除本地凭证并广播 `omo:unauthorized`。
 * 是否跳转登录页由 App.vue 决定——单用户本地模式下该事件会被忽略（认证本就关闭）。
 *
 * 参数:
 *   method: RPC 方法名（见 transport.ts 的 HTTP_ROUTES 映射表）
 *   params: 调用参数（HTTP 形态下即为请求体 / 路径参数）
 *
 * 返回:
 *   结果（HTTP 响应体 / RPC result，二者逐字段相同）
 *
 * 异常:
 *   ApiError: status 为 HTTP 语义状态码（0 = 连接失败或本地校验失败）
 */
export async function invoke<T>(method: RpcMethod, params?: RpcParams): Promise<T> {
  try {
    return await activeTransport().invoke<T>(method, params)
  } catch (e) {
    const err = toApiError(e)
    if (err.status === 401) {
      setToken(null)
      window.dispatchEvent(new CustomEvent('omo:unauthorized'))
    }
    throw err
  }
}

export const client = { invoke }

export { ApiError }
