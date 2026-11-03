# OMOPredict 交接报告（HANDOVER）

> 给**后续 agent** 的当前状态与续接指南。请先读本文件与 `AGENTS.md`（项目宪法），
> 再按需阅读下文文档索引中的对应文档。
> 最后更新：T9 完成（`start-local.ps1` + HTTP↔stdio 调试桥、`release-manifest.ps1` + tag 触发 release job）（2026-10）。

## 1. 项目一句话

OMO（氧化物/金属/氧化物）纳米多层薄膜仿真设计软件：三层架构
（Python 物理引擎 + Go 中间层 + Vue 前端），输入膜层参数 → 输出 T/Rs/SE，
并对标高水平论文实测数据 + 神经网络代理加速。

## 2. 里程碑完成度

| 阶段 | 状态 | 交付物 | 验证 |
|---|---|---|---|
| M0 | ✅ | uv 脚手架（engine/）、Go 骨架（server/）、CI | ruff/pytest + gofmt/vet/test 双流水线 |
| M1 | ✅ | omo.optics（TMM+Drude）/ electrical（方阻+FS）/ emi（屏蔽） | 44 测试，解析解对照 |
| M2 | ✅ | 对标框架 + 3 篇真实数据集 + 校准（calibrate.py） | 65 测试；校准训练损失 ↓92% |
| M2.5 | ✅ | NN 代理模型 v1（20k 训练，T/Rs/SE <0.1%） | 72 测试 |
| M2.5+ | ✅ | FastAPI omo.api（/simulate） | 72 测试 + uvicorn 冒烟 |
| M3 | ✅ | Go 用户/JWT + GORM 多库 + .env + 任务编排 | Go 全量测试 + **真实端到端冒烟** |
| M4 | ✅ | Vue3+TS+Vite 前端：登录/注册、参数设计、ECharts 结果图（T/Rs/SE）、任务历史 | vue-tsc + eslint 0 告警 + vite build 通过 + **浏览器代理端到端联调**（值对齐引擎契约示例） |
| M5 v1 | ✅ | omo.optimize 目标反推：target（硬约束）/ evaluate（引擎同源求值）/ search（网格扫描+FoM）/ sensitivity（逐层灵敏度+工艺窗口）+ `omo-cli optimize` | 19 测试（含候选回灌自洽）+ ruff 0；默认 4096 组合 ~3 s（含 SE） |
| M5 v2 API | ✅ | 引擎 `POST /optimize` 端点 + Go 任务模型泛化 `kind=simulate\|optimize`（`optimize_result` 原样持久化） | 6 引擎测试 + 5 Go 测试新增；真实端到端冒烟（建 optimize 任务→轮询→候选/FoM/灵敏度） |
| M5 v2 前端页 | ✅ | 前端「目标反推」页（`frontend/src/views/OptimizeView.vue` + `/optimize` 路由：kind=optimize 表单 + 候选表 + 灵敏度展示）+ 悬浮帮助文案 | `vue-tsc -b` + eslint 0 告警 + `vite build` 通过 |
| M5 余 | ⏳ | 报告导出、遗传/贝叶斯寻优、NN 代理加速 | 待做 |
| M6-a T1 | ✅ | 桌面版基础：单用户认证模式（`OMO_AUTH_MODE=none`）+ `GET /api/meta` 能力端点 | Go 全量测试（新增 7 用例）+ 本地模式端到端冒烟（无 token 建任务，`user_id=local`）+ jwt 模式回归 |
| M6-a T2 | ✅ | 任务管理：`DELETE /api/tasks/{id}`（归属校验，两种 kind 均可删） | 新增 6 个 api 用例 + 1 个 store 用例（二次删除 ErrNotFound）；本地模式冒烟删除链路 |
| M6-a T3 | ✅ | stdio JSON-RPC 分发器（`internal/rpc` + `omopredict --stdio`）：ping/meta/tasks.*、错误码=HTTP 语义、`internal/mode`/`task.CreateRequest`/`GetOwned` 作为两传输单一来源 | 新增 rpc 12 用例 + 契约一致性 5 用例（HTTP↔RPC 载荷逐字段比对）；真实 stdio 会话冒烟通过；顺带修复 **GORM 默认日志写 stdout 破坏协议** 的坑（见 §6.15） |
| M6-a T4 | ✅ | 引擎侧：中立编排层 `omo.sim`（Web/桌面共用）+ `omo/rpc`（stdio JSON-RPC 入口）+ 可选依赖化（extras: api/neural/plot，基础仅 numpy/scipy） | 新增 35 测试（sim 领域校验 10 + rpc 协议/一致性 25），含 **import 图测试**（子进程断言不导入 torch/matplotlib/fastapi/uvicorn/pydantic）与 RPC↔HTTP 载荷一致性；python 全量 128 passed |
| **M6-a T4.5** | ✅ | **Go 侧 stdio 引擎传输**：`Engine` 接口（HTTP/stdio 同契约）+ `StdioEngine`（惰性子进程、id↔响应、超时、进程退出即在途失败、优雅关闭）+ `ResolveEngineCommand`（D9 1–4 级）；`OMO_ENGINE_TRANSPORT/OMO_ENGINE_CMD/OMO_ENGINE_PROJECT/OMO_ENGINE_TIMEOUT` | 新增 12 Go 测试（假引擎子进程走真实管道：仿真/反推往返、422 透传、超时、中途退出、Close 幂等、四级解析、引号切分、乱序关联、**stdio↔HTTP 载荷逐字节一致**）；真实端到端冒烟：Rs=3.970819 / T@550nm=0.974497 / SE@10GHz=33.7036（与 REST 契约一致）+ **进程树无监听端口、运行期间无新增监听端点** + 退出无残留 |
| **M6-a T5** | ✅ | **前端传输抽象 + 能力门禁**：`api/transport.ts`（`Transport` + 方法→端点映射 + http/ipc 两实现 + `activeTransport()` 检测 `window.omo`）、`api/client.ts`（401 横切）、`api/token.ts`、`api/meta.ts`；`main.ts` 挂载前拉 `meta`，auth store 增 `authRequired`/`isLocalMode`，路由守卫无认证模式放行并重定向 `/login`，顶栏「本地模式」标记；历史页新增删除（两段式内联确认） | `pnpm lint` 0 告警 + `pnpm build`（`vue-tsc -b` + `vite build`）通过；**契约层实测**：jwt 模式 `auth_required=true` 且无 token 访问任务接口 401，none 模式 `auth_required=false`、无 token 建任务（`user_id=local`）、`DELETE` → `{id,deleted:true}`、删后 404 |

| **M6-b T6** | ✅ | **桌面 Host 层**（`desktop/src/host/`，**Electron 无关的纯 Node 模块**）：`paths`（D6 数据/日志目录，按目标平台选路径语义）、`logger`（D7 按天日志+保留 7 天，目录不可用则退化为仅回显）、`lines`（JSON-Lines 分帧）、`rpc`（id↔Promise、超时、错误码=HTTP 语义、非法行只报协议错误）、`backend`（spawn/ping/日志捕获/**退出即失效在途请求**/限速重启/超时强杀进程树/stdout 污染容忍）、`engine`（只做 Go 看不到的来源探测 + D9 第 5 级指引）、`singleton`（文件锁）、`host`（组装并注入 D6 环境变量，默认 `OMO_ENGINE_TRANSPORT=stdio`） | `tsc --noEmit` 干净；**91 单测 + 1 集成测试**（真子进程走真管道：分帧/乱序关联/超时/崩溃即在途失败/重启限速/启动失败不重启/锁回收/日志轮转）；**真实端到端**：Host → Go `--stdio` → 真实引擎 → Rs≈3.9708 / T@550nm≈0.9745 / SE@10GHz≈33.70 + **后端无监听端口** + 退出无残留 |

| **M6-b T7** | ✅ | **Electron 壳**：`src/main.ts`（主进程接线：单实例锁 + 聚焦已有窗口、`app://` 协议、菜单、IPC、`will-quit` 回收后端）、`src/preload.ts`（contextBridge **白名单**）、`src/shell/`（与 Electron 解耦的壳逻辑：`appProtocol` app:// 解析 + 目录穿越防护 + CSP/安全头、`channels` IPC 通道与**结果信封**（避免 Electron 压掉 Error 的 `code`）、`preloadBridge`、`menu`、`windowOptions` 安全基线、`backendCommand` 打包/开发期定位、`diagnostics` 脱敏）、`package.json` 的 electron-builder 配置 | `tsc --noEmit` 对**真实 Electron 类型**干净（校验 app/BrowserWindow/protocol/Menu/ipcMain 全部用法）；桌面测试 **13 文件 193 用例**（app:// 穿越 5 变体、CSP 无网络、IPC 信封跨进程、菜单/窗口安全基线、诊断脱敏、**调试桥路由/静态托管**）；集成测试新增**渲染进程可见链路**（`window.omo.rpc` → 信封 → 真实 Go → 真实引擎，含跨进程 404）；**壳已实跑通过**（2026-10，见 §6.35） |

| **M6-c T8** | ✅ | **轻量包**：`scripts/setup-engine.ps1`（uv → pip 两条安装路径 + 发 ping 验证；**任何失败都落进统一的"可操作指引"块**）、`scripts/build-lite.ps1`（渲染产物 + Go 后端 + 引擎源码 + setup 脚本 + README → **体积门禁** → zip；`-AllowMissingShell` 无壳时只暂存并**退出 2**）、`desktop/lite/README.txt` 模板、`scripts/README.md`；CI 加 `packaging` job | 两脚本**实跑**：setup-engine 四条路径（指定解释器 / uv 分支 / 目录非法 / 解释器不存在）全过；build-lite 暂存（退出 2）/完整出包（退出 0，13.9MB）/门禁拦截（退出 1）；集成测试新增**引擎不可用**用例（真实 Go + 不存在解释器 → 任务 `failed`，错误点名失败的命令）。**体积门禁已决**：轻量包保留 Electron → 整包上限由 50MB 放宽到 150MB，另加 **app payload ≤50MB** 紧门禁防依赖泄漏（见 §7 T8 块） |

