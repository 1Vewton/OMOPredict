# desktop —— 桌面壳（Electron）

> 设计见 [`docs/desktop.md`](../docs/desktop.md)；本目录当前实现 **T6（Host 层）**。

## 状态

| 任务 | 状态 | 说明 |
|---|---|---|
| **T6 Host 层** | ✅ 完成 | `src/host/`：目录/日志/单实例/引擎来源/Go 子进程守护 + stdio JSON-RPC 客户端；91 个单测 + 1 个真实端到端集成测试 |
| T7 Electron 壳 | ⏳ 待做 | 窗口（`app://` 协议）、菜单、preload（`window.omo`）、electron-builder 打包 |

**本目录的代码刻意不依赖 Electron**：Host 层是纯 Node 模块，因此能被单测在无 GUI 环境下覆盖，
Electron 只在 T7 的 `src/main.ts` / `src/preload.ts` 里出现。这也是为什么 `package.json`
目前**没有** electron 依赖——它随 T7 引入（Electron 二进制约 100MB+，不提前拉）。

## 结构

```
src/host/
├── paths.ts      # 用户数据/日志目录（D6：Windows %LOCALAPPDATA%\OMOPredict）
├── logger.ts     # 按天命名 + 保留 7 天的文件日志（D7），可回显到 stderr
├── lines.ts      # JSON-Lines 分帧（跨 chunk 半行、超长行丢弃）
├── rpc.ts        # stdio JSON-RPC 2.0 客户端（id↔Promise、超时、错误码=HTTP 语义）
├── backend.ts    # Go 子进程守护：spawn/健康检查/日志捕获/退出时失效在途请求/限速重启/进程树回收
├── engine.ts     # 引擎来源探测（只做 Go 看不到的部分）+ D9 第 5 级的友好指引
├── singleton.ts  # 单实例文件锁
└── host.ts       # 组装：目录→日志→锁→引擎→后端；对外 invoke()/dispose()
test/fixtures/fake-backend.mjs   # 假后端（真子进程，走真管道），用于测各种失败路径
```

## 常用命令

```bash
pnpm install
pnpm type-check   # tsc --noEmit（strict）
pnpm test         # vitest（node 环境；用例会真拉起子进程）
```

> ⚠️ 本目录**尚未配置 eslint/prettier**（前端有）。按 docs/desktop.md §7，桌面侧的
> lint 与 CI job 属 T9，届时一并补齐。

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

它会验证：Host 拉起 Go（`--stdio`）→ Go 拉起引擎（stdio）→ `tasks.create` → 轮询 `succeeded`
→ 数值与 REST 契约一致（Rs≈3.9708、T@550nm≈0.9745、SE@10GHz≈33.70）→ 删除 →
**后端进程不监听任何端口**（D11/§10.6）→ 优雅退出、无残留进程。

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

T7 的 preload 需按 T5 固化的契约暴露 `window.omo.rpc(method, params)`：成功 resolve 结果、
失败 reject 带 HTTP 语义 `code`（可直接把 `RpcCallError`/`BackendExitError` 的 `code` 与
`message` 透传给渲染进程）。
