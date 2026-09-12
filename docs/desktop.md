# OMOPredict 桌面版本设计（Design Doc）

> 状态：**待评审（第 3 稿）** — 已落定：**Electron 壳** + **单用户（无用户管理）** + **无网络传输（IPC/stdio）** + **Go 保留为任务管理层** + **双分发形态**
> 目标里程碑：M6 扩展（本地分发形态）
> 关联约定：AGENTS.md §2（三层架构）、§6.6（分层纪律：物理逻辑只在 Python 层）、
> docs/HANDOVER.md（现有启动方式与环境坑）

---

## 0. 评审决定记录

| 议题 | 决定 | 关键含义 |
|---|---|---|
| 桌面壳 | **Electron** | 自带 Chromium（无 WebView2 依赖）、Node 工具链现成；代价壳体积 ~120–180MB |
| 用户管理 | **桌面版抛弃** | 单用户本地应用：无登录/注册/JWT；通过运行模式开关实现，非删除代码（D10） |
| 数据交换 | **不使用网络（强读）** | 组件间不再有回环 HTTP/端口：渲染进程 ↔ 主进程走 Electron IPC，主进程 ↔ Go ↔ Python 走 **stdio JSON-RPC**（D11） |
| 中间层职责 | **Go 保留为"任务管理层"** | 任务创建/列表/查询/删除 + 结果持久化（SQLite）；避免在 Python 侧重写一套任务逻辑 |
| 任务管理能力 | **包含删除** | 新增 `DELETE /api/tasks/{id}` 与 RPC `tasks.delete`；前端历史页提供删除 |
| 引擎打包（完整包） | **PyInstaller onedir，排除 torch/fastapi/uvicorn** | 桌面入口不再起 HTTP 服务 → 依赖更少、启动更快（D4） |
| 分发形态 | **完整包 + 轻量包（自备 Python）** | 两者共用同一份 dist / Go 二进制，仅引擎来源不同（D9） |
| 本期不做 | 便携模式、托盘常驻、代码签名、自动更新 | 设计预留，见 §12 |

---

## 1. 目标与非目标

### 目标
1. **双击即用**：Windows 优先；完整包用户机器无需预装 Python / Go / Node。
2. **纯本地、无网络**：应用运行期间**不监听任何端口**；组件间为进程内 IPC 与 stdio 管道；断网可用。
3. **单用户直达**：无登录页/无账号概念，启动即进入设计页；"任务"就是唯一的数据实体。
4. **零功能分叉**：与 Web 版共用同一份前端 `dist`、引擎与中间层代码；差异仅在运行模式与传输适配。
5. **双形态分发**：完整包（内置引擎，开箱即用）与轻量包（自备 Python，≤50MB）。

### 非目标（本期不做）
- macOS / Linux 打包（架构预留，先只做 Windows）。
- 自动更新、代码签名、托盘常驻、便携模式（§12）。
- 桌面版 NN 代理加速（排除 torch；Web 版与"自备 Python"的轻量包不受限）。
- Web 版的静态托管（原第 2 稿的 `internal/web` embed 方案转为可选，见 §12）。

---

## 2. 现状与约束

| 组件 | 现状 | 桌面版要求 |
|---|---|---|
| 前端 | Vue3+TS+Vite；`http.ts` 用 `fetch` 打相对路径 `/api/...`；登录守卫 + auth store | 增加**传输抽象**（http / ipc 二选一）与**能力门禁**（无认证模式隐藏登录） |
| Go 中间层 | REST `/api/*`（net/http）+ GORM/SQLite + JWT + 任务编排；`EngineClient` 走 HTTP 调引擎 | 新增 **stdio RPC 传输**与**单用户模式**；引擎调用改为可切 stdio 子进程；新增任务删除 |
| Python 引擎 | FastAPI `omo.api`（`/simulate`、`/optimize`）；编排在 `omo.api.service` | 新增 **stdio RPC 入口**（不起 HTTP）；把编排下沉到不依赖 FastAPI 的模块；可选依赖化（torch/matplotlib/fastapi/uvicorn 均可排除） |
| 数据 | `server/.env` + `omopredict.db`（相对路径） | 迁移到用户数据目录（D6）；单用户模式下统一 `user_id = "local"` |
| 契约 | `docs/api/rest.md`（对外）、`docs/api/engine.md`（Go→引擎） | **同一份 JSON 载荷**同时服务于 HTTP 与 RPC（单一契约来源，D11 + 契约一致性测试） |

