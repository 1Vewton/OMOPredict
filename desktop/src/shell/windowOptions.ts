// 主窗口选项（docs/desktop.md D2/D11）。
//
// 安全默认值集中在此并有用例守护：渲染进程跑的是本地打包的静态资源，
// **不需要** Node 能力，也不应该有任何网络能力（connect-src 'none'）。
// 一旦有人为了图方便打开 nodeIntegration，这里会先失败。
import type { BrowserWindowConstructorOptions } from 'electron'

export interface MainWindowInput {
  /** preload 脚本绝对路径（contextBridge 的唯一入口） */
  preloadPath: string
  /** 窗口图标（打包后可省略） */
  iconPath?: string
  /** 避免白屏闪烁的背景色（与前端主题一致） */
  backgroundColor?: string
}

/** 默认窗口尺寸（1080 宽的内容区 + 侧边留白，够放下结果图表）。 */
export const DEFAULT_WINDOW_SIZE = { width: 1280, height: 880, minWidth: 960, minHeight: 640 }

/** 构造主窗口选项：`show:false` + 外部 `ready-to-show` 后再显示，避免白屏。 */
export function mainWindowOptions(input: MainWindowInput): BrowserWindowConstructorOptions {
  return {
    ...DEFAULT_WINDOW_SIZE,
    show: false,
    backgroundColor: input.backgroundColor ?? '#f8fafc',
    title: 'OMOPredict',
    ...(input.iconPath ? { icon: input.iconPath } : {}),
    webPreferences: {
      // 安全基线：隔离上下文、禁用 Node、启用渲染进程沙箱
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      // preload 是渲染进程与主进程之间**唯一**的桥
      preload: input.preloadPath,
      // 渲染进程不需要 webview；显式关闭以免留下旁路
      webviewTag: false,
      spellcheck: false,
    },
  }
}
