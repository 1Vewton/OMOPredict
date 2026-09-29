# OMOPredict 交接报告（HANDOVER）

> 给**后续 agent** 的当前状态与续接指南。请先读本文件与 `AGENTS.md`（项目宪法），
> 再按需阅读下文文档索引中的对应文档。
> 最后更新：M6-a（桌面版 T1–T4）完成（2026-09）。

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

测试现状：Python **132 passed / ruff 0**（2026-09 文件权限修复后不再有 tmp_path 报错，见 §6.22；此前记录的"128 passed + 4 个 PermissionError"已过时）；Go 全量测试通过（api/model/store/user/task，含 optimize 任务流、单用户模式与 **12 个 stdio 引擎用例**）；前端 `pnpm lint` 0 告警 + `pnpm test`（**vitest：5 文件 60 用例**）+ `pnpm build`（`vue-tsc -b` + `vite build`）通过。

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
  - **前端仍无测试框架**：`transport.ts`/`client.ts` 的假传输单测按 docs/desktop.md §7 属 T9；门禁的浏览器行为尚未实测。

**M6-b 剩余（T6–T11）—— ⏳ 待做**：T6 Electron Host 层、T7 壳、T8 轻量包、T9 契约一致性/CI/体积门禁、T10 文档、T11 净机验收。
> 🔶 **T9 已部分完成（2026-09）**：**前端 vitest 单测**（`frontend/vitest.config.ts`，5 文件 60 用例：传输选择/全部端点映射/
> 错误归一化/401 横切/**两传输载荷一致性**/能力门禁三态/路由守卫矩阵/历史页删除状态机；命令 `pnpm test`），
> 并在 CI 前端 job 加了 `pnpm test` 步骤。**其余 T9 项仍待做**：`rpc-cli.ps1`、`build-desktop.ps1`、体积门禁、CI 六 job、Release。
> ✅ 关键前置（Go→引擎 stdio）由 **T4.5** 补齐、前端传输抽象与门禁由 **T5** 补齐，T6 可直接做 Host 层（preload 需按 T5 固化的
> `window.omo.rpc` 契约实现：失败 reject 带 HTTP 语义 `code`）。
> 仍需在 Host 侧补：**D9 第 5 级的友好错误对话框**、D5 的周期性健康检查与重启限速（3 次/10min）、Job Object 进程树回收。
> 注意 stdio 传输下 **stdout 只能是协议流**（引擎与 Go 的日志都必须在 stderr，见 §6.15）。

**M6（集成）**：部署（Go 静态托管 frontend/dist + CORS 配置）、示例数据与演示、端到端测试完善。

**其他可做**：`omo-cli simulate` 子命令（M1 计划过）；benchmark 数据集扩充（更多体系）；
NN 代理 v2（材料参数入特征 / 逆向设计）。

## 8. 续接 checklist

1. 读 `AGENTS.md` §6 守则 + 本文件 §6 环境坑
2. 跑通现有验证：`cd engine && uv run --all-extras pytest -q`（**132 passed**）、`cd server && go test ./...`、
   `cd frontend && pnpm lint && pnpm build`（**注意 §6.11/§6.22**：沙箱文件权限问题可能让 vite/esbuild 与 node_modules 写入失败）
3. 若续做桌面版（M6-b）：**Go→引擎 stdio（T4.5）与前端传输抽象+门禁（T5）均已就绪**，下一步是 Electron Host 层（T6），
   其 preload 须实现 T5 固化的 `window.omo.rpc(method, params)` 契约（失败 reject 带 HTTP 语义 `code`）；
   手工联调桌面链路（无端口）：`OMO_AUTH_MODE=none OMO_ENGINE_TRANSPORT=stdio OMO_ENGINE_CMD='python -m omo.rpc' ./omopredict --stdio`，
   或用 `OMO_ENGINE_CMD` 指向 `engine/.venv/Scripts/python.exe -m omo.rpc`；
   RPC 契约见 `docs/api/rpc.md`；若续做 M5 剩余，先 `uv run omo-cli optimize ...` 冒烟再接 API/前端
4. 改动物理模型时：更新 docs/physics + 重跑 benchmark（守则 §2/§3）
5. 提交规范：Conventional Commits；每里程碑可运行 + 测试 + 文档