**硬约束**：物理逻辑不得复制到壳/Go/前端（AGENTS §6.6）；桌面版不得改变仿真数值结果。

---

## 3. 总体架构（无网络）

```
┌────────────────────────────────────────────────────────────────────┐
│ Electron                                                           │
│  ├─ 渲染进程：现有 Vue 前端（dist，经自定义协议 app:// 加载）          │
│  │     传输：window.omo.rpc(method, params)   ← 无 fetch/无 HTTP     │
│  ├─ preload（contextIsolation，最小暴露）                            │
│  └─ 主进程 Host 层（desktop/electron/src/host/）                     │
│        首次运行初始化 → 数据目录/密钥 → 拉起 Go 子进程 → 单实例锁      │
│        → 菜单（关于/数据目录/日志/诊断）→ 退出回收进程树（Job Object）  │
│             ⇅ stdio JSON-RPC 2.0（换行分隔）                        │
├────────────────────────────────────────────────────────────────────┤
│ Go 任务管理层（omopredict-server.exe --stdio）                       │
│  · 单用户模式：OMO_AUTH_MODE=none → 固定本地用户（user_id="local"）    │
│  · RPC 方法：meta / ping / tasks.create|list|get|delete              │
│  · SQLite（用户数据目录）；无端口、无 HTTP（桌面模式）                 │
│             ⇅ stdio JSON-RPC 2.0（Go 作为父进程，拉起并守护引擎）      │
├────────────────────────────────────────────────────────────────────┤
│ Python 引擎（omo-rpc：读 stdin 的 JSON-Lines 循环）                   │
│  · 方法：ping / simulate / optimize（载荷与 /simulate、/optimize 一致）│
│  · 无 FastAPI/uvicorn（桌面入口不导入，打包随之排除）                  │
└────────────────────────────────────────────────────────────────────┘
```

**Web / 开发模式**（保持不变）：浏览器 → Vite 代理 → Go（HTTP + JWT 多用户）→ 引擎（HTTP `omo.api`）。
两种模式**共用**同一份前端源码、Go 服务层、引擎物理代码与 JSON 载荷，只是传输与认证模式不同。

---

## 4. 关键设计决策

### D1 桌面壳：**Electron**（已定案）

| 维度 | Electron（选定） | Tauri 2（备选） |
|---|---|---|
| 壳体积 | ~120–180MB | ~8–15MB |
| 运行时依赖 | 自带 Chromium，环境一致性最好 | 依赖 WebView2（旧 Win10 需 bootstrapper） |
| 工具链 | 仅 Node（零新增） | 需 Rust + cargo（CI +5–10min） |
| IPC/子进程 | `ipcMain`/`child_process` 原生 | `externalBin` + shell 插件 |
| 结论 | 风险最低、与现有工具链一致 | 若"包体 <150MB"成硬指标再切换 |

壳能力收敛在 Host 层，对外仅暴露：`spawnBackend()` / `invokeRpc(method, params)` /
`openWindow()` / `shutdown()`；业务与脚本只依赖这层接口。

### D10 单用户模式（抛弃用户管理）

- **运行模式**：`OMO_AUTH_MODE = none | jwt`（桌面 `none`，Web `jwt`，默认 `jwt` 保持向后兼容）。
- **中间件行为**：`none` 模式下认证中间件直接注入固定用户 `{ID: "local", Username: "local"}`，
  不读 `Authorization`、不查 users 表；所有任务接口照常工作。
- **能力端点**：新增 `meta`（HTTP `GET /api/meta` / RPC `meta`）返回
  `{auth_required: false, mode: "desktop", version, engine_transport}`，供前端决策。
- **前端门禁**：启动时读 `meta`：
  - `auth_required === false` → 路由守卫放行全部页面、`/login` 重定向到 `/design`、
    隐藏"用户名/退出"与登录页入口；顶栏显示"本地模式"标记
  - `auth_required === true`（Web）→ 维持现有登录流程
  - `meta` 请求失败（网络/传输异常）→ 默认按"需要认证"处理，避免误放行
- **auth store**：新增 `authRequired` 状态；无认证模式下 `isAuthenticated` 恒为 true（token 不参与）。
- **数据一致性**：`SimulationTask.UserID = "local"`，表结构不变（Web 版同一张表可继续使用）。