| **M6-c T9** | ✅ | **契约 + 脚本 + CI + 发布**：`scripts/rpc-cli.ps1`（stdio 调试客户端）、`scripts/build-desktop.ps1`（完整包 + PyInstaller onedir sidecar + 三道门禁）、壳 TS 编译管线、**`scripts/start-local.ps1` + `local-bridge.mjs`（HTTP↔stdio 调试桥）**、**`scripts/release-manifest.ps1`（SHA256 清单 + `-Verify`）**、CI `desktop`/`packaging` 补齐、**tag 触发的 `release` job** | 脚本全部**实跑**：rpc-cli 四种情形；build-desktop `-SkipPackaging`（engine dir 165.64MB / payload 27.09MB / 退出 2）且 sidecar 真能算（3/3）；**start-local 全链路**：`/health`、`/api/meta`、建任务 → **Rs=3.970819 / T@550nm=0.974497 / SE@10GHz=33.7036**、SPA 回退、删除任务、退出无残留；**release-manifest**：生成 → 校验通过 → 篡改必失败 → 空/缺目录退出 1。桥核心 **33 单测**。⏳ 未做：electron-builder 实跑与完整包进 Release（属 T11，需 Windows GUI 目标） |

测试现状：Python **132 passed / ruff 0**（2026-09 文件权限修复后不再有 tmp_path 报错，见 §6.22；此前记录的"128 passed + 4 个 PermissionError"已过时）；Go 全量测试通过（api/model/store/user/task，含 optimize 任务流、单用户模式与 **12 个 stdio 引擎用例**）；前端 `pnpm lint` 0 告警 + `pnpm test`（**vitest：5 文件 60 用例**）+ `pnpm build`（`vue-tsc -b` + `vite build`）通过；桌面 `desktop/`：`pnpm type-check`（含真实 Electron 类型）+ `pnpm build`（main ESM / preload CJS）+ `pnpm test`（**13 文件 193 用例**，其中 33 个覆盖 `scripts/local-bridge-lib.mjs`，
另有 3 个需环境变量门控的真实端到端集成用例，已实跑通过——包括对着 **PyInstaller 打出的 sidecar** 跑）通过；
`scripts/` 六个脚本本机实跑过（见 §7 的 T8/T9 块；本机没有 `pwsh`，见 §6.40）。

## 3. 三层架构与启动

```bash
# Python 引擎（omo.api，FastAPI）：默认 :8000（本机 8000 可能被占，见 §6）
cd engine && uv run uvicorn omo.api.main:app --port 8010

# Go 中间层：默认 :8080，读取 server/.env（OMO_ENGINE_URL 指向引擎）
cd server && go run ./cmd/omopredict

# 前端：默认 :5173，/api 代理到 Go :8080（OMO_SERVER_URL 可覆盖目标）
cd frontend && pnpm install && pnpm dev

# 端到端流程：浏览器开 http://localhost:5173 → 注册/登录 → 参数设计 → 提交任务
#   → 结果页轮询 → ECharts 渲染 T(λ)/R(λ) 曲线 + Rs 卡片 + SE(f) 曲线
#   （等价 REST 流程：POST /api/auth/register → /login 拿 token → POST /api/tasks（202 异步）
#   → 轮询 GET /api/tasks/{id} 直到 succeeded，result 含 T(λ)/R(λ)/Rs/SE(f)）
```

## 4. 代码库速览

**engine/src/omo/**（Python，Go 式包划分）：

| 包 | 内容 |
|---|---|
| constants.py | CODATA 常数（含来源） |
| materials.py | **共享材料解析**：MaterialResolver + 覆盖类型（benchmark/校准/API 同源） |
| sim.py | **中立编排层**（M6-a T4）：SimulateSpec/OptimizeSpec + 领域校验 + `simulate()`/`optimize()`；Web/桌面共用，只依赖物理子包与 numpy |
| optics/ | TMM（transfer_matrix.py）、Drude（drude.py）、常数材料（materials.py） |
| electrical/ | sheet_resistance.py（并联+FS）、materials.py（ρ/λ） |
| emi/ | shielding.py（传输线+Schelkunoff+薄膜近似）、materials.py |
| benchmark/ | schema/materials(已迁出)/runner/metrics/report/calibrate |
| neural/ | data.py（引擎生成数据）、model.py（MLP）、validate.py |
| api/ | schemas.py / service.py / main.py（FastAPI **/health + /simulate + /optimize**；service 已变薄，编排在 omo.sim） |
| rpc/ | **stdio JSON-RPC 传输层**（M6-a T4）：JSON-Lines + JSON-RPC 2.0、`ping`/`simulate`/`optimize`、应用错误 422、协议用保留码 |
| cli/ | omo-cli（--version/--info；**optimize 子命令已实现**；simulate 子命令待做） |
| optimize/ | **M5 v1 完成**：target.py（DesignTarget 硬约束）/ evaluate.py（CandidateMetrics，引擎同源求值）/ search.py（OmoSearchConfig + 网格扫描 + FoM 排序）/ sensitivity.py（逐层灵敏度 + 工艺窗口） |

