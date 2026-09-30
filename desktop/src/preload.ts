// preload：渲染进程与主进程之间**唯一**的桥（docs/desktop.md D11）。
//
// 保持极薄：逻辑都在 `shell/preloadBridge.ts`（可单测），这里只做 contextBridge 接线。
// 注意**不要**把 `ipcRenderer` 整体暴露出去——那等于把任意通道交给渲染进程。
import { contextBridge, ipcRenderer } from 'electron'
import { createOmoApi } from './shell/preloadBridge'
import type { ChannelName } from './shell/channels'

const api = createOmoApi({
  invoke: (channel: ChannelName, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
})

contextBridge.exposeInMainWorld('omo', api)