### D11 无网络数据交换：Electron IPC + stdio JSON-RPC（已定案）

**协议**：JSON-RPC 2.0，**换行分隔（JSON-Lines）**，UTF-8 字节流（不经控制台编码，规避 GBK 坑）。

- 请求：`{"jsonrpc":"2.0","id":1,"method":"tasks.create","params":{...}}`
- 成功：`{"jsonrpc":"2.0","id":1,"result":{...}}`
- 失败：`{"jsonrpc":"2.0","id":1,"error":{"code":401,"message":"invalid username or password"}}`
  —— `code` **沿用 HTTP 状态码语义**，前端错误处理（401 登出、409 冲突提示等）无需改写
- 通知（可选）：`{"jsonrpc":"2.0","method":"progress","params":{"req_id":1,"done":500,"total":4096}}`

**三段链路**：
1. 渲染进程 → 主进程：`ipcRenderer.invoke('omo:rpc', method, params)`（preload 白名单暴露）
2. 主进程 → Go：`child_process.spawn` + stdin/stdout 行协议（Host 层维护 `id ↔ Promise` 映射）
3. Go → Python：Go 作为父进程拉起引擎（`OMO_ENGINE_CMD` 或自动发现），同样行协议

**载荷一致性**：RPC 的 `params`/`result` 与现有 REST 请求/响应体**逐字段相同**
（如 `tasks.create` 的 params 即 `POST /api/tasks` 的请求体；`simulate` 的 params 即 `/simulate` 请求体）。
因此 `docs/api/rest.md`、`docs/api/engine.md` 就是 RPC 的契约文档；新增 §5 的"方法 ↔ 端点"映射表。

**为什么不让 Go 走 HTTP、只把前端换成 IPC**：那仍需本地监听端口与 HTTP 面；
强读要求"无网络"，因此三条链路全部去 HTTP。

**CSP（渲染进程）**：`default-src 'self' app:; connect-src 'none'; script-src 'self'`
——渲染进程不允许任何网络连接，只允许 IPC。

### D2 前端资源如何加载：**自定义协议 `app://` + dist 打进 Electron**

- `dist` 由 electron-builder 打进应用资源；主进程用 `protocol.handle('app', …)` 提供
  `app://omo/index.html` 与静态资源，并对未知路径回退 `index.html`（保持 `createWebHistory` 路由不变）。
- 不采用 `file://`（需要改 hash 路由、且相对路径与 SPA 回退都别扭）。
- Go 侧**不需要**再内嵌 dist（原第 2 稿的 `internal/web` 转为 Web 部署的可选项，见 §12）。

### D3 中间层职责：**Go 保留为任务管理层**（已定案）

任务创建 → 调引擎 → 结果持久化 → 列表/查询/删除，全部留在 Go；单用户模式下只是"没有用户维度"。
放弃 Go 意味着在 Python 侧重写任务生命周期与存储（两套实现），与单一实现纪律冲突。

### D4 完整包引擎打包：**PyInstaller onedir，排除 torch/fastapi/uvicorn**

- **编排下沉（必要前置）**：把 `run_simulation` / `run_optimization` 从 `omo.api.service`
  迁到中立的 `omo.sim`（或 `omo.core`），`omo.api.service` 仅做薄转发。
  这样桌面入口 `omo.rpc` 只依赖 `omo.sim` + 物理子包，**完全不导入 FastAPI/uvicorn/pydantic**。
- 入口：`engine/src/omo/rpc/__main__.py`（读 stdin 行循环，方法 `ping`/`simulate`/`optimize`）。
- PyInstaller 要点：
  - `--onedir`（不用 onefile：启动慢、误报多）
  - `--exclude-module torch --exclude-module matplotlib --exclude-module fastapi
    --exclude-module uvicorn --exclude-module tkinter --exclude-module IPython --exclude-module pytest`
  - `--collect-submodules omo`（src 布局）
- 体积预期：**numpy + scipy + pydantic ≈ 50–90MB**（比第 2 稿少 FastAPI/uvicorn）
- 可选依赖化：`pyproject.toml` 增加 extras `neural = ["torch"]`、`plot = ["matplotlib"]`、
  `api = ["fastapi", "uvicorn"]`；**import 图测试**固化"导入 `omo.rpc` 后 sys.modules 无 torch/matplotlib/fastapi/uvicorn"。