**server/internal/**（Go）：api（路由+认证+任务 handler；**运行模式 `OMO_AUTH_MODE=jwt|none` 与 `GET /api/meta`**、**`DELETE /api/tasks/{id}`**）、user（bcrypt+JWT+GORM）、
model（FilmStack/SimulationTask(TaskKind)/TaskResult/OptimizeSpec）、store（GORM Open/Migrate/.env；**日志默认写 stderr** 以保护 stdio 协议）、
mode（运行模式解析：`jwt|none`、`http|stdio`）、rpc（**stdio JSON-RPC 分发器**，M6-a T3；`contract_test.go` 与 HTTP 逐字段比对）、
task（`Engine` 接口 + 两种引擎传输 + **kind=simulate|optimize 异步编排**）。
task 包内与引擎相关的三个文件：`engine.go`（`Engine` 接口 + HTTP 实现 `EngineClient` + 共用的 `simulateParams`）、
`engine_stdio.go`（**stdio 实现 `StdioEngine`**，T4.5）、`engine_resolve.go`（引擎启动命令解析，D9 1–4 级）。

> ✅ **Go→引擎 stdio 传输已实现（T4.5）**：`OMO_ENGINE_TRANSPORT=stdio` 时 Go 作为父进程拉起引擎
> （`OMO_ENGINE_CMD` 或 D9 自动发现），全程**不监听端口**——已实测满足 docs/desktop.md §10.6。
> 解析失败时**启动即退出**（不静默回退 HTTP，否则会违背"无端口"）；`Engine` 接口让 HTTP/stdio
> 共用同一载荷构造，两种传输的数值结果一致。

**frontend/**（Vue 3 + TS，M4 完成；M5 v2 增「目标反推」页；**T5 增传输抽象与能力门禁**）：
`src/api/`（**`transport.ts`：`Transport` 抽象 + 方法↔端点映射 + http/ipc 两实现 + `activeTransport()` 依 `window.omo` 选传输**、
`client.ts`（统一入口，401 → 清凭证 + 广播 `omo:unauthorized`）、`token.ts`（凭证）、`meta.ts`（能力端点）、auth/tasks 接口）、
`src/stores/auth.ts`（Pinia：token/user + **`authRequired`/`isLocalMode`/`bootstrap()` 门禁**）、
`src/router/`（守卫：启动先 `bootstrap()`，无认证模式放行全部页面并把 `/login` 重定向到 `/design`）、
`src/views/`（Login/Design/**Optimize**/TaskDetail/History——历史页含**删除**：两段式内联确认）、`src/components/`（SpectrumChart/SeChart/StatusBadge/**HelpTip**）、
`src/content/`（help.ts 悬浮文案、materials.ts 材料预设）、`src/composables/useEChart.ts`（ECharts 按需注册 + 生命周期）、`vite.config.ts`（/api 代理到 Go :8080）。
`main.ts` 在挂载前先 `auth.bootstrap()`（避免单用户模式下闪一下登录页）。
**IPC 契约**（由 T6/T7 的 preload 实现）：`window.omo.rpc(method, params)`，失败 reject 带 HTTP 语义 `code`；
`window.omo` 缺席即视为 Web 形态走 HTTP。

**desktop/**（T6 Host 层 + T7 壳，见 `desktop/README.md`）：
- `src/host/`（T6，**Electron 无关**，故可纯 Node 单测）：`paths`/`logger`/`lines`/`rpc`/`backend`/`engine`/`singleton`/`host`；
- `src/shell/`（T7，同样与 Electron 解耦）：`appProtocol`（`app://` 解析 + 目录穿越防护 + CSP/安全头）、
  `channels`（IPC 通道 + 结果信封 + preload 侧还原）、`preloadBridge`、`menu`、`windowOptions`、
  `backendCommand`（打包/开发期后端定位）、`diagnostics`（脱敏）；
- `src/main.ts` / `src/preload.ts`：**极薄的 Electron 接线**，靠 `tsc --noEmit` 对真实 Electron 类型校验；
- `test/fixtures/fake-backend.mjs`：真子进程假后端；`src/host/integration.test.ts` 是环境变量门控的真实端到端测试
  （`OMO_BACKEND_EXE` + `OMO_ENGINE_CMD`，受限环境再加 `OMO_INTEGRATION_DIR`），
  其中第二个用例覆盖**渲染进程可见链路**（`window.omo.rpc` → IPC 信封 → 真实后端）。
- ✅ **壳已实际启动并验证通过**（2026-10，见 §6.35）：窗口建起来、`app://omo/index.html` 渲染成功、
  CSP 生效且**没有误伤**、preload 注入成功、`window.omo.rpc('meta')` 拿到后端真实数据
  （`auth_mode: none`、`engine_transport: stdio`），退出干净。
  一条命令可复现：`powershell -ExecutionPolicy Bypass -File scripts\smoke-desktop.ps1 -SkipBuild`
  （成功打 `[smoke] OK` + `[smoke] BRIDGE OK` 并退 0）。
  过程中修掉的四个"只有真跑才会发现"的 bug 见 §6.35；本机需要 `ELECTRON_DISABLE_SANDBOX=1`
  的机器级原因见 §6.31（脚本会**自动**处理并如实标注）。

## 5. 文档索引

| 文档 | 内容 |
|---|---|
| `AGENTS.md` | 项目宪法：架构/物理模型/守则/里程碑 |
| `docs/physics/{tmm,electrical,emi}.md` | 物理模型与公式来源 |
| `docs/benchmarks/README.md` + `calibration.md` | 数据集格式 + 校准方法/结果 |
| `docs/api/README.md` + `rest.md` + `engine.md` + `rpc.md` | API 契约（对外 REST / Go→Python 引擎 / 桌面 stdio JSON-RPC） |
| `engine/README.md`、`server/README.md`、`frontend/README.md`、各包 README | 层与包说明 |

## 6. 环境与已知坑（续接前必读）

1. **Go 模块代理**：本机在中国大陆，`proxy.golang.org` 不通。拉依赖用
   `$env:GOPROXY = "https://goproxy.cn,direct"`（命令级，**未改动机器全局配置**）。
2. **CGO_ENABLED=0**：本机全局 go env 配置为此值（非本项目所改）。所有 Go 依赖必须纯 Go：
   SQLite 用 `glebarez/sqlite`（禁止 mattn/go-sqlite3）。
3. **端口 8000 被占**：本机某外部进程（PID 28884 之类，绑定 0.0.0.0 且有外连）独占 8000。
   冒烟/联调用 **8010** 或先查 `Get-NetTCPConnection -LocalPort 8000`。
4. **环境变量名**：数据库配置是 `OMO_DB_DSN`（**不是** OMO_DB_PATH）+ `OMO_DB_DRIVER`；
   引擎地址 `OMO_ENGINE_URL`；JWT `OMO_JWT_SECRET`/`OMO_JWT_TTL`。配置优先级：环境变量 > server/.env > 默认。
5. **uv 沙箱**：本环境 uv 缓存指向工作区 `.uv-cache/`、`.uv-python/`（已 gitignore）；
   `uv run` 前需设 `$env:UV_CACHE_DIR` / `$env:UV_PYTHON_INSTALL_DIR`（或已 full access 时用默认）。
6. **PowerShell 中文乱码**：终端 GBK 显示问题，文件本身 UTF-8，勿据此修改文件。
7. **Go 测试**：GORM/SQLite 临时库必须 `t.Cleanup` 关闭，否则 Windows 文件锁导致 TempDir 清理失败。
8. **校准数值病态**：calibrate 在 log₁₀ 空间优化（Ag ρ≈1e-8 与 λ≈50 尺度差异大，
   直接优化会在 CI/不同 BLAS 下 ABNORMAL——已在代码注释说明）。
9. **已知模型边界**：薄 Ag（<10nm）渗流效应超出 FS 模型（Voronin 数据验证集误差显著）；
   Al 光学常数取近似（Palik，待校准）；In₂O₃ 层厚仅在图 3e（未提取，T 对标受限）。
10. **SE(f) 平线不是 bug**：薄导电膜（d ≪ δ）SE ≈ 20·log₁₀(1+Z₀/2Rs) 与频率无关
    （Rs 在 1–18 GHz 恒定），真实文献同样平坦（Voronin 2025：25–30 dB 覆盖
    10 MHz–1 THz）。要看到频率上升需用厚金属层（d ≳ δ 时 SE_A ∝ √f，
    如 Ag 3µm：92→125 dB）。详见 `docs/physics/emi.md` §4.1（FAQ 说明）。
10. **npm 源**：本机 npm registry 已是 npmmirror（`npm config get registry`），pnpm 安装正常。
11. **pnpm 11 + 受限环境**：pnpm 11 的 settings 在 `pnpm-workspace.yaml`（package.json 的 `pnpm` 字段已废弃）；
    esbuild 构建脚本在 `allowBuilds` 中显式关闭（二进制由 optionalDependencies 提供）。
    沙箱内 `vite build`/`vite dev` 因 esbuild IPC 需完整文件权限；CI（Linux）无此限制。
12. **curl.exe 传参坑**：本机 PowerShell → curl.exe 传 `-d '{...}'` 会被剥引号导致 JSON 损坏，
    联调一律用 `--data-binary "@文件"`（或 Invoke-RestMethod）。
13. **Vite 绑定**：dev server 绑定 IPv6 `::1`，浏览器/联调用 `http://localhost:5173`（127.0.0.1 不通）。
14. **前端类型检查**：`vue-tsc` 须用 `-b`（build 模式）才会真正检查引用项目（`--noEmit` 直接跑会静默跳过）；
    模板字符串 `ref="x"` 不计为 setup 变量读取（TS6133），组件容器 ref 请传入 composable 并在 JS 中读取。
15. **stdout 是协议流（stdio 模式）**：`omopredict --stdio` 下 stdout 只允许 JSON-RPC 行。
    **GORM 默认把日志写 stdout**，会把 SQL 日志混进协议流（实测导致 `tasks.get` 响应被日志行挤掉）；
    已在 `store.Config.LogWriter` 中默认改为 stderr，并有回归测试守护。
    新增任何依赖/日志时都要确认不往 stdout 打印（含第三方库默认行为）。
16. **stdio 冒烟要用长驻会话**：PowerShell 的管道（`& { ... } | exe`）不是流式交互，会把多行一次性喂完并立即 EOF，
    导致异步任务随进程退出而停留在 `pending`。验证异步链路请用 .NET `Process` 保持 stdin 打开（见 T3 冒烟脚本思路），
    或直接用 `internal/rpc` 的单测（内部 `Serve` + 真实 SQLite/假引擎）。
17. **uv extras 会被精确同步（易踩）**：引擎的基础依赖只有 numpy/scipy，fastapi/pydantic/uvicorn（`api`）、
    torch（`neural`）、matplotlib（`plot`）都在 extras 里。`uv run` 默认按 extras **精确同步**环境，
    未显式带 `--extra/--all-extras` 时会把它们**从 .venv 移除**，导致 `import fastapi`/pytest 报缺失。
    → 跑测试/联调前先 `uv sync --all-extras`，或用 `uv run --all-extras pytest`；CI 已用 `--all-extras`。
18. **Python 子进程可用**：本沙箱允许 `subprocess.run(..., capture_output=True)`（与 Node 的管道限制不同），
    因此 `tests/test_rpc.py` 的 import 图测试可以真在子进程里 `import omo.rpc` 并检查 `sys.modules`。
19. **⚠️ `.ps1` 脚本里的中文注释会"吃掉"下一行代码（本机必读）**：中文 Windows 上 PowerShell 5.1
    读取**无 BOM** 的 `.ps1` 时按 **GBK(cp936)** 解码，而不是 UTF-8。若某行中文注释的末尾字节在 GBK 下
    与随后的 `CR` 组成一个字符对，**换行会被吞掉**，于是下一行代码被并入注释而**静默失效**
    （实测：一行中文注释使其后的 `$psi.EnvironmentVariables['OMO_ENGINE_CMD'] = ...` 整行失效，
    而 PowerShell 解析器报 **0 个错误**，极难发现）。
    → 写 `.ps1` 时：**注释一律用 ASCII**，或把文件存为 **UTF-8 with BOM**。
    （本沙箱的 `pwsh` 不存在，脚本由 Windows PowerShell 5.1 执行，故该坑真实存在；与 §6.6 的"终端乱码"是两回事。）
20. **stdio 引擎启动命令与发现（T4.5）**：`OMO_ENGINE_CMD` 支持引号包裹含空格的路径
    （如 `"C:\Program Files\Python312\python.exe" -m omo.rpc`）；未设置时按
    `resources/engine/omo-rpc[.exe]` → `uv run --frozen --project <engine>` → PATH `python`/`python3`/`py` 依次发现，
    引擎工程目录由 `OMO_ENGINE_PROJECT` 指定或推断为 `resources/engine`（须含 `pyproject.toml`），
    并作为子进程工作目录。**解析失败会在启动时直接退出并打印指引**（不再静默走 HTTP）。
    单次调用超时用 `OMO_ENGINE_TIMEOUT`（默认 60s）；大规模网格反推需调大。
21. **验证 stdio 异步链路**：`tasks.create` 是异步的，**用 PowerShell 管道喂完就 EOF**，任务会随进程退出停在
    `pending`（§6.16）。要真验证，必须用 .NET `Process`（`RedirectStandardInput`）保持 stdin 打开并轮询
    `tasks.get`；`StdioEngine` 的 Go 单测用"本测试二进制自身当假引擎"（`-test.run=TestStdioHelperProcess`
    + `os.Exit`，避免 testing 框架把 PASS 写进协议流）也是同一思路。
22. **⚠️ 工作区文件权限会整体失效（2026-09 已修，复发时按此处理）**：曾出现连 `pnpm`、`New-Item`、
    `Set-Content` 都报 `拒绝访问`/`SetNamedSecurityInfoW failed (Win32 5): grantWrite(<工作区>)` 的情况——
    实测根因是**工作区根目录缺少当前用户的"取得所有权"权限**，导致沙箱无法为工作区授予写权限。
    修复方式（每个**失败路径**各跑一次）：用 DSH 的 Windows 沙箱 ACL 诊断脚本，以
    `-Path <失败路径> -AllowRoot <工作区根> -Out <工作区旁的持久目录>` **非受限**运行；脚本会备份原权限、
    补上当前用户完全控制、清理其它应用包权限项，并打印逐条回滚命令。
    - 只修根目录**不够**：`frontend/` 这类子目录需要单独再跑一次（本仓库两次才修好）。
    - 修复后 `node_modules/.tmp/tsconfig.*.tsbuildinfo` 才能写入，`vite build` / `pnpm` 才可用（§6.11 的部分表现即此）。
    - **附带收益**：此前记为"环境限制"的 4 个 Python `tmp_path` 用例报错一并消失，Python 由 128 passed(+4 errors)
      变为 **132 passed**（§2）。
    - 报告留在 `D:\PyLearn\omo-acl-recovery\acl-report-*.jsonl`；回滚用同目录的 `acl-backup-*.json.ps1`。
23. **⚠️ 本沙箱下 `%TEMP%` 写不了 SQLite（T6 实测）**：把 Go 后端的 `OMO_DB_DSN` 指到
    `%TEMP%\...db` 时，modernc sqlite 会报 `unable to open database file: out of memory (14)`
    （数字 14 是 SQLITE_CANTOPEN，提示语有误导性），**与代码无关**——同一二进制把 DSN 放到工作区内就正常。
    同类现象还有 Go 遥测写 `%APPDATA%\go\telemetry` 被拒（§6.2 的注释与 Go 测试输出）。
    → 在受限环境里跑集成测试/冒烟时，把数据目录指到工作区内：
    `desktop` 的集成测试支持 `OMO_INTEGRATION_DIR=<工作区内目录>`；桌面应用自身默认用
    `%LOCALAPPDATA%\OMOPredict`（真实用户机器上可写，仅本沙箱受限）。
24. **⚠️ PowerShell 5.1 读 UTF-8（无 BOM）会当 ANSI 解（T8 实测）**：`Get-Content -Raw` 读含中文的
    `desktop/package.json` 时得到乱码，`ConvertFrom-Json` 直接抛 `ArgumentException`，而不是给出可读错误。
    **凡读文本都显式 `-Encoding UTF8`**（写用 `Set-Content -Encoding UTF8`）。与 §6.19 同族：
    本机 `pwsh` 实为 Windows PowerShell 5.1，而 5.1 的默认编码是老代码页。
25. **⚠️ `Join-Path` 在 PS 5.1 只能给一个子路径（T8 实测）**：`Join-Path $a 'b' 'c'` 在 PS 7 上靠
    `-AdditionalChildPath` 可用，在 5.1 上会报 `A positional parameter cannot be found that accepts argument 'c'`
    ——而且**只在执行到那一行时才炸**（`setup-engine.ps1` 的候选路径分支就是这样：传 `-EngineDir` 一切正常，
    走自动发现才暴露）。多段路径写成 `Join-Path $a 'b/c'`；顺带用正斜杠还能让脚本在 Linux/macOS 上跑
    （CI 的 `packaging` job 就是这么跑的）。
26. **⚠️ 脚本退出码要当契约用（T8）**：`build-lite.ps1` 用 **0 出包 / 1 失败 / 2 仅暂存** 三态，
    避免"没有 Electron 壳却报告成功"。CI 用 `pwsh -NoProfile -File <script>`（**新进程**）调用，
    这样 `$LASTEXITCODE` 才是脚本真值——同进程里 `./script.ps1` 遇到 `exit` 的行为容易误判。
27. **⚠️ `Get-ChildItem -Recurse -File` 传单个文件会重复计数（T8 实测）**：想量一个文件的大小时
    它会返回两次，得到 2× 的值（曾据此误判 Go 后端 26.4MB 为 52.8MB）。量文件用 `Get-Item`，
    量目录才用 `Get-ChildItem -Recurse`；脚本里的体积门禁只作用于目录，因此不受影响。
28. **⚠️ PowerShell 变量大小写不敏感，会和参数"撞名"（T9 实测）**：写了 `param([ValidateSet(...)][string] $Target)`，
    又在函数里 `$target = Resolve-Target` → 两者是**同一个变量**，赋值直接触发 ValidateSet 校验失败，
    报的是 `System.Collections.Hashtable is not a valid value for the Target variable`（完全看不出根因）。
    局部变量名要避开参数名（哪怕只差大小写），如 `$endpoint`。
29. **⚠️ `-f` 格式化遇到 JSON 字面量会炸（T9 实测）**：`'{"jsonrpc":"2.0","method":"{0}"}' -f $m` 里的 `{`/`}`
    被当成格式占位符，报 `Error formatting a string: Input string was not in a correct format`。
    拼 JSON 用字符串拼接（或把花括号写成 `{{`/`}}`），别用 `-f`。
30. **⚠️ `ProcessStartInfo.ArgumentList` 在 Windows PowerShell 5.1 上不存在（T9 实测）**：它是 .NET Core 2.1+ 的
    API，5.1 跑在 .NET Framework 上，取到的是 `$null`，`.Add()` 于是报
    `You cannot call a method on a null-valued expression`。改用 `$startInfo.Arguments = '<带引号的整串>'`
    并自己给含空格的参数加引号。同理，`add_OutputDataReceived` 这类事件式读取不如
    `$process.StandardOutput.ReadLineAsync()` + `Task.Wait(ms)`、`StandardError.ReadToEndAsync()` 可靠
    （stderr 要**并发**抽干，否则管道写满会把子进程卡死）。
31. **⚠️ Chromium 起不来：真正的根因（2026-10 实测，"沙箱背锅"是错的）**：这里先后写错过两次结论，
    把最终确证的**证据与判据**留下，避免第三次误判。
    - 症状（本机、沙箱内外**完全一致**）：默认启动 `0x80000003`（STATUS_BREAKPOINT / -2147483645）
      且**零输出**；加 `--no-sandbox` 则 `0xC0000005`（ACCESS_VIOLATION / -1073741819），
      死在 `app.whenReady()` 之前。`--disable-gpu` / `--in-process-gpu` / `--single-process` /
      `--no-zygote` / `--use-angle=swiftshader` 全都无效。
    - **先排除的就是沙箱**：用户在一个**真正的独立窗口**（`WindowsTerminal.exe` 为父进程、
      `ELECTRON_RUN_AS_NODE` 为空、无 `DSH_*`）里复现了**同一套退出码**。所以这不是 DSH 特有的。
      → 判据：`scripts/diagnose-electron.ps1` 会打印进程链，链子走到 `explorer.exe`/`WindowsTerminal.exe`
      才算"在外面"，走到 `DeepSeek Harness.exe` 就是沙箱内。
    - **已排除**：操作系统版本（本机 Win11 23H2 / 22631，受支持）；第三方杀软（只装了 Defender，
      且实时保护是关的）；IFEO 调试器劫持（无）；系统级 Exploit Protection（未设置）；
      WDAC/SAC 拦截记录（CodeIntegrity 日志里没有我们的二进制）；二进制损坏
      （缓存 zip 的 SHA256 与官方 `11c3958…cb5d` **一致**，且 `--version --no-sandbox` 能跑）。
    - **`libEGL.dll` / `libGLESv2.dll` 缺失是个假线索**：官方 zip 里本来就没有这两个文件
      （Chromium 已不再单独分发），别再追。
    - **实测出来的两个真原因**（见 §6.35 的四个 bug）：
      1. **user-data 目录不能缺失**：目录预先存在 → 5/5 正常；不存在（让 Chromium 自己建）→ 0/5 崩，
         而且**它建不出来**。本机 `%APPDATA%\OMOPredict`、`%APPDATA%\omo-mini` 都不存在。
      2. **Chromium 的进程沙箱本身起不来**：即便 profile 目录就绪，只要**不**加 `--no-sandbox`
         （或 `ELECTRON_DISABLE_SANDBOX=1`）就仍然 `0x80000003`；加上就能跑。
         日志里能看到它想建 `GPUPersistentCache` 子目录时拿到 **拒绝访问 (0x5)**。
    - **可用的判定/绕过**：`$env:ELECTRON_DISABLE_SANDBOX='1'`（**环境变量**在 Chromium 初始化前生效，
      所以是应用内代码救不了的场景下唯一可用的开关；`app.commandLine.appendSwitch` 太晚了）。
    → 一条命令判定：`powershell -ExecutionPolicy Bypass -File scripts\smoke-desktop.ps1 -SkipBuild`
      （成功打印 `[smoke] OK` + `[smoke] BRIDGE OK` 并退出 0）。**本机实测已 PASS**（脚本自动重试）。
32. **⚠️ `ELECTRON_RUN_AS_NODE=1` 已预设在本会话环境里（2026-10 实测）**：进程环境里有这个变量时，
    `electron.exe` 会**当成纯 Node 运行**——`electron --version` 打印的是 **Node 版本**（如 `v24.21.0`）
    而不是 Electron 版本，且 `require('electron')` 拿不到 `app`/`BrowserWindow`，报错会非常难懂。
    → 启动壳之前先 `Remove-Item Env:ELECTRON_RUN_AS_NODE`。判定真实版本看
    `node_modules/electron/dist/version` 或 exe 的 VersionInfo（应为 `44.4.5`），别信 `--version`。
    注意它是**逐进程注入**的（不在 HKCU/HKLM 注册表里），所以真正独立的窗口里一定是空的。
33. **⚠️ 下载 Electron / 走镜像的取舍（2026-10 实测）**：`npmmirror.com` 在本机**超时不可达**
    （设计文档 §7 建议的 `ELECTRON_MIRROR` 反而会让 `install.js` 直接 `fetch failed`）；
    而 `github.com` 正常，用**默认源**下载 `electron-v44.4.5-win32-x64.zip`（约 115MB）成功、
    解包后 `dist` 约 **367MB**，耗时约 5 分钟。所以"拉不动"的结论要按**源**分别试，不要一概而论。
    缓存实际在 `%LOCALAPPDATA%\electron\Cache\<sha256>\electron-v44.4.5-win32-x64.zip`
    （**哈希子目录里**，直接列 Cache 根目录会以为它是空的）；且它是全局共享的，可能有别的项目的 zip。
    ⚠️ **`pnpm install` 会重建 node_modules 从而删掉 Electron 的 dist**（其安装脚本按策略被跳过：
    见 desktop/pnpm-workspace.yaml 的 allowBuilds），恢复用 `node node_modules/electron/install.js`
    （有缓存时 3 秒）。smoke 脚本已内置这一步。
34. **⚠️ 多会话共用一个工作区，提交会互相"扫走"（2026-10 实测）**：本仓库同时被另一个 agent 会话操作，
    它用类似 `git add -A` 的方式提交（`06de9d8 docs: make the English README the primary one` 里
    **混进了我当时未提交的 `main.ts` 冒烟钩子 +35 行**）。因此：**改完就尽快单独提交自己的文件**，
    且提交时**显式列出路径**，不要 `git add -A`，否则会把别人未完成的改动卷进自己的提交。
    另外它把 `.smoke/` 加进了 `.gitignore`（`0c2c063`）——这个忽略项**建议保留**（见 §6.35）。
35. **✅ Electron 壳已实跑通过（2026-10，T11 核心项）**：`scripts/smoke-desktop.ps1 -SkipBuild` → exit 0，
    输出 `[smoke] OK` + `[smoke] BRIDGE OK: window.omo.rpc('meta') -> {"version":"0.1.0","auth_mode":"none",
    "auth_required":false,"engine_transport":"stdio"}`，即**渲染进程 → preload → IPC → 主进程 → Host →
    Go 后端 → 引擎**全链路打通（`meta` 是后端真返回的数据），退出干净（`code=0 expected=true`）。
    首次真跑一次性暴露了**四个只有真跑才会发现的 bug**（都已修）：
    1. **主进程 ESM 产物加载不了**：tsc 的 ESM 输出不给相对导入加 `.js`，Node 的 ESM 加载器要求后缀
       → `ERR_MODULE_NOT_FOUND: dist/main/host/host`。→ 改为 **CommonJS** + `__dirname`。
    2. **沙箱化的 preload 不支持相对 require**：原来编译成多个 CJS 模块，桥是**断的**
       （`module not found: ./shell/preloadBridge`）。页面照样渲染，只是 `window.omo` 不存在，
       前端静默退回 HTTP 再被 CSP 挡掉——**这种失败用假 ipcRenderer 的单测永远测不出来**。
       → 改用 **esbuild 打成单文件**（1507 B，零相对 require）。
    3. **user-data 目录必须预先存在**（见 §6.31）：主进程现在在任何 Chromium 初始化前自己 mkdir，
       并尊重调用方显式给的 `--user-data-dir`。
    4. 冒烟钩子用了 Electron 44 已废弃的 `console-message` 多参数签名。
    → 冒烟自检也从"页面加载成功"升级为**在渲染进程里真调一次 `window.omo.rpc('meta')`**：
    只渲染成功打 `PARTIAL` 并退 1，桥不通绝不冒充成功。
    仍未做：**electron-builder 实跑**（完整包/轻量包的最终产物形态）、安装包在**净机**上的验收。
36. **⚠️ 穿越防护要按"意图"判，不能按"结果"判（2026-10 修正，第一次修得不彻底）**：
    调试桥的静态托管最初照抄 `appProtocol.ts` 的规则——"解码后解析，要求结果仍在 root 内"，
    外加一条 POSIX 下拒绝反斜杠的特判。这条规则有**两个毛病**：
    1. **按结果判会漏掉"想穿越但没越界"的请求**：`/a/../design`、`/a/..`、`/a/./optimize` 会被
       `resolve` 折叠回 root 内，于是**落进 SPA 回退**，用 `200` + `index.html` 回应一次穿越尝试。
       而 `/../../etc/passwd` 得到的是 404——**同一个意图、两种答案**，取决于它有没有越界。
    2. **判定依赖平台**：win32 下 `..` 是段、POSIX 下 `..\..\x` 只是一个带反斜杠的文件名。
       原实现靠"POSIX 下拒反斜杠"补洞，等于让"被不被挡"取决于 `platform`。
    正确做法：**在解析之前按段判定意图**，`decoded.split(/[/\\]/)` 里有 `.` 或 `..` 段就拒绝
    （分隔符无关，两个平台答案一致）；点号在段中间不是点段（`app.min.js`、`v0.1.0.json` 照常放行）。
    然后**再**用"必须仍在 root 内"做兜底（挡住段级检查看不见的写法，如 Windows 盘符绝对路径）。
    **用例教训**：原来那组穿越用例只跑 `platform: 'linux'`，Windows 形态全靠"拒反斜杠"那条特判挡着，
    从未在 win32 语义下验过——所以掩蔽问题没被测出来。现在用 `describe.each` 在
    **linux 与 win32 两条路径上跑同一张表**，并显式断言"穿越意图一律 null，绝不落进 SPA 回退"。
    验证方式也值得记住：`Invoke-WebRequest` 会**在客户端先规范化** `..`（`/a/../design` 变成
    `/design` 才发出去），所以用它测穿越会得到误导性的 `200`；要测**原始请求**必须用
    `TcpClient` 手写请求行。用原始套接字复核：5 种穿越写法全部 `404`、`html=False`。
37. **⚠️ 引擎 stderr 的乱码有两个独立原因，只修一个不够（2026-10，第二次才修全）**：
    把 Go 的 stderr（UTF-8，正常）与引擎的 stderr 一起收进同一个日志文件时，**引擎那几行是乱码**：

    ```
    2026/10/15 ... rpc mode: stdio（JSON-RPC over stdin/stdout；日志输出到 stderr）   <- Go，正常
    omo rpc: stdio JSON-RPC ������omo 0.1.0����־�� stderr��                          <- 引擎，乱码
    ```

    **原因 A：编码没定死。** Python 在 Windows 上默认用 **ANSI 代码页**（本机 GBK）编码 stderr，
    而 Go 写的是 UTF-8 字节。引擎是 Go 的**孙进程**，只能从上游定死：
    → 加 `PYTHONUTF8=1` + `PYTHONIOENCODING=utf-8`。
    **权威位置是 `server/internal/task/engine_stdio.go` 拉起引擎的那一步**（`engineEncodingEnv`）：
    那是唯一能影响引擎的环境边界，桌面壳 / `start-local` / `rpc-cli` / 手工 `--stdio` 四条入口
    因此行为一致；调用方显式给的变量仍可覆盖（排障用）。桥的 `local-bridge.mjs` 与 Host 的
    `buildBackendEnv` 也各设一次，属**防御性重复**（它们只是 Go 的父进程，不是引擎的父进程）。

    **原因 B：收日志的一端按 chunk 各自解码。** 这是更隐蔽的一半，第一次修漏了：
    `desktop/src/host/backend.ts` 的 `handleStderr` 原来对每个 chunk 单独
    `chunk.toString('utf8')`。管道可以在**任意字节**处分块，包括把一个汉字（3 字节）切开，
    于是两个残片各变一个 `U+FFFD`；而且逐 chunk 切行会把**一行拆成两条日志**：

    ```
    INFO [backend] 引擎日志：        <- 汉字被切开
    INFO [backend] ��绪              <- 且一行变两行
    ```

    实测：`xx就绪yy\n` 的 12 个切点里有 **4 个**会损坏（正好切在汉字内部）。
    → 改用 **`node:string_decoder` 的 `StringDecoder`**（跨 chunk 保留不完整字节序列）
    + **跨 chunk 的行缓冲**，并在子进程退出时 `flushStderr()` 把最后一行（往往是最有用的崩溃行）
    吐出来。每一代子进程重启时都要重置解码器，否则上一代的半个字符会拼到新进程输出上。
    回归用例：`desktop/src/host/backend.test.ts` 的"跨 chunk 的 UTF-8 stderr 不被切坏"，
    用 fixture 的 `FAKE_MODE=stderr-split`（真子进程，两次 `write` 之间隔 100ms，强制分块）。

    顺带排除的两个**假嫌疑**（都已实测）：
    - `Start-Process -RedirectStandardError` **不破坏 UTF-8**：子进程写的 `e5 b0 b1`（`就`）原样落盘；
      用 `Get-Content -Encoding UTF8` 读回来是好的。所以 `start-local.ps1` 那条路径没问题。
    - `LineSplitter`（stdout）本身没问题：它先按字节找换行、**再**对整行 `toString('utf8')`，
      天然跨 chunk 正确；只有 stderr 那条路径是逐个 chunk 解码的。

    排障时的迷惑点：**同一份日志里 Go 行正常、引擎行乱码**，很容易误判成"引擎挂了/协议坏了"；
    实际上要么是 A（编码）、要么是 B（解码），两者都会给出这种"半好半坏"的观感。
    - ⚠️ **同一个"逐 chunk 解码"错误在调试桥里也有过（2026-10 复查时又抓到）**：
      `scripts/local-bridge-lib.mjs` 的 `acceptChunk` 当时先 `chunk.toString('utf8')` 再拼字符串。
      后果比 stderr 更坏：**JSON 仍能解析成功**，所以既不会报 protocol 错误、也不会失败，
      只是把中文静默替换成 U+FFFD（`最优候选` → `���优候选`）——任务名与 optimize 报告都会中招。
      穷举 85 个切点全部损坏。修法同 B：**缓冲原始字节，只对完整行解码**。
      回归用例在 `desktop/src/shell/localBridge.test.ts`（"多字节字符被切开时不能损坏内容"）。
      **教训**：一处踩过的坑要在同类代码里搜一遍——桥和 Host 是两份独立实现，第一轮只修了 Host。
38. **⚠️ `Start-Process` 不允许 stdout 与 stderr 指向同一个文件（2026-10 实测）**：
    `-RedirectStandardOutput $f -RedirectStandardError $f` 在 Windows PowerShell 5.1 上直接报
    "无法运行此命令，因为 RedirectStandardOutput 和 RedirectStandardError 相同"，
    而且**报错发生在启动之前**，脚本会以为"子进程起不来"。→ 写成两个文件（`*.stdout.log` /
    `*.stderr.log`），报错时两个都 tail。`start-local.ps1` 就是这么做的。
    另注：`-NoNewWindow` 与任何输出重定向**不能同时用**。
39. **⚠️ PowerShell 的 `-f` 不接受逗号列表当参数数组（2026-10 实测）**：
    `"... {0} {1} {2}" -f $a, $b + '...', $c` 会解析成意外的东西，报
    "Error formatting a string: Index (zero based) must be greater than or equal to zero and less than
    the size of the argument list"。→ 先把每个值算成变量，再显式传**一个数组**：
    `-f @($a, $b, $c)`。`release-manifest.ps1` 与 `build-desktop.ps1` 都按这个写法。
40. **⚠️ 本机没有 `pwsh`，只有 Windows PowerShell 5.1（2026-10 实测）**：
    `pwsh` 不在 PATH 上（`Get-Command pwsh` 失败），所以
    `pwsh -File scripts\xxx.ps1` 这条**文档里到处在用的命令在本机跑不了**；直接 `& .\scripts\xxx.ps1`
    又会被执行策略挡住（`AuthorizationManager 检查失败`）。可用的形式是
    `& powershell -NoProfile -ExecutionPolicy Bypass -File scripts\xxx.ps1`。
    §7 常用命令里保留 `pwsh`/`powershell` 的通用写法是因为 **CI 与其它机器上 `pwsh` 是有的**
    （CI 用 `shell: pwsh`），本机复现时按上面替换即可。
41. **⚠️ 轻量包的 release job 曾会产出不可运行的包（2026-10 修，三个叠加的坑）**：
    这一段值得完整读一遍，因为三个问题互相掩护，任何一个单独看都不明显。
    - **坑 1：在 ubuntu 上打 Windows 包。** `build-lite.ps1` / `build-desktop.ps1` 里的
      `go build` **不设 GOOS**，产物是宿主机格式；ubuntu runner 上得到的是 Linux ELF，却被
      改名成 `omopredict-server.exe`、塞进名字带 `-win-x64` 的 zip。壳还只是"桩"
      （`OMOPredict.exe` 内容是一行文本）。→ 整个 release job 改到 **`windows-latest`** 上真打。
      注意 PyInstaller **不支持交叉编译**，引擎 sidecar 只能在目标平台打，所以"跨平台发布"的
      正确形态是每个平台各自原生构建，不是加一个 job 就够。
    - **坑 2：`-OutDir` 一挪，`-ShellDir` 的默认推导就落空。** `-ShellDir` 默认是
      `<OutDir>/win-unpacked`；为了不把 staging 塞进 electron-builder 的输出目录，release 里把
      `-OutDir` 改成 `desktop/release/lite`，于是壳被找在 `.../lite/win-unpacked`（不存在），
      产物退化成"没有壳的 staging"。→ `build-lite.ps1` 现在显式校验 staging 与 shell 不重叠，
      找不到壳时还会说明"这个路径是从 -OutDir 推出来的"，release job 也显式传两个参数。
    - **坑 3（最隐蔽）：`Copy-Item -Recurse` 复制的是目录本身。**
      `Copy-Item $ShellDir -Destination $staging -Recurse` 生成 `staging/win-unpacked/OMOPredict.exe`，
      于是 zip 顶层多了一层 `win-unpacked/`、并出现**两个 `resources/`**（壳的与载荷的），
      真实载荷落到 `resources/` 而壳的资源在 `win-unpacked/resources/` —— 装上去打不开。
      → 改为把**子项**逐个拷进 staging，并新增**结构断言**（`OMOPredict.exe` 必须在包根，
      且 `resources/{dist,engine,omopredict-server.exe}` 必须齐）；断言在
      `-AllowMissingShell` 的桩壳路径上同样生效，所以 CI 也能拦住。
      顺带给 `build-desktop.ps1` 加了同样的硬检查：**没打出引擎 sidecar 时直接 throw**
      （原来只 `Write-Warning`，会安静地发一个"没有引擎"的完整包）。
    **教训**：桩壳（stand-in）只能验证脚本语法与体积门禁，**验证不了目录结构是否可运行**；
    这次的三个坑全部出自"用桩代替真产物"。能跑真产物时，一定要跑一次真产物。
42. **⚠️ `Start-Process -ArgumentList` 会重新解析参数串，吃掉值里的引号（2026-10 实测）**：
    `start-local.ps1` 曾用 `-ArgumentList @(..., '--engine-cmd', $EngineCmd)` 把
    `'"C:\...\python.exe" -m omo.rpc'` 传给桥。`Start-Process` 会把数组拼成**一个命令行字符串**
    让子进程重新分词，于是内层引号被消耗，桥只收到解释器路径、`-m omo.rpc` 丢失。
    症状极具误导性：任务不是立刻失败，而是 **60 秒后**报
    `engine: 启动后 ping 失败: engine: ping 响应超时（1m0s）` —— 看起来像"引擎太慢/挂了"。
    **更坑的是我自己的验证方式**：用 `Get-Content` 读桥日志确认 `engine : ... -m omo.rpc`，
    那只是把日志**回显**出来，引号看着在，实际没传进去。
    → 结论：**可能含空格/引号的值一律走环境变量**，别塞进 `-ArgumentList`。
    现在 `start-local.ps1` 用 `OMO_ENGINE_CMD` / `OMO_BACKEND_EXE` / `OMO_DIST_DIR` 传给桥
    （桥新增这两个路径变量的回退，CLI 参数仍优先），子进程启动后立刻清掉变量以免污染后续运行。
    `rpc-cli.ps1` 早就是这种做法（用 .NET `ProcessStartInfo` 直接设环境）。
43. **⚠️ `/health` 不能证明引擎可用（2026-10 实测）**：为修 P2 加的"就绪门"最初只查
    `GET /health`，结果**引擎完全跑不起来时它照样报成功**。原因：`/health` 对应 RPC `ping`，
    是 **Go 自己**应答的；引擎**惰性拉起**，失败只在第一次真正跑任务时暴露
    （即 §7 T8 记的"Go 对引擎是惰性拉起，失败出现在跑任务时"）。
    → 就绪门必须**跑一次最小任务**：`-QuitAfterReady` 提交 ITO/Ag/ITO 40-10-40 的 simulate，
    轮询到 `succeeded`，并把引擎错误原样打出来（实测得到
    `fork/exec C:\nope\python.exe: The system cannot find the path specified`）。
    **一般性教训**：健康检查要覆盖"用户真正会用的那条路径"，否则它只证明进程活着。
44. **⚠️ 脚本在非交互环境下不能靠 Ctrl+C 退出（2026-10，P2）**：`start-local.ps1` 原来主循环是
    `while ($true)`，输入被重定向（CI / 管道 / 计划任务）时只会"睡得更久"，**永不退出**，
    调用方只能干等到超时。→ 现在：交互终端照旧服务到 Ctrl+C；**stdin 被重定向时以就绪为成功信号**
    （校验引擎 → 退出 0）；另加 `-QuitAfterReady` 显式强制、`-KeepRunning` 强制保持服务。
    这也让它能当**冒烟测试**用（实测：正常 3.8s 退出 0；引擎路径写错 3.6s 退出 1 并给可操作提示；
    `-KeepRunning` 下仍能正常建任务，Rs=3.9708）。
    顺带确认：**`exit` 写在 try 里仍会执行 finally**，所以退出码不会绕过进程树回收；
    而"优雅关闭"在本脚本里不可行——它没有重定向子进程 stdin，拿不到可关闭的管道
    （`$child.StandardInput` 为 null），只能 `taskkill /T /F`；日志是同步写文件的，不会因此丢内容。
45. **⚠️ `electron-builder` 一直没被声明为依赖 —— 这就是"打包从未实跑"的真正原因（2026-11 实测）**：
    跑 `build-desktop.ps1` 时第 5 步直接失败。根因有**两层**：
    - **表层**：`desktop/package.json` 的 `devDependencies` 里**根本没有 `electron-builder`**，
      也不在 `pnpm-lock.yaml` 里；而脚本却调用 `pnpm exec electron-builder`。所以它不可能跑通过
      （T8/T9 一直用 `-SkipPackaging`，正好绕开了这一步）。
      → 已 `pnpm add -D electron-builder`（26.18.0）。
    - **深层（上游缺陷）**：装上后仍在"下载 Electron 制品"处崩：
      `⨯ Cannot read properties of undefined (reading 'ReadWrite')`，位置
      `app-builder-lib/out/util/electronGet.js:76`。`ReadWrite` 不是 `fs.constants`，
      而是 **`@electron/get` 的 `ElectronDownloadCacheMode` 枚举**。**该枚举只在 `@electron/get@3.1.0`
      起才有，3.0.0 的导出里没有**；而 `app-builder-lib@26.18.0` 声明的是 `^3.0.0`，
      锁文件按最低满足版解析到 **3.0.0** → 必定崩溃。这是 electron-builder 自 26.x 的依赖声明缺陷，
      **与机器无关**（换一台机器同样会中）。
      → 在 `desktop/pnpm-workspace.yaml` 加 `overrides: {'@electron/get': 3.1.0}` 钉死。
      实测：3.0.0 的导出是 `getHostArch, initializeProxy, downloadArtifact, download`；
      3.1.0 多出 `GotDownloader, ElectronDownloadCacheMode`。
    - **pnpm 的连带坑**：`allowBuilds` 里若留 pnpm 自动写入的占位符
      （`electron-winstaller: set this to true or false`），`pnpm install` 会以**退出码 1**结束，
      进而让**每次 `pnpm exec` 都先跑一遍 depsCheck 并失败**（报 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`，
      极具误导性）。本项目只打 nsis+zip，不需要 Squirrel，故显式写 `electron-winstaller: false`。
    - **NSIS 目标需要交互桌面**：NSIS 的构建流程是"编出安装器 → **执行它**以生成卸载器"
      （`WineVm.exec(installerPath, [])`）。无交互桌面时执行失败（`process failed 2`），
      并**留下一个 0.18 MB 的半成品 exe**（真实载荷在 `.nsis.7z` 里）。
      → `build-desktop.ps1` 现在把 **zip 设为必需、nsis 设为 best-effort**（失败只告警），
      并把"小于 1 MB 的 `.exe`"当作残渣**删除且不参与体积门禁**——否则残缺安装包会被门禁盖章。
    - 实测成果（2026-11）：`build-desktop.ps1` **退出 0**；`win-unpacked` 布局正确
      （`OMOPredict.exe` 234.6 MB + `resources/{app.asar, omopredict-server.exe 26.4 MB, engine/omo-rpc.exe 10.3 MB, dist/}`）；
      `OMOPredict-0.1.0-win.zip` **220.94 MB**；三项门禁全过（engine 165.64 / payload 27.1 / distributable 220.94）。
    - ⚠️ **GUI 项仍无法在本机验证**：启动打包后的 `OMOPredict.exe` 得到 `0x80000003`
      （未设 `ELECTRON_DISABLE_SANDBOX`）与 `0xC0000005`（设置后）——与 §6.31 的机器级
      Chromium 沙箱问题同源。§10 的"窗口 5s 内出现 / 无登录页 / 断网可用 / 运行期无端口 / 退出无残留"
      仍需在普通桌面 Windows 上补测。


## 7. 未完成事项与后续计划

**M4（Vue 3 + TS + Vite）前端 —— ✅ 已完成（2026-09）**：
- 页面：登录/注册 → 参数设计页（膜层表 + 体系模板 + 衬底折射率）→ 提交任务（`POST /api/tasks`）→
  轮询结果页（ECharts 画 T(λ)/R(λ) + SE(f) 曲线 + Rs 卡片）→ 任务历史（`GET /api/tasks`）
- API 封装：`src/api/` 对接 `docs/api/rest.md`；Vite 代理 `/api` → Go :8080（规避 CORS）
- CI：workflow 新增 frontend job（pnpm install --frozen-lockfile + lint + build）
- 验证：vue-tsc -b / eslint 0 告警 / vite build 通过；端到端联调值对齐引擎契约示例
  （Rs=3.9708 Ω/sq、T@550nm=0.9745、SE@10GHz=33.70 dB）
- 注意：Go 服务未配 CORS，生产部署需在反向代理层完成 /api 转发

**M5 v1（引擎层目标反推）—— ✅ 已完成（2026-09）**：
- `omo/optimize/`：target（硬约束模型）/ evaluate（引擎同源求值）/ search（网格扫描 + FoM 排序 + best_effort）/
  sensitivity（±1 nm 有限差分灵敏度 + 工艺窗口容差）；报告 `OptimizeReport.to_dict()` 可 JSON 化
- CLI：`omo-cli optimize --min-t 0.85 --max-rs 12 --min-se 25 [--outer-* --metal-* --json ...]`
- 验证：19 测试（含 Top 候选回灌物理引擎自洽）+ ruff 0；默认 4096 组合含 SE 约 3 s（无 SE 约束自动跳过屏蔽求值）
- 快速体验：`uv run omo-cli optimize --min-t 0.85 --max-rs 12 --min-se 25`

**M5 v2（优化 API 打通）—— ✅ 已完成（2026-09）**：
- 引擎 `POST /optimize`（schemas OptimizeTarget/OptimizeSpace + service.run_optimization + main 路由，
  ValueError → 422；契约见 docs/api/engine.md）
- Go 任务模型泛化：`SimulationTask.Kind`（simulate|optimize）+ `Optimize` 参数列 +
  `optimize_result`（引擎报告 JSON 原样持久化，顶层注入 task_id）；`POST /api/tasks` 按 kind 分流
  （缺省 simulate，存量数据向后兼容）；EngineClient.Optimize + service.runOptimize
- 验证：引擎 6 个 /optimize 测试 + Go 5 个新测试（optimize 任务流/缺参 400/未知 kind 400/引擎失败）；
  真实端到端冒烟通过（经 Vite 代理：建 kind=optimize 任务 → 轮询 succeeded → candidates/FoM/灵敏度完整）

**M5 剩余**：报告导出、遗传/贝叶斯寻优、NN 代理加速后端（接口不变）。
（前端「目标反推」页已于 M5 v2 完成，见上表：`frontend/src/views/OptimizeView.vue` + `/optimize` 路由。）

**M6-a（桌面版基础 T1–T4 + T4.5）—— ✅ 已完成（2026-09）**：
- T1 单用户模式（`OMO_AUTH_MODE=none` + `GET /api/meta`，固定 `user_id="local"`）；T2 `DELETE /api/tasks/{id}`（归属校验统一 404）；
- T3 Go 侧 stdio JSON-RPC 分发器（`internal/rpc`，`omopredict --stdio`，错误码=HTTP 语义）；
- T4 引擎侧：中立编排层 `omo.sim` + `omo/rpc` stdio 入口 + 可选依赖化（基础仅 numpy/scipy，`api`/`neural`/`plot` 为 extras）+ import 图测试。
- **T4.5 Go→引擎 stdio 传输**（补齐第 3 稿把该项隐含在 T6 里的缺口）：
  - `internal/task/engine.go`：`Engine` 接口（`Simulate`/`Optimize`/`Close`）+ HTTP 实现 `EngineClient`（原样保留，故既有测试零改动）+ 两传输共用的 `simulateParams`；
  - `internal/task/engine_stdio.go`：`StdioEngine` —— 惰性拉起引擎子进程、JSON-Lines 收发、按自增 id 关联响应（乱序安全）、
    单次调用超时、引擎中途退出**立即**让在途请求失败（不挂到超时）、`Close` 关 stdin 优雅退出并在 3s 后强杀、
    stdout 仅协议而引擎 stderr 并入本进程；
  - `internal/task/engine_resolve.go`：`ResolveEngineCommand`（D9 1–4 级：`OMO_ENGINE_CMD` → `resources/engine` sidecar → `uv --project` → PATH python）+ 引号路径切分；
  - `cmd/omopredict/main.go`：按 `OMO_ENGINE_TRANSPORT` 构造引擎、退出时 `Close`；stdio 解析失败**启动即失败**（不静默回退 HTTP）；
  - 设计见 `docs/desktop.md`（§13 进度表：T6–T11 待做）。
- **T5 前端传输抽象 + 能力门禁**：
  - `api/transport.ts`：`Transport` 接口 + 方法↔端点映射（`meta`/`tasks.*`/`auth.*` → REST 路径）+ `httpTransport`（`http.ts` 内的 fetch/JWT/错误提取）
    + `ipcTransport`（`window.omo.rpc`）+ `toApiError`（兼容 `Error&{code}`、`{code,message}`、JSON-RPC `{error:{code,message}}`）
    + `activeTransport()`（`window.omo` 存在即 IPC，否则 HTTP；`setTransport()` 供测试覆盖）；
  - `api/client.ts`：统一入口，401 → 清 token + 广播 `omo:unauthorized`（两种传输行为一致）；
  - **门禁**：`main.ts` 挂载前 `auth.bootstrap()` 拉 `meta`；auth store 的 `authRequired`（meta 缺失/失败按 true 兜底）、
    `isLocalMode`、`isAuthenticated = !authRequired || token`；路由守卫在无认证模式放行全部页面并把 `/login` 送到 `/design`；
    `App.vue` 显示「本地模式」标记并隐藏用户名/退出，且忽略本地模式下的 `omo:unauthorized`；
  - 历史页删除：两段式内联确认（不用原生 `confirm`，嵌入式 webview 可能禁用）；
  - 前端单测已由 T9 局部补齐（见下）；门禁的浏览器行为仍**未经浏览器实测**。

**M6-b T6（桌面 Host 层）—— ✅ 已完成（2026-09）**：
- 位置 `desktop/`（独立 pnpm 工程，**T6 不含 electron 依赖**，随 T7 引入，见 `desktop/README.md`）；
- `src/host/`：`paths`（D6 目录，按**目标**平台选 win32/posix 路径语义，故三平台可精确单测）、
  `logger`（D7 按天命名 + 保留 7 天，目录不可用时退化为仅回显而不是崩）、
  `lines`（JSON-Lines 分帧：跨 chunk 半行、超长行丢弃后恢复）、
  `rpc`（id↔Promise、单次超时且可按调用覆盖、错误码=HTTP 语义、非法行/未知 id 只报协议错误不中断）、
  `backend`（spawn、ping 健康检查、stderr 落盘 + 环形缓冲、**退出时立刻失效在途请求**、
  就绪后崩溃才自动重启且**限速**、启动阶段失败**不**重启、优雅关闭→超时强杀进程树、
  非 JSON 行按"协议污染"记日志并继续）、
  `engine`（只探测 Go 看不到的随包资源布局，D9 1–4 级仍归 Go，避免两边漂移；第 5 级提供指引文案）、
  `singleton`（文件锁，含陈旧锁回收；**同进程重复获取也拦**，防一个进程起两个后端写同一 SQLite）、
  `host`（组装并注入 D6 环境变量，默认 `OMO_ENGINE_TRANSPORT=stdio`）；
- **未做的部分（如实记录）**：D5 的**周期性健康检查（每 5s ping）**未实现（目前只在启动时 ping）；
  进程树回收用 `taskkill /T /F`（Windows）而非 OS 级 **Job Object** 绑定；
  `desktop/` 的 eslint/prettier 属 T9。

**M6-b T7（Electron 壳）—— ✅ 已完成（2026-09），但未做运行期启动验证**：
- `src/main.ts`：`app` 单实例锁（并把 `second-instance` 用来聚焦已有窗口）、`protocol.registerSchemesAsPrivileged`
  （必须在 ready 前）+ `protocol.handle('app', …)`、菜单、`ipcMain.handle` 四个通道、
  `will-quit` 时 `host.dispose()` 回收后端子进程与单实例锁、启动失败用 `dialog.showErrorBox` 显示
  D9 第 5 级的可操作指引；
- `src/preload.ts`：`contextBridge.exposeInMainWorld('omo', …)`，**只暴露白名单**
  （`rpc`/`openLogDir`/`openDataDir`），不把 `ipcRenderer` 交出去；
- `src/shell/`（与 Electron 解耦、可单测）：
  - `appProtocol`：`app://omo/…` → 磁盘文件 + SPA 回退；**目录穿越防护**（含 `%2e%2e%2f`、`..%5c`、
    盘符绝对路径、NUL 字节）；响应头带 **CSP（`connect-src 'none'`）** 与 `nosniff`；
  - `channels`：IPC 通道名 + **结果信封** —— Electron 会把跨进程的 Error 压成只剩 message，
    自定义 `code` 会丢，而前端的 401/404 分支依赖 `code`，所以改成"返回信封、由 preload 还原成
    `{code,message}` 再抛"（该形态正是 `frontend` 的 `toApiError` 支持的）；
  - `preloadBridge` / `menu` / `windowOptions`（上下文隔离 + 沙箱 + 无 Node + 关 webview）/
    `backendCommand`（env → 打包资源 → 仓库构建产物三来源）/ `diagnostics`（**密钥脱敏**）；
- **preload 必须编译成 `.cjs`**：窗口启用了 `sandbox: true`，沙箱化 preload 只能是 CommonJS，
  而本包 `"type": "module"`，若叫 `preload.js` 会被当 ESM 加载失败（已在 main.ts 注明）。

**M6-c T8（轻量包）—— ✅ 已完成（2026-09）**：
- `scripts/setup-engine.ps1`：定位引擎工程（`-EngineDir` 或按 `../engine` → `../resources/engine` 自动发现）→
  有 `uv` 走 `uv sync --frozen`，否则 `python -m pip install -e`（附镜像提示）→ **发一次 `ping` 验证**
  （argv 按 D9 拼，与 Go 侧一致；显式给的解释器优先）。**所有失败都落进统一的 "What to check" 块**，
  不会抛 PowerShell 堆栈——这条正是 T8 验收项"无 Python 错误路径"。
- `scripts/build-lite.ps1`：渲染产物 + Go 后端 + **引擎源码**（只拷 `pyproject.toml`/`uv.lock`/`.python-version`/
  `README.md`/`src`，排除 `.venv` 与 `__pycache__`）+ `setup-engine.ps1` + 由 `desktop/lite/README.txt` 生成的
  `README.txt` → **体积门禁** → zip。退出码：0 出包 / 1 构建或门禁失败 / **2 仅暂存**（无壳时不假装成功）。
- **T8 验收项（应用层）已实测**：真实 Go 后端 + 不存在的解释器时，后端**仍能启动并发回 ping**
  （Go 对引擎是**惰性拉起**），失败出现在跑任务时——任务落 `failed`，错误为
  `engine: 启动 [C:\nope\python.exe -m omo.rpc]: fork/exec … cannot find the path specified.`，**可操作**。
- ✅ **体积门禁（2026-09 已决）**：轻量包**保留内嵌 Electron 运行时**，因此上限由原设计的 50MB
  **放宽到 150MB**（Electron 自身压缩后约 110MB，该数字不可能压到 50MB 以下）。为不丢掉"防可选依赖泄漏"
  的作用，同时新增一道**紧门禁 `app payload ≤50MB`**（Go 后端 + 渲染产物 + 引擎源码 + 脚本，实测 27.5MB）
  ——torch 泄漏会让它直接爆掉。

**M6-c T9（契约 + 脚本 + CI）—— 🔶 部分完成（2026-09）**：
- `scripts/rpc-cli.ps1`：手工调试 stdio 端点——把请求发进去，**分开**打印 stderr 日志与解析后的 JSON 响应。
  支持 `-Target backend|engine`、`-Method/-Params` 或 `-RequestFile`（多行）、`-Exe`、`-DataDir`。
  实测：ping → `{"status":"ok"}`、`tasks.list` → `{"tasks":[]}`、未知方法 → 保留码 `-32601`、
  `-Target engine` 直连引擎 OK、坏 JSON 在本地被拦（不伪装成后端故障）。
  实现避坑：`ProcessStartInfo.ArgumentList` 属于 .NET Core 2.1+，**Windows PowerShell 5.1（.NET Framework）没有**
  → 改用 `Arguments` 字符串并自行给含空格的参数加引号；异步读取用 `ReadLineAsync()` + `Task.Wait(ms)`
  与 `ReadToEndAsync()`（stderr 后台抽干，避免管道写满把子进程卡住）。
- `scripts/build-desktop.ps1`（完整包，六步）：渲染 → Go 后端 → **PyInstaller onedir 引擎** →
  壳 TS（main ESM / preload CJS）→ electron-builder → 门禁。`-SkipPackaging` 只做前四步 + 门禁（退出 2）。
  - PyInstaller 走 `uv run --project engine --with pyinstaller`：**不把 pyinstaller 写进项目依赖**（不动 `uv.lock`），
    但仍在引擎环境里执行，numpy/scipy 才能被发现。约 40s 出包。
  - **布局对齐（易错）**：`--distpath release-bin` 产出 `release-bin/omo-rpc/`，electron-builder 把
    `release-bin/omo-rpc → resources/engine`，于是 exe 正好落在 `resources/engine/omo-rpc.exe`
    ——Go 的 `findSidecar` 只在 `resources/engine/` 下**直接**找 exe、不递归子目录，映射错一层就找不到引擎。
- **壳 TS 编译管线（T7 的遗留必要件）**：`tsconfig.build.json` → `dist/main`（ESM，用 `import.meta`）、
  `tsconfig.preload.json` → `dist/preload`（CommonJS），构建脚本再写一个 `{"type":"commonjs"}` 的 package.json
  来定类型（本包 `type: module`）。`main.ts` 的 preload 路径随之改为隔壁目录的 `preload.js`。
  已核验产物：`main.js` 含 `import`/`import.meta`；`preload.js` 含 `require`/`exports` 且无 `import`。
- **实测体积事实（据此放宽门禁）**：PyInstaller onedir = **165.64MB**（numpy + scipy），
  远超设计初稿 90MB 的估计（当时估"50–90MB"）。engine dir 门禁放宽到 **250MB**；
  产物中 `torch`/`fastapi`/`uvicorn`/`matplotlib` **均 0 条目**、sidecar 又能算对结果，
  说明这是 numpy/scipy 的固有开销而不是依赖泄漏。
- ✅ **T9 尾项已完成（2026-10）**：
  - `scripts/start-local.ps1` + `scripts/local-bridge.mjs`（+ `scripts/local-bridge-lib.mjs` 核心、`scripts/local-bridge-lib.d.mts` 类型）：
    **HTTP ↔ stdio 调试桥**，让"全程不监听端口"的进程树能在普通浏览器里跑起来。
    `浏览器 --HTTP--> 桥 --stdio JSON-RPC--> Go --stdio JSON-RPC--> 引擎`；
    整棵树只有桥监听一个回环端口。桥是**调试工具**：只跟自己拉起的子进程说话、默认绑 `127.0.0.1`、
    路由表是**封闭白名单**（没有通用转发）。桥的核心（路由映射 / JSON-Lines 客户端 / 静态托管 +
    目录穿越防护）是零依赖纯模块，由 `desktop/src/shell/localBridge.test.ts` 覆盖（**33 用例**）。
    实测：`Rs = 3.970819`、`T@550nm = 0.974497`、`SE@10GHz = 33.7036`（与契约一致）、
    SPA 深链回退、`/api/auth/me` 本地回答、删除任务、Ctrl+C 后端口释放无残留。
    期间修的真实问题：POSIX 上反斜杠路径会**静默退化成 SPA 回退**（掩盖穿越尝试）→ 显式拒绝；
    引擎 stderr 编码（见 §6.37）；`Start-Process` 同文件重定向限制（见 §6.39）。
  - `scripts/release-manifest.ps1`：产物 → `SHA256SUMS.txt`（`sha256sum` 兼容、UTF-8 无 BOM、仅 LF）
    + `omopredict-<version>.json`（version/commit/每产物 hash+size）；`-Verify` 逐条反查。
    只收 `-InputDir` 的**直接子文件**（排除 `*.json`），`-Include` 可显式补充。
    实测：生成 → 校验通过 → 篡改一字节 → **必须失败**（退出 1）；空目录/不存在目录都退出 1。
  - CI：`packaging` job 新增两步（`start-local.ps1` 在空目录里必须"可操作地失败"；
    release-manifest 往返 + 篡改必失败）；新增 **`release` job**（`v*` tag 触发）：
    版本一致性守卫（tag 去掉 `v` 必须等于 `desktop/package.json` 的 version）→ 真打轻量包 →
    生成清单 → **发布前用清单校验自己** → `gh release create` 上传 → run summary 写明
    完整包仍需本地 Windows 构建并手工附上。
- ⏳ **T9 未做**：**完整包进 Release**（`build-desktop.ps1` 要 electron-builder 的 Windows 目标，
  在 ubuntu runner 上打不出来，故由 release job 明确交回本机），以及 electron-builder 本身（属 T11）。

**M6-d T10–T11 —— ⏳ 部分完成**：文档收尾进行中；**净机验收的第一件事已做完**。
> ✅ **"壳能否真的启动并渲染"已实测通过**（2026-10，§6.35）：窗口、`app://` 加载 `frontend/dist`、
> CSP 未误伤、preload 注入成功、`window.omo.rpc('meta')` 返回后端真实数据、退出干净。
> 一条命令复现：`powershell -ExecutionPolicy Bypass -File scripts\smoke-desktop.ps1 -SkipBuild`。
> 这一趟一次性修掉四个真 bug（ESM 产物加载不了 / 沙箱化 preload 不支持相对 require /
> user-data 目录必须预建 / 废弃的 console-message 签名），详见 §6.35。
> ⏳ **仍未做**：**`electron-builder` 从未实跑**，所以"完整包/轻量包的最终产物形态"仍属 T11；
> 以及安装到**另一台干净机器**上的验收（本机有 Chromium 沙箱起不来的机器级问题，见 §6.31）。
> 目前只验到了它的**输入**（壳 TS、Go 后端、PyInstaller sidecar）与布局契约。
> 注意 stdio 传输下 **stdout 只能是协议流**（引擎与 Go 的日志都必须在 stderr，见 §6.15）。

**M6（集成）**：部署（Go 静态托管 frontend/dist + CORS 配置）、示例数据与演示、端到端测试完善。

**其他可做**：`omo-cli simulate` 子命令（M1 计划过）；benchmark 数据集扩充（更多体系）；
NN 代理 v2（材料参数入特征 / 逆向设计）。

## 8. 续接 checklist

1. 读 `AGENTS.md` §6 守则 + 本文件 §6 环境坑
2. 跑通现有验证：`cd engine && uv run --all-extras pytest -q`（**132 passed**）、`cd server && go test ./...`、
   `cd frontend && pnpm lint && pnpm test && pnpm build`、`cd desktop && pnpm type-check && pnpm test`
   （**注意 §6.11/§6.22/§6.23**：沙箱文件权限与 `%TEMP%` 写入限制会让 vite/esbuild、node_modules 与 SQLite 失败；
   本机 `desktop` 的 `pnpm test` 可能因 pnpm 判定 node_modules 过期而中止，可直接跑
   `desktop\node_modules\.bin\vitest.cmd run` 绕过，见 §6.40 那条的同类环境问题）
3. 若续做桌面版：**T1–T9 全部完成**，剩下的是 **T10 文档收尾 + T11 净机验收**（**electron-builder 从未实跑**、
   完整包进 Release 需在本地 Windows 上做、装上另一台干净机器验收）；
   装上 Electron 二进制后请**先做 T11 的运行期验收**（壳启动/渲染/CSP/preload，见下）；
   动手前注意：体积门禁**已决**（轻量包 150MB + payload 50MB + 引擎目录 250MB，见 §7 T8/T9 块），无需再定夺；
   Host 与壳的接线面见 `desktop/README.md`（`Host.invoke` / `Host.onEvent` / `Host.dispose`，
   以及 `src/shell/` 里已固化的 `window.omo` 契约）；打包与调试脚本见 `scripts/README.md`；
   **想最快看到整条链路跑起来**：`scripts\start-local.ps1`（浏览器 + 无端口全链路，不需要 Electron）；
   手工联调桌面链路（无端口）：`OMO_AUTH_MODE=none OMO_ENGINE_TRANSPORT=stdio OMO_ENGINE_CMD='python -m omo.rpc' ./omopredict --stdio`，
   或用 `OMO_ENGINE_CMD` 指向 `engine/.venv/Scripts/python.exe -m omo.rpc`；
   RPC 契约见 `docs/api/rpc.md`；若续做 M5 剩余，先 `uv run omo-cli optimize ...` 冒烟再接 API/前端
4. 改动物理模型时：更新 docs/physics + 重跑 benchmark（守则 §2/§3）
5. 提交规范：Conventional Commits；每里程碑可运行 + 测试 + 文档
6. 发版：打 `v<version>` tag（**必须与 `desktop/package.json` 的 version 一致**，release job 会拦）→
   release job 产出轻量包 + SHA256 清单 + JSON 清单；**完整包在本机 Windows 上用
   `scripts\build-desktop.ps1` 构建后手工附到同一个 Release**，附完重新生成清单以覆盖其哈希
   （`powershell -File scripts\release-manifest.ps1 -InputDir desktop\release -OutDir dist\release`）。
