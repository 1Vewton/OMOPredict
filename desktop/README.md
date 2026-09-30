# desktop —— 桌面壳（Electron）

> 设计见 [`docs/desktop.md`](../docs/desktop.md)；本目录当前实现 **T6（Host 层）**。

## 状态

| 任务 | 状态 | 说明 |
|---|---|---|
| **T6 Host 层** | ✅ 完成 | `src/host/`：目录/日志/单实例/引擎来源/Go 子进程守护 + stdio JSON-RPC 客户端 |
| **T7 Electron 壳** | ✅ 完成（**未跑过启动**） | `src/main.ts` + `src/preload.ts` + `src/shell/`；`tsc --noEmit` 对真实 Electron 类型干净，150 单测 |
| T8 轻量包 / T9 打包与 CI | ⏳ 待做 | `setup-engine.ps1`、`build-desktop.ps1` / `build-lite.ps1`、体积门禁 |

**Host 层与壳逻辑都刻意不依赖 Electron**（`src/host/`、`src/shell/` 是纯 Node 模块），因此绝大部分
代码能在无 GUI 环境下单测；只有 `src/main.ts` / `src/preload.ts` 是 Electron 接线。

> ⚠️ **壳未实际启动过**：本环境无法下载 Electron 二进制（约 100MB+，拉包速率过低），
> 所以"窗口能打开、`app://` 能渲染 `frontend/dist`、CSP 没误伤 Vue/ECharts 的行内样式"
> 这三件事**一次都没跑过** —— 属 docs/desktop.md §10 的 **T11 净机验收**。
> `electron` 目前只作为**类型来源**安装（`ELECTRON_SKIP_BINARY_DOWNLOAD=1`）。

## 结构

```
src/
├── main.ts        # 主进程接线：窗口(app:// 协议)、菜单、IPC、单实例、优雅退出（T7）
├── preload.ts     # contextBridge 白名单 → window.omo（T7）
├── host/          # Host 层（T6，不含 Electron，可纯 Node 单测）
│   ├── paths.ts   # 用户数据/日志目录（D6：Windows %LOCALAPPDATA%\OMOPredict）
│   ├── logger.ts  # 按天命名 + 保留 7 天的文件日志（D7），可回显到 stderr
│   ├── lines.ts   # JSON-Lines 分帧（跨 chunk 半行、超长行丢弃）
│   ├── rpc.ts     # stdio JSON-RPC 2.0 客户端（id↔Promise、超时、错误码=HTTP 语义）
│   ├── backend.ts # Go 子进程守护：spawn/健康检查/日志捕获/退出即失效在途请求/限速重启/进程树回收
│   ├── engine.ts  # 引擎来源探测（只做 Go 看不到的部分）+ D9 第 5 级的友好指引
│   ├── singleton.ts  # 单实例文件锁
│   └── host.ts    # 组装：目录→日志→锁→引擎→后端；对外 invoke()/dispose()
└── shell/         # 壳逻辑（T7，同样与 Electron 解耦）
    ├── appProtocol.ts   # app:// 解析 + SPA 回退 + 目录穿越防护 + CSP/安全头
    ├── channels.ts      # IPC 通道名 + 结果信封 + preload 侧还原
    ├── preloadBridge.ts # 构造 window.omo（只依赖 {invoke}，可用假 ipcRenderer 单测）
    ├── menu.ts          # 菜单模板（关于/数据目录/日志目录/导出诊断）
    ├── windowOptions.ts # 窗口与 webPreferences 安全基线
    ├── backendCommand.ts# 后端可执行文件定位（env / 打包资源 / 仓库构建产物）
    └── diagnostics.ts   # 诊断信息构造（**密钥脱敏**）
test/fixtures/fake-backend.mjs   # 假后端（真子进程，走真管道），用于测各种失败路径
```

## 常用命令

```bash
pnpm install
pnpm type-check   # tsc --noEmit（strict；含真实 Electron 类型）
pnpm test         # vitest（node 环境；用例会真拉起子进程）
```

> ⚠️ 本目录**尚未配置 eslint/prettier**（前端有）。按 docs/desktop.md §7，桌面侧的
> lint 与其余工具链属 T9，届时一并补齐。

## 集成测试（真实后端 + 真实引擎）

默认跳过；显式给出后端可执行文件与引擎命令后运行：

```powershell
cd server; go build -o ..\.itest\omopredict.exe .\cmd\omopredict
cd ..\desktop
$env:OMO_BACKEND_EXE = "$PWD\..\.itest\omopredict.exe"
$env:OMO_ENGINE_CMD  = '"<repo>\engine\.venv\Scripts\python.exe" -m omo.rpc'
$env:OMO_INTEGRATION_DIR = "$PWD\..\.itest\data"   # 受限环境需指定可写目录，见 HANDOVER §6
pnpm vitest run src/host/integration.test.ts
```

它会验证两条链路：

1. **Host ↔ 后端**：Host 拉起 Go（`--stdio`）→ Go 拉起引擎（stdio）→ `tasks.create` → 轮询 `succeeded`
   → 数值与 REST 契约一致（Rs≈3.9708、T@550nm≈0.9745、SE@10GHz≈33.70）→ 删除 →
   **后端进程不监听任何端口**（D11/§10.6）→ 优雅退出、无残留进程。
2. **渲染进程可见链路（T7）**：`window.omo.rpc('meta')` → IPC 信封 → **真实 Host/Go/引擎** →
   建任务 → 轮询 → 数值一致 → 不存在的任务返回**跨进程的 404**。
   这条链路用的是与 `src/main.ts` 相同的处理器工厂（`makeRpcHandler`）和与 preload 相同的桥
   （`createOmoApi`），只把 Electron 的传输换成假的——即除 Electron 本身之外全部为真实组件。

## 与 T7 的接口（已固化）

```ts
const host = await Host.start({
  backendCommand: <omopredict-server.exe 路径>,
  backendArgs: ['--stdio'],
  resourcesDir: <resources/ 目录>,   // 完整包内置引擎时必需
})
const tasks = await host.invoke('tasks.list')        // 方法名见 docs/api/rpc.md
const off = host.onEvent((e) => { /* exit / restart / failed / stdout-pollution */ })
await host.dispose()
```

T7 的 preload 按 T5 固化的契约暴露 `window.omo.rpc(method, params)`：成功 resolve 结果、
失败 reject 带 HTTP 语义 `code`——实现见 `src/shell/preloadBridge.ts` + `src/shell/channels.ts`
（信封机制的原因写在 `channels.ts` 顶部注释里）。

## 启动壳（T7，需要 Electron 二进制）

```bash
# 1) 取二进制（会下载约 100MB+；本仓库环境尚未下载）
pnpm rebuild electron        # 或在安装时去掉 ELECTRON_SKIP_BINARY_DOWNLOAD

# 2) 构建渲染产物与后端
cd ..\frontend && pnpm build && cd ..\desktop
cd ..\server && go build -o ..\server\omopredict.exe .\cmd\omopredict && cd ..\desktop

# 3) 编译 TS 并启动（main 入口见 package.json 的 "main"）
pnpm exec tsc -p tsconfig.json --outDir dist   # 注意：源码目前 noEmit，打包用的编译配置属 T9
pnpm exec electron dist/main.js
```

> ⚠️ 上面的第 3 步依赖 T9 的构建脚本（当前 `tsconfig.json` 是 `noEmit`，且 preload 需输出 `.cjs`）。
> 在 T9 补齐之前，**运行方式尚未定型**；这也是"壳未跑过启动"的一部分原因。