### D5 进程生命周期（无端口）

- **启动顺序**：Host → 初始化数据目录/密钥 → 拉起 Go（`--stdio`）→ Host 发 `ping`
  → Go 自行拉起引擎并发 `ping` → 就绪后开窗（整体目标 ≤5s）。
- **健康检查**：Host 每 5s `ping`（超时 2s）；Go 每 5s `ping` 引擎；
  连续 3 次失败 → 各自重启下游（限速 3 次/10min，超出弹窗并停止重试）。
- **退出**：窗口关闭/菜单退出 → 反向优雅退出（`shutdown` 通知 → 引擎 flush → Go 关库）
  → 超时 3s 强杀；Windows 用 **Job Object** 绑定进程树，保证无残留。
- **无端口**：不探测、不重试、不触发防火墙；健康检查即 RPC `ping`。

### D6 数据目录与密钥

| 平台 | 路径 |
|---|---|
| Windows | `%LOCALAPPDATA%\OMOPredict\` |
| macOS | `~/Library/Application Support/OMOPredict/` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/omopredict/` |

内容：`omopredict.db`、`logs/backend.log`、`logs/engine.log`、`logs/host.log`。
**注意**：无认证模式**不需要** `jwt.secret`；仅在 Web 模式下要求 `OMO_JWT_SECRET`（保持现状）。
注入：`OMO_DB_DRIVER=sqlite`、`OMO_DB_DSN=<dataDir>/omopredict.db`、
`OMO_AUTH_MODE=none`、`OMO_LOG_DIR=<dataDir>/logs`（新增）、`OMO_ENGINE_CMD=<引擎启动命令>`。

### D7 单实例、日志与诊断

- **单实例**：`app.requestSingleInstanceLock()`；二次启动聚焦已有窗口后退出。
- **日志**：三段日志统一写 `logs/`（按天轮转、保留 7 天）；Host 捕获子进程 stderr 一并落盘；
  菜单"打开日志目录 / 导出诊断信息（logs + db 副本 + 版本）"。

### D8 版本与更新（本期手动）

版本来源：`engine/pyproject.toml`、Go `-ldflags -X main.version`、`frontend/package.json`
→ 构建时统一注入壳 `version`、"关于"页与 `meta` 返回。本期用 GitHub Release 手动覆盖；
`electron-updater` 预留（需签名）。

### D9 轻量包（自备 Python）设计与引擎发现

**产物**：`OMOPredict-lite-<ver>-win-x64.zip`（目标 ≤50MB）
= Electron 壳 + Go sidecar + **引擎源码**（`engine/`，~1MB）+ `setup-engine.ps1` + `README.txt`。

**引擎解析顺序（Host/Go 共用 `resolveEngine()`）**：

| 顺序 | 条件 | 启动方式 |
|---|---|---|
| 1 | 环境变量 `OMO_ENGINE_CMD` | 直接执行（机房统一配置/高级用户） |
| 2 | 同级 `resources/engine/omo-rpc.exe`（完整包布局） | 直接运行 sidecar |
| 3 | PATH 有 `uv` | `uv run --frozen --project <内置 engine> python -m omo.rpc` |
| 4 | PATH 有 `python`/`py` 且 `import omo` 成功 | `python -m omo.rpc` |
| 5 | 均失败 | **友好错误对话框**：缺什么、装什么（Python ≥3.12 或 uv）、"打开日志目录" |

`setup-engine.ps1`：有 uv → `uv sync --frozen`；否则 `python -m pip install -e engine`（附镜像提示）。

---

## 5. 接口契约

### 5.1 RPC 方法 ↔ REST 端点映射（载荷逐字段相同）

| RPC 方法 | HTTP 等价 | 说明 |
|---|---|---|
| `ping` | `GET /health` | 就绪/健康探测 |
| `meta` | `GET /api/meta`（新增） | `{auth_required, mode, version, engine_transport}` |
| `tasks.create` | `POST /api/tasks` | kind=simulate / optimize（含 202 语义：立即返回 pending 任务） |
| `tasks.list` | `GET /api/tasks` | 新建在前 |
| `tasks.get` | `GET /api/tasks/{id}` | 状态与结果 |
| `tasks.delete` | `DELETE /api/tasks/{id}`（新增） | 删除任务（含结果）；返回 `{deleted: true}` |
| `auth.register` / `auth.login` / `auth.me` | `/api/auth/*` | 仅 Web（jwt）模式；桌面 `none` 模式下返回 `error.code = 401` |

