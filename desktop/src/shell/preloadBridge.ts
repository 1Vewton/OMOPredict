// preload 暴露给渲染进程的 API（docs/desktop.md D11；消费方是 frontend/src/api/transport.ts）。
//
// 实现刻意与 Electron 解耦：只依赖一个 `{invoke(channel, ...args)}`，
// 因此可以用假 ipcRenderer 单测「信封 → 结果/抛错」的还原逻辑，
// 而 `src/preload.ts` 只剩三行 contextBridge 接线。
import { CHANNELS, unwrapEnvelope, type ChannelName } from './channels'

/** 最小 IPC 调用接口（`ipcRenderer.invoke` 的形状）。 */
export interface IpcInvoker {
  invoke(channel: ChannelName, ...args: unknown[]): Promise<unknown>
}

/** 暴露到 `window.omo` 的 API。 */
export interface OmoApi {
  /**
   * 调用一个后端方法（方法名见 docs/api/rpc.md §2）。
   *
   * 成功 resolve 结果（与 REST 响应体逐字段相同）；失败 reject **普通对象**
   * `{code, message}`（code 为 HTTP 语义），前端 `toApiError` 直接支持该形态。
   */
  rpc(method: string, params?: unknown): Promise<unknown>
  /** 打开日志目录（排障入口） */
  openLogDir(): Promise<void>
  /** 打开数据目录 */
  openDataDir(): Promise<void>
}

/**
 * 构造 `window.omo`。
 *
 * 参数:
 *   ipc  IPC 调用实现（preload 里传 `ipcRenderer`，测试里传假实现）
 *
 * 说明:
 *   只暴露**白名单方法**，不透传 `ipcRenderer`——渲染进程因此无法调用任意通道。
 */
export function createOmoApi(ipc: IpcInvoker): OmoApi {
  return {
    async rpc(method: string, params?: unknown): Promise<unknown> {
      if (typeof method !== 'string' || method.trim().length === 0) {
        throw { code: 0, message: 'method 需为非空字符串' }
      }
      const envelope = await ipc.invoke(CHANNELS.rpc, { method, params })
      return unwrapEnvelope(envelope)
    },
    openLogDir: async () => {
      await ipc.invoke(CHANNELS.openLogDir)
    },
    openDataDir: async () => {
      await ipc.invoke(CHANNELS.openDataDir)
    },
  }
}
