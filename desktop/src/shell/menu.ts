// 应用菜单（docs/desktop.md D7）：关于 / 打开数据目录 / 打开日志目录 / 导出诊断信息。
//
// 返回的是**纯数据模板**（可单测），由主进程交给 `Menu.buildFromTemplate`。
// 菜单里不放业务动作——只做用户排障与了解版本需要的事。
import type { MenuItemConstructorOptions } from 'electron'

/** 菜单项要触发的动作（由主进程注入，便于单测）。 */
export interface MenuActions {
  showAbout(): void
  openDataDir(): void
  openLogDir(): void
  exportDiagnostics(): void
  quit(): void
}

export interface MenuOptions {
  appName?: string
  /** macOS 需要把"关于/退出"放进应用菜单（Electron 惯例） */
  isMac?: boolean
}

/**
 * 构造菜单模板。
 *
 * 结构：应用菜单（仅 macOS）/ 文件（数据目录、日志目录、导出诊断、退出）/
 * 视图（重载、开发者工具、缩放）/ 帮助（关于）。
 */
export function buildMenuTemplate(
  actions: MenuActions,
  opts: MenuOptions = {},
): MenuItemConstructorOptions[] {
  const appName = opts.appName ?? 'OMOPredict'
  const isMac = opts.isMac ?? false

  const template: MenuItemConstructorOptions[] = []

  if (isMac) {
    template.push({
      label: appName,
      submenu: [
        { label: `关于 ${appName}`, click: () => actions.showAbout() },
        { type: 'separator' },
        { role: 'hide', label: '隐藏' },
        { role: 'hideOthers', label: '隐藏其它' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { label: `退出 ${appName}`, click: () => actions.quit() },
      ],
    })
  }

  template.push({
    label: '文件',
    submenu: [
      { label: '打开数据目录', click: () => actions.openDataDir() },
      { label: '打开日志目录', click: () => actions.openLogDir() },
      { type: 'separator' },
      { label: '导出诊断信息…', click: () => actions.exportDiagnostics() },
      { type: 'separator' },
      isMac ? { role: 'close', label: '关闭窗口' } : { label: '退出', click: () => actions.quit() },
    ],
  })

  template.push({
    label: '视图',
    submenu: [
      { role: 'reload', label: '重新加载' },
      { role: 'forceReload', label: '强制重新加载' },
      { type: 'separator' },
      { role: 'resetZoom', label: '实际大小' },
      { role: 'zoomIn', label: '放大' },
      { role: 'zoomOut', label: '缩小' },
      { type: 'separator' },
      { role: 'toggleDevTools', label: '开发者工具' },
    ],
  })

  template.push({
    label: '帮助',
    submenu: [
      { label: `关于 ${appName}`, click: () => actions.showAbout() },
      { label: '打开日志目录', click: () => actions.openLogDir() },
    ],
  })

  return template
}