### 5.2 环境变量

| 变量 | 取值方 | 含义 |
|---|---|---|
| `OMO_AUTH_MODE` | Go | **新增**：`none`（桌面，固定本地用户）/ `jwt`（Web，默认） |
| `OMO_ENGINE_TRANSPORT` | Go | **新增**：`http`（Web，默认，配合 `OMO_ENGINE_URL`）/ `stdio`（桌面，配合 `OMO_ENGINE_CMD`） |
| `OMO_ENGINE_CMD` | Go/Host | **新增**：引擎启动命令（stdio 模式；缺省按 D9 顺序自动发现） |
| `OMO_LOG_DIR` | Go | **新增**：日志目录（不设则输出 stderr，保持现有行为） |
| `OMO_DB_DRIVER` / `OMO_DB_DSN` / `OMO_SERVER_ADDR` / `OMO_ENGINE_URL` / `OMO_JWT_SECRET` | Go | 复用现有（桌面仅用前两个） |

---

## 6. 目录与产物布局

```
OMOPredict/
├── desktop/                     # 新增：Electron 壳
│   ├── electron/
│   │   ├── src/main.ts          # 窗口(app:// 协议)、菜单、单实例
│   │   ├── src/host/rpc.ts      # stdio JSON-RPC 客户端（id↔Promise、超时、重启）
│   │   ├── src/host/backend.ts  # 拉起/守护 Go 子进程、进程树回收、日志捕获
│   │   ├── src/host/engine.ts   # 引擎发现（D9 五级）与命令拼装
│   │   ├── src/preload.ts       # 暴露 window.omo.{rpc,version,openLogDir,openDataDir}
│   │   └── resources/dist/      # 构建期放入 frontend/dist
│   ├── lite/                    # setup-engine.ps1、README.txt 模板
│   └── package.json             # electron-builder（nsis + zip）
├── frontend/src/api/            # 新增 transport.ts（http | ipc）、client.ts；views 不改
├── server/internal/rpc/         # 新增：stdio JSON-RPC 分发器（复用 task/user 服务）
├── engine/src/omo/rpc/          # 新增：stdio 入口；omo/sim.py 承载编排（从 api.service 下沉）
└── scripts/
    ├── build-desktop.ps1        # pnpm build → go build → pyinstaller → electron-builder
    ├── build-lite.ps1           # pnpm build → go build → 组装轻量包
    ├── rpc-cli.ps1              # 手工调试：向 stdio 发一行 JSON 看响应
    └── start-local.ps1          # 无壳调试：拉起 Go(--stdio)+引擎 + 打开浏览器（http 模式）
```

---

## 7. 构建与 CI 流水线

```
[1] frontend : pnpm install --frozen-lockfile → lint → build                 → dist
[2] server   : go vet/test（含 RPC 分发器与单用户模式测试）→ go build         → omopredict-server.exe
[3] engine   : uv sync --frozen → pytest（含 import 图测试）→ pyinstaller     → engine/ onedir
[4] desktop  : dist + [2] + [3] → electron-builder（nsis + zip）              → 完整包
[5] lite     : dist + [2] + engine 源码 + setup 脚本 → zip                    → 轻量包
[6] release  : tag 触发；上传产物 + SHA256 清单
```

- 缓存：pnpm store、Go build cache、uv cache、Electron 二进制（`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`）。
- **体积门禁**：完整包 ≤300MB、引擎目录 ≤90MB、轻量包 ≤50MB（超出即失败，防 torch/fastapi 回归）。
- **契约一致性测试**（必做）：同一组用例分别经 HTTP 与 RPC 执行，断言响应 JSON 深度相等；
  前端 `client.ts` 用同一套假传输做单测。

---

## 8. 开发模式与调试

| 场景 | 做法 |
|---|---|
| 纯前端（Web） | `pnpm dev`（Vite 代理 → Go :8080，jwt 模式）；前端自动走 http 传输 |
| 壳开发 | Go/引擎按普通方式启动；壳 dev 模式加载 `http://localhost:5173`，Host 跳过子进程拉起（`OMO_DESKTOP_DEV=1`） |
| 无壳本地调试 | `scripts/start-local.ps1`（Go `--stdio` + 引擎 `omo.rpc` + `rpc-cli.ps1` 手工联调） |
| 完整包/轻量包 | `build-desktop.ps1` / `build-lite.ps1`；产物在 `desktop/electron/dist/` |
| RPC 手工验证 | `rpc-cli.ps1 '{"jsonrpc":"2.0","id":1,"method":"tasks.list","params":{}}'` |

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| **双传输漂移**（HTTP 与 RPC 行为不一致） | 同一功能两种结果 | 载荷单一契约 + **契约一致性测试**（§7）+ RPC 分发器与 HTTP handler 共用 service 层 |
| 大响应体走行协议 | `optimize` 报告可达数百 KB；行长过大可能超缓冲 | 两侧读缓冲显式放大（≥8MB）；必要时改分块帧（长度前缀），先按行协议并加"大响应"测试 |
| stdio 编码 | Windows 控制台/管道编码不一致导致中文乱码或解析失败 | 强制 UTF-8 字节流（不经控制台代码页）；两侧均显式设置；测试含中文任务名 |
| PyInstaller 打包 scipy 缺 DLL | 引擎启动失败 | `--onedir` + 显式 hiddenimports；先净机单独冒烟 sidecar 再进壳 |
| torch/fastapi 被隐式拉入 | 包体爆炸/门禁失败 | 编排下沉 + 可选 extras + import 图测试 + 体积门禁 |
| 杀软误报（PyInstaller 常见） | 用户不敢运行 | onedir 优先；README 说明；后续有证书再签名 |
| Electron 包体偏大 / 二进制下载慢 | 分发不便 / CI 超时 | 轻量包互补；`ELECTRON_MIRROR` + CI 缓存；NSIS 压缩 |
| 轻量包用户环境不符 | 无法使用 | D9 五级发现 + 明确报错指引 + `setup-engine.ps1` |
| 单用户模式误放行（Web 被错配为 none） | 安全风险 | `OMO_AUTH_MODE` 仅由桌面 Host 注入；`meta` 暴露模式；启动日志显式打印当前模式；Web 部署文档强调默认 `jwt` |
| 数据目录含中文/长路径 | SQLite/解压异常 | ASCII 子目录名 `OMOPredict`；净机含中文用户名验证 |
| 无端口带来的"不可 curl"调试不便 | 排障成本 | 保留 http 模式 + `rpc-cli.ps1` + 三段日志 + 诊断导出 |

---

## 10. 验收标准（净机清单）

### 完整包（未安装 Python / Go / Node 的 Windows 机器）
1. 绿色包解压双击 → **≤5s** 出现主窗口（首次含初始化 ≤8s）。
2. **无登录页**：启动即进入参数设计页；顶栏显示"本地模式"。
3. 仿真（ITO/Ag/ITO 40-10-40）→ 结果图表正常；目标反推（T≥85%、Rs≤12、SE≥25）→ 候选表 + 灵敏度正常；
   **数值与 Web 版一致**（同输入比对 Rs / T@550nm / SE@10GHz）。
4. 任务历史：列表/查看/**删除**均正常；删除后重开应用不復现。
5. 关闭应用 → 任务历史保留；断网下全流程可用。
6. **应用运行期间无监听端口**：`netstat -ano | findstr <PID>` 无 LISTENING 记录。
7. 退出后无 `OMOPredict.exe` / `omopredict-server.exe` / `omo-rpc.exe` 残留。
8. 安装包 ≤300MB、引擎目录 ≤90MB；数据目录为 `%LOCALAPPDATA%\OMOPredict\`，菜单可打开日志。

### 轻量包
9. **未装 Python** 的机器：启动给出明确指引（缺 Python/uv + 安装说明 + 打开日志），不崩溃、不白屏。
10. 装好 Python ≥3.12 并执行 `setup-engine.ps1` → 重启即完整可用（同 3–4 项）。
11. 体积 ≤50MB；与完整包结果一致。

---

## 11. 任务拆解（实现阶段）

| # | 任务 | 内容 | 依赖 |
|---|---|---|---|
| T1 | 单用户模式 + meta | `OMO_AUTH_MODE`、固定本地用户注入、`GET /api/meta`、启动日志打印模式；Go 测试 | — |
| T2 | 任务删除 | `DELETE /api/tasks/{id}` + store.Delete + 归属校验；Go 测试 | T1 |
| T3 | Go RPC 分发器 | `internal/rpc`：JSON-Lines 读写、方法路由（复用 service 层）、错误码=HTTP 语义、`--stdio` 启动开关；测试 | T1、T2 |
| T4 | 引擎编排下沉 + RPC 入口 | `omo.sim`（编排）、`omo/rpc`（stdio 循环）、可选 extras、import 图测试；pytest | — |
| T5 | 前端传输抽象 + 门禁 | `transport.ts`（http/ipc）、`client.ts`、`meta` 启动拉取、无认证模式的守卫/UI 调整、历史页删除按钮 | T1、T2 |
| T6 | Host 层 | Go 子进程 stdio 客户端（id↔Promise/超时/重启）、引擎发现（D9）、Job Object 回收、单实例、日志捕获 | T3、T4 |
| T7 | Electron 壳 | 主进程窗口 + `app://` 协议 + 菜单（关于/数据目录/日志/诊断）+ preload + electron-builder 配置 | T6 |
| T8 | 轻量包 | `build-lite.ps1`、`setup-engine.ps1`、README 模板、无 Python 错误路径验证 | T3、T6 |
| T9 | 契约一致性 + 脚本 + CI | HTTP/RPC 一致性测试、`rpc-cli.ps1`、`build-desktop.ps1`、CI 六 job、体积门禁、Release | T1–T8 |
| T10 | 文档 | `desktop/README.md`、根 README"桌面版"章节、HANDOVER（产物/坑/模式说明）、`docs/api/rpc.md` | T9 |
| T11 | 净机验收 | 按 §10 两套清单逐项验证（含中文用户名机器、无端口检查） | T9 |

**里程碑**：M6-a（T1–T4：单用户 + RPC 三链路可手工联调）→ M6-b（T5–T7：桌面窗口可用、无端口）
→ M6-c（T8–T9：轻量包 + CI 产物 + 契约测试）→ M6-d（T10–T11：文档与净机验收，可对外分发）。

---

## 12. 后续选项（本期不做，设计已预留）

1. **自动更新**：`electron-updater` + 代码签名证书。
2. **便携模式**：数据目录可配置为程序同级（U 盘携带）。
3. **托盘常驻**：关窗不退出、引擎后台常驻。
4. **Tauri 备选**：按 Host 层接口切换壳（Go/Python/前端无需改动）。
5. **Web 版单进程部署**：给 Go 加 `internal/web`（embed dist，同源 HTTP）——与桌面无关，属 Web 部署优化。
6. **跨平台**：macOS/Linux 打包与签名（主要成本在验证与文档）。

---

## 13. 实现进度

| 任务 | 状态 | 说明 / 验证 |
|---|---|---|
| T1 单用户模式 + meta | ✅ 完成 | `OMO_AUTH_MODE=jwt\|none`、固定本地用户注入、`GET /api/meta`；Go 新增 7 个用例全绿；本地模式端到端冒烟（无 token 建任务 → `user_id=local`、Rs=3.9708 与 Web 一致；认证接口 401）；jwt 模式回归通过 |
| T2 任务删除 | ✅ 完成 | `DELETE /api/tasks/{id}`（归属校验统一 404）+ `Store.Delete`；新增 6 个 api 用例（成功/反推任务/不存在/跨用户/未认证/本地模式）+ 1 个 store 用例（二次删除 ErrNotFound） |
| T3 Go RPC 分发器 | ⏳ | 待做 |
| T4 引擎编排下沉 + RPC 入口 | ⏳ | 待做 |
| T5 前端传输抽象 + 门禁 | ⏳ | 待做 |
| T6 Host 层 | ⏳ | 待做 |
| T7 Electron 壳 | ⏳ | 待做 |
| T8 轻量包 | ⏳ | 待做 |
| T9 契约一致性 + 脚本 + CI | ⏳ | 待做 |
| T10 文档 | ⏳ | 待做（T1 的契约已先行写入 docs/api/rest.md） |
| T11 净机验收 | ⏳ | 待做 |

---

*本设计为第 3 稿评审件；确认后按 §11 拆解实现，并同步更新 AGENTS.md 里程碑与 HANDOVER。*
