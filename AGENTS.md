# AGENTS.md — OMOPredict

> 本文档是 **AI 代理（Agent）在本仓库工作的第一入口**，也是全体协作者的"项目宪法"。
> 本项目以 **AI 辅助编程为核心生产力**，因此本文档保持精简、可执行，并随项目演进持续更新。

---

## 1. 项目简介

**OMOPredict** 是一款面向大学生的、聚焦 **OMO（Oxide-Metal-Oxide）纳米多层薄膜体系** 的轻量化仿真与设计软件。

- **核心能力**：输入薄膜结构参数（各层**厚度**、**折射率/介电函数**、**电阻率**等属性），
  仿真输出**光学性能**（透过率、反射率、吸收率）、**电学性能**（方阻）与**电磁屏蔽效能（EMI SE）**等性能参数。
- **差异化目标**：仿真结果**严格对标高水平学术论文的实测数据**，实现：
  1. 对薄膜材料性能的**精准预测**；
  2. 面向工艺的**参数优化指导**（如最优膜厚组合、层序设计）。
- **定位**：轻量化、教学友好、结果可视化、可复现，作为大学生科研与课程设计的辅助工具。

典型体系示例：ITO/Ag/ITO、ZnO/Ag/ZnO、TiO₂/Ag/TiO₂ 等，金属层（Ag/Cu，约 5–15 nm）提供导电与电磁屏蔽，氧化物层提供增透、保护与界面调控。

---

## 2. 技术栈与三层架构

| 层 | 技术 | 职责 |
|---|---|---|
| **数据科学层** | Python（基础仅 numpy / scipy；torch / matplotlib / FastAPI 均为可选 extras） | 物理建模与仿真计算：光学、电学、电磁屏蔽、参数优化、文献对标 |
| **中间层** | Go | 用户管理（或单用户本地模式）、数据持久化、仿真任务编排、REST API / stdio JSON-RPC |
| **前端** | Vue 3 + TypeScript（Vite） | 参数输入、结果图表可视化、任务历史、目标反推 |

**服务间通信约定**：前端只与 Go 中间层通信。**两种运行形态共用同一份代码与 JSON 载荷**，
仅传输方式与认证模式不同（详见 `docs/desktop.md`）：

- **Web / 开发形态**：前端 REST/JSON → Go（JWT 多用户）→ HTTP → Python 引擎（FastAPI `omo.api`）。
- **桌面形态（M6-a 起，部分落地）**：Electron IPC → Go `--stdio`（`OMO_AUTH_MODE=none` 单用户，
  `user_id="local"`）→ stdio → 引擎 `python -m omo.rpc`；全程 **stdio JSON-RPC 2.0（JSON-Lines）、
  不监听端口**。契约见 `docs/api/rpc.md`。

Python 侧同时提供可独立运行的 CLI，便于脚本化批量仿真与对标。

```
Web 形态（现行默认）
┌────────────┐   REST/JSON   ┌──────────────┐   HTTP   ┌──────────────────┐
│  Vue3+TS   │ ────────────▶ │     Go       │ ───────▶ │  Python (FastAPI)│
│  前端 UI   │ ◀──────────── │ 用户/存储/任务│ ◀─────── │  物理仿真引擎     │
└────────────┘               └──────────────┘          └──────────────────┘

桌面形态（设计中，见 docs/desktop.md）
┌────────────┐     IPC      ┌──────────────┐  stdio   ┌──────────────┐  stdio  ┌──────────────┐
│  渲染进程  │ ───────────▶ │   Electron   │ ───────▶ │  Go --stdio  │ ──────▶ │   omo.rpc    │
│ (同前端)   │ ◀─────────── │    主进程    │ ◀─────── │ 单用户任务层 │ ◀────── │  物理仿真引擎│
└────────────┘              └──────────────┘          └──────────────┘         └──────────────┘
```

> ✅ **桌面形态已完成到 T8**：单用户模式、任务删除、Go 侧 RPC 分发器、引擎侧 `omo.sim` + `omo.rpc`、
> **Go→引擎 stdio 传输**（T4.5）、**前端传输抽象 + `meta` 能力门禁**（T5）、**Electron Host 层**（T6）、
> **Electron 壳**（T7：主进程 + preload + `app://` 协议 + 菜单 + IPC）、**轻量包**（T8：
> `scripts/setup-engine.ps1` + `build-lite.ps1` + 体积门禁，CI 有 `packaging` job）。
> 引擎启动命令按 `OMO_ENGINE_CMD` → 完整包 sidecar → `uv` → `python` 四级解析
> （`server/internal/task/engine_resolve.go`）；前端 `activeTransport()` 依 `window.omo` 自动选 IPC/HTTP。
> 全程**不监听任何端口**（已实测满足 docs/desktop.md §10.6）。
> 仍未做：**T9–T11**（`rpc-cli.ps1`/`build-desktop.ps1`/CI 六 job/Release、文档收尾、**净机验收**——
> 其中"壳真的能启动并渲染"必须由 T11 在装上 Electron 二进制的机器上验证）。
> ✅ **体积门禁已决（2026-09）**：轻量包保留内嵌 Electron 运行时，整包上限由 50MB **放宽到 150MB**，
> 并新增 **app payload ≤50MB** 紧门禁负责防可选依赖泄漏（详见 `docs/desktop.md` §7）。

---

## 3. 物理模型范围（数据科学层核心）

所有物理模型**必须标注文献来源**，并配单元测试与文献数据基准测试。

### 3.1 光学性能（Optics）—— ✅ M1 已实现（见 engine/src/omo/optics/ 与 docs/physics/tmm.md）
- **传输矩阵法（TMM）**：基于 Fresnel 系数计算多层膜系的透过率 T、反射率 R、吸收率 A（含角度、偏振）。
- **金属介电函数**：Drude 模型 ε(ω) = ε∞ − ωp² / (ω² + iγω)，必要时扩展 Drude–Lorentz；
  常数（如 Ag 的 ωp、γ）取自公开文献并集中管理。
- 输出：光谱曲线（300–2500 nm）、可见光平均透过率、色度坐标等。

### 3.2 电学性能（Electrical）—— ✅ M1 已实现（见 engine/src/omo/electrical/ 与 docs/physics/electrical.md）
- **方阻 Rs（Ω/sq）**：多层膜并联等效模型；金属层主导，超薄金属需考虑**电阻率尺寸效应**（Fuchs–Sondheimer 等）。
- 输出：方阻、等效电阻率、与膜厚的关系曲线。

### 3.3 电磁屏蔽效能（EMI SE）—— ✅ M1 已实现（见 engine/src/omo/emi/ 与 docs/physics/emi.md）
- **Schelkunoff / 传输线模型**：SE_total = SE_R + SE_A + SE_M（反射、吸收、多次反射损耗）。
- 薄导电膜近似：SE ≈ 20·log₁₀(1 + Z₀ / (2Rs))，Z₀ = 377 Ω；多层结构用多层传输线矩阵。
- 输出：8.2–12.4 GHz（X 波段）及更宽频段（1–18 GHz）的 SE 曲线。

### 3.4 综合指标与优化—— ✅ M5 v1（引擎）+ v2（API/前端接入）已完成（见 engine/src/omo/optimize/）
- **品质因子**：Haacke FoM = T¹⁰ / Rs（G. Haacke, J. Appl. Phys. 47, 4086 (1976)），用于候选横向对比。
- **参数优化（目标反推 v1）**：硬约束（T_vis ≥ x / Rs ≤ y / SE ≥ z，可任选）下的
  三层膜厚**网格扫描寻优**（默认 ITO/Ag/ITO：外层 20–80 步长 4、金属 5–20 步长 1 ≈ 4k 组合，
  进程内 ~3 s），可行候选按 FoM 排序，另给 best_effort（无可行解时的最接近参考）。
- **工艺指导**：最佳候选的**逐层灵敏度**（±1 nm 有限差分：ΔFoM/FoM、ΔT_vis、Δlog₁₀Rs）
  与**工艺窗口**（保持目标可行的单层厚度容差）。CLI：`omo-cli optimize`。
- 反推求值与正向仿真同源（同一物理引擎），自洽性由测试回灌验证；M2.5 NN 代理可作加速后端（尚未接入）。
- **已接入（M5 v2）**：引擎 `POST /optimize` → Go 任务 `kind=optimize`（报告 JSON 原样持久化 + 注入 `task_id`）
  → 前端「目标反推」页（目标表单 + 候选表 + 灵敏度展示），真实端到端冒烟已通过。
- **M5 剩余**：报告导出、遗传/贝叶斯等高级寻优、NN 代理加速。

### 3.5 文献对标（Benchmark）—— ✅ M2 完成（见 engine/src/omo/benchmark/ 与 docs/benchmarks/）
- 从高水平论文（如 *ACS Appl. Mater. Interfaces*、*Appl. Surf. Sci.*、*Adv. Opt. Mater.*、*Thin Solid Films* 等）提取
  （层结构、膜厚 → T / Rs / SE）实测数据点，存入 `docs/benchmarks/`（含来源、DOI、提取条件）。
- 对标框架自动运行仿真 vs 实测，输出 MAE / RMSE / 相对误差报告与可视化对比图。
- 对标结果用于**校准模型常数**（如金属层实际光学常数），形成"仿真—实测—校准"闭环。

### 3.6 神经网络代理模型（数据驱动加速）—— ✅ M2.5 已实现（v1：ITO/Ag/ITO 厚度输入，见 engine/src/omo/neural/）
> 已确认纳入计划（方向：**正向代理模型 Surrogate**）。

- **定位**：用 NN 逼近物理引擎的"结构参数 → 性能"映射，作为**仿真加速器与优化代理**；物理引擎仍是唯一验证基准，NN 不替代物理引擎。
- **数据来源**：由物理引擎（TMM / 方阻 / SE）批量生成训练数据（起步 5 万~50 万样本），随机采样膜厚、光学常数、电阻率参数空间；**文献实测数据仅用于事后校准与验证**（见 3.5），不作为主要训练数据。
- **输入/输出**：
  - 输入：各层厚度、光学常数（n/k 或介电函数参数）、电阻率；
  - 输出：T(λ)（固定波长网格上的向量回归，如 300–2500 nm 取 ~100 点）、Rs（**取 log 训练**，因跨数量级）、SE(f) 曲线（按频点向量回归）。
- **验收标准**：在独立验证集上与物理引擎对比（MAE / RMSE）；明确报告参数空间边界处的外推风险；训练与推理脚本可复现（固定随机种子、记录超参数、数据生成管线版本化）。
- **后续扩展**：基于可微代理模型做梯度优化与逆向设计（目标性能 → 推荐膜厚组合）。

---

## 4. 目录结构规划

```
OMOPredict/
├── AGENTS.md                  # 本文档（AI 代理入口）
├── README.md                  # 项目总览（用户视角）
├── LICENSE
├── .gitignore
├── docs/
│   ├── HANDOVER.md             # 交接报告（续接工作必读：状态/环境坑/续接计划）
│   ├── desktop.md              # 桌面版设计（Electron + 单用户 + stdio IPC；T1–T11 拆解）
│   ├── physics/               # 物理模型文档（TMM、Drude、屏蔽理论）
│   ├── benchmarks/            # 文献对标数据集与来源（含 DOI）
│   └── api/                   # API 契约：对外 REST（rest.md）+ 引擎契约（engine.md）+ 桌面 RPC（rpc.md）
├── engine/                    # ── 数据科学层 ──（uv 项目）
│   ├── pyproject.toml         # 元数据 + pytest/ruff 配置；可选 extras：api / neural / plot
│   ├── README.md
│   ├── .python-version        # 锁定 Python 3.12
│   ├── src/omo/               # 包模式划分（仿 Go：一个模块、多个职责包）
│   │   ├── __init__.py
│   │   ├── constants.py       # 通用物理常数集中管理（含 CODATA 来源）
│   │   ├── materials.py       # 共享材料解析 MaterialResolver（benchmark/校准/API/RPC 同源）
│   │   ├── sim.py             # 中立编排层（Web/桌面共用；只依赖物理子包 + numpy）
│   │   ├── optics/            # TMM、Drude–Lorentz（M1）
│   │   ├── electrical/        # 方阻、尺寸效应（M1）
│   │   ├── emi/               # 屏蔽效能（M1）
│   │   ├── optimize/          # 目标反推（M5 v1：约束网格扫描 + FoM 排序 + 灵敏度/工艺窗口）
│   │   ├── neural/            # NN 代理模型（M2.5 完成：v1 代理，T/Rs/SE 精度 <0.1%）
│   │   ├── benchmark/         # 文献对标与校准（M2 完成：框架 + 3 篇数据集 + 校准）
│   │   ├── api/               # FastAPI 传输层（M3：/health、/simulate；M5 v2：/optimize）
│   │   ├── rpc/               # stdio JSON-RPC 传输层（M6-a T4：ping/simulate/optimize）
│   │   └── cli/               # 命令行入口（omo-cli：--version/--info/optimize）
│   └── tests/                 # 单元测试 + 文献基准测试 + RPC/import 图测试
├── desktop/                   # ── 桌面壳（Electron）──（T6 Host 层 + T7 壳；运行期验证属 T11）
│   ├── package.json           # 独立 pnpm 工程 + electron-builder 配置（打包脚本属 T8/T9）
│   ├── vitest.config.ts       # 单测（node 环境，会真拉起子进程）
│   ├── src/main.ts            # 主进程接线：窗口(app:// 协议)、菜单、IPC、单实例、优雅退出（T7）
│   ├── src/preload.ts         # contextBridge 白名单 → window.omo（T7）
│   ├── src/host/              # Host 层（T6，**不含 Electron**，故可纯 Node 单测）：
│   │                          #   paths 数据/日志目录 · logger 按天日志 · lines JSON-Lines 分帧
│   │                          #   rpc stdio JSON-RPC 客户端 · backend Go 子进程守护（重启限速/进程树回收）
│   │                          #   engine 引擎来源探测与友好指引 · singleton 单实例锁 · host 组装
│   ├── src/shell/             # 壳逻辑（T7，与 Electron 解耦以便单测）：appProtocol（app:// + CSP）
│   │                          #   channels（IPC 通道/信封）· preloadBridge · menu · windowOptions
│   │                          #   backendCommand（打包/开发期定位）· diagnostics（脱敏）
│   ├── lite/README.txt        # 轻量包 README 模板（build-lite.ps1 注入版本号）
│   └── test/fixtures/         # 假后端（真子进程，走真管道）
├── scripts/                   # 构建与运维脚本（T8 起；**注释一律 ASCII**，见 HANDOVER §6.19）
│   ├── setup-engine.ps1       # 轻量包用户准备引擎：uv sync 或 pip install -e + 发 ping 验证（T8）
│   ├── build-lite.ps1         # 组装轻量包 + 体积门禁（0 出包 / 1 失败 / 2 仅暂存）（T8）
│   └── README.md              # 用法、退出码、体积门禁与两条 .ps1 硬规矩
├── server/                    # ── Go 中间层 ──（M3 完成；M6-a 增单用户模式与 RPC 分发器）
│   ├── cmd/omopredict/        # 主程序入口（HTTP 服务；--stdio 走 stdio JSON-RPC）
│   ├── internal/
│   │   ├── user/              # 用户注册/登录 + JWT（GORM：sqlite/mysql/postgres + bcrypt）
│   │   ├── model/             # 数据模型（膜结构、任务 kind=simulate|optimize、结果）—— snake_case JSON
│   │   ├── task/              # 任务编排（异步执行 + 调 Python 引擎；HTTP/stdio 单一来源）
│   │   ├── store/             # GORM 打开/迁移/.env 配置（日志默认走 stderr，保护 stdio 协议）
│   │   ├── mode/              # 运行模式（OMO_AUTH_MODE=jwt|none、OMO_ENGINE_TRANSPORT=http|stdio）
│   │   ├── rpc/               # stdio JSON-RPC 分发器（M6-a T3；contract_test 与 HTTP 逐字段比对）
│   │   └── api/               # REST 路由与中间件（/health、/version、/api/meta、/api/tasks）
│   └── go.mod
└── frontend/                  # ── Vue 3 + TS 前端 ──（M4 完成；M5 v2 增「目标反推」页）
    ├── package.json           # pnpm 工程（pnpm-lock.yaml / pnpm-workspace.yaml）
    ├── vite.config.ts         # /api 代理到 Go :8080（开发期规避 CORS，OMO_SERVER_URL 可覆盖）
    ├── vitest.config.ts       # 单测配置（jsdom；复用 vite 的 @ 别名）
    ├── tsconfig{,.app,.node}.json / eslint.config.js / .prettierrc.json
    ├── index.html / public/
    └── src/
        ├── views/             # 页面（Login / Design / Optimize / TaskDetail / History）
        ├── components/        # 图表（SpectrumChart / SeChart）、StatusBadge、HelpTip
        ├── composables/       # useEChart（ECharts 生命周期封装）
        ├── api/               # 传输层：transport.ts（http | ipc 二选一）+ client.ts（统一入口/401）+
        │                      # token.ts（凭证）+ meta.ts（能力端点）+ auth/tasks 接口
        ├── stores/            # Pinia：auth（token/user + authRequired/isLocalMode 门禁）
        ├── router/            # 路由 + 认证守卫
        ├── content/           # 集中文案（help.ts 悬浮提示、materials.ts 材料预设）
        ├── types/             # 与 REST 契约对齐的 TS 类型（snake_case）
        ├── utils/             # 数值格式化等工具
        └── styles/            # 全局样式
```

> 当前仓库处于 **M6-c 阶段（T1–T8 已完成）**：M4 前端与 M5（引擎反推 v1 + API/前端接入 v2）全部落地，
> 桌面形态亦已成形——单用户模式（`OMO_AUTH_MODE=none` + `GET /api/meta`）、
> 任务删除（`DELETE /api/tasks/{id}`）、Go 侧 stdio RPC 分发器（`omopredict --stdio`）、
> 引擎侧中立编排层 `omo.sim` + `omo.rpc` 入口 + 可选依赖化（基础仅 numpy/scipy）、
> **Go→引擎 stdio 传输**（实测无监听端口）、**前端传输抽象与能力门禁**、
> **桌面 Host 层**与 **Electron 壳**（主进程 + preload + `app://` + 菜单 + IPC）、
> **轻量包脚本与体积门禁**（`scripts/`）。
> 测试现状：Python **132 passed** / ruff 0；Go 全量测试通过（含 12 个 stdio 引擎用例）；
> 前端 `pnpm lint` 0 告警 + `pnpm test`（5 文件 60 用例）+ `pnpm build` 通过；
> 桌面 `pnpm type-check`（对真实 Electron 类型）+ `pnpm test`（**12 文件 150 用例**，
> 另有 3 个需环境变量门控的真实端到端集成用例，已实跑通过）；`scripts/` 两脚本本机实跑过。
> API 契约见 `docs/api/`（rest / engine / rpc）。
>
> ⚠️ **"壳真的能启动并渲染"仍未验证**：本环境装不了 Electron 二进制，属 **T11 净机验收**。
> ✅ **体积门禁已决（2026-09）**：轻量包保留内嵌 Electron，整包上限由 50MB **放宽到 150MB**，
> 并新增 **app payload ≤50MB** 紧门禁负责防可选依赖泄漏（详见 `docs/desktop.md` §7）。
> **下一步 T9**：`rpc-cli.ps1`、`build-desktop.ps1`（含 PyInstaller 引擎）、CI 六 job 与 Release；
> 随后 T10 文档收尾、T11 净机验收。

---

## 5. 开发计划（里程碑）

| 阶段 | 目标 | 关键交付物 |
|---|---|---|
| **M0** | 项目脚手架 | 本文件、README、目录骨架、CI 模板 |
| **M1** | Python 物理引擎核心 | TMM 光学模块 + 方阻模块 + SE 模块，单层/三层验证通过 |
| **M2** | 文献对标框架 | 首批 benchmark 数据集（≥3 篇文献）、对标报告、模型校准 |
| **M2.5** | NN 代理模型（Surrogate） | 仿真数据生成管线 + 正向代理 NN（T / Rs / SE），推理加速与精度验收通过 |
| **M3** | Go 中间层 | 用户系统、膜结构/任务数据模型、任务编排、REST API |
| **M4** | Vue 前端 | 参数设计页、仿真结果图表、任务历史、对标对比展示（**已完成**：登录/注册、膜层设计、ECharts 结果图、任务历史） |
| **M5** | 优化与工艺指导 | 参数优化、灵敏度分析、报告导出（**v1 引擎反推 + v2 API/前端接入均已完成**：约束网格扫描 + FoM 排序 + 逐层灵敏度/工艺窗口；引擎 `POST /optimize` → Go `kind=optimize` → 前端「目标反推」页；剩余：报告导出、高级寻优、NN 代理加速） |
| **M6** | 集成与打磨 | 端到端联调、文档完善、示例数据与演示；**扩展：桌面版**（M6-a/b/c T1–**T8** ✅ 单用户模式 / 任务删除 / Go RPC 分发器 / 引擎编排下沉 / **Go→引擎 stdio 传输** / **前端传输抽象+能力门禁** / **Electron Host 层** / **Electron 壳** / **轻量包与体积门禁**；M6-c T9 ⏳ `rpc-cli.ps1` / `build-desktop.ps1`（PyInstaller 引擎）/ CI 六 job / Release；M6-d T10–T11 ⏳ 文档收尾 / **净机验收（含壳运行期验证）**） |

**当前进度**：M4 ✅ + M5 ✅（v1 引擎反推 19 测试全过、默认 4k 组合 ~3 s；v2 API/前端接入端到端冒烟通过）+ **M6-a/b/c ✅（T1–T8：桌面双链路 + 前端门禁 + Host 层 + Electron 壳 + 轻量包）**。
下一步 **T9（`rpc-cli.ps1`、`build-desktop.ps1`、CI 六 job、Release）**；"无端口"已由 T4.5 解锁并实测（见 §2），**壳运行期验证属 T11**。

**阶段完成标准**：每个里程碑必须有可运行的代码 + 测试通过 + 文档更新，不允许"只写代码不验证"。

---

## 6. 对 AI 代理的工作守则

1. **先读 AGENTS.md 再动手**：新任务开始时先读本文档与 `docs/` 相关部分，确认物理模型与架构约定。
2. **物理正确性优先**：
   - 所有常数、公式必须有文献出处注释；**禁止无依据地修改物理常数**去"拟合"结果。
   - 新增物理模型时同步更新 `docs/physics/` 对应文档。
   - 模型行为变化必须重新跑 benchmark 测试，确认对标误差不劣化。
3. **测试不可省略**：Python 侧每个物理模块要求单元测试 + 文献基准测试；Go 侧要求 handler/存储层测试；前端组件可酌情。
4. **代码风格**：
   - Python：ruff + type hints（`pyproject.toml` 统一配置）。
   - Go：gofmt + golangci-lint，遵循标准项目布局。
   - Vue/TS：ESLint + Prettier，Composition API + `<script setup>`。
5. **提交规范**：Conventional Commits（`feat:` / `fix:` / `docs:` / `test:` / `refactor:` …）。
6. **分层纪律**：物理逻辑只允许出现在 Python 层；Go 层不得复制物理公式；前端不得自行计算结果。
7. **沟通语言**：代码注释与提交信息建议中英均可但保持一种语言一致；接口字段命名统一用英文（snake_case for JSON）。
8. **小而美的增量**：每个 PR / 提交只做一件事，方便审查与回滚。
9. **NN 专项守则（M2.5 起生效）**：
   - 训练数据一律由物理引擎生成并**版本化**（固定随机种子、记录生成管线版本）；禁止混入来源不明的私有数据。
   - 必须划分独立验证集且**覆盖参数空间边界**，报告外推风险；NN 精度永远以物理引擎为基准衡量。
   - 跨数量级目标（如 Rs）取 log 后再训练；光谱输出用固定波长网格向量回归。
   - 模型交付必须附带**可复现脚本**（数据生成种子、超参数、训练配置）与验证误差报告，不交付"黑盒权重"。
10. **注释与包文档（强制）**：
   - 所有公开函数/类必须有完整 docstring：用途、参数、返回值、异常；关键物理公式标注**文献来源与单位**。
   - 每个 Python 子包目录下必须有 `README.md`：写明该包**职责**、核心模块、**调用示例**（可复现的最小代码片段）。
   - 非显然的推导与"魔法数字"必须注释说明出处；禁止出现无来源注释的常量（物理常数约定见 `engine/src/omo/constants.py`）。
   - 新增/修改子包时同步维护其 `README.md`，保持文档与代码一致。

---

## 7. 常用命令

```bash
# Python 数据科学层（目录 engine/）
#   注意：uv run 按 extras 精确同步，未带 --all-extras 会把 fastapi/torch 从 .venv 移除
cd engine && uv sync --all-extras         # 首次/改依赖后：装齐 api + neural + plot
cd engine && uv run --all-extras pytest   # 运行测试（含文献基准）
cd engine && uv run ruff check src tests  # 代码检查
cd engine && uv run omo-cli --info        # CLI 入口
cd engine && uv run omo-cli optimize --min-t 0.85 --max-rs 12 --min-se 25   # 目标反推（M5 v1）
cd engine && uv run python -m omo.rpc     # stdio JSON-RPC 引擎入口（桌面形态）

# Go 中间层
cd server && go build ./...
cd server && go vet ./...
cd server && go test ./...
cd server && go run ./cmd/omopredict                              # HTTP 服务（Web 形态）
cd server && OMO_AUTH_MODE=none go run ./cmd/omopredict --stdio   # stdio JSON-RPC（桌面形态；引擎仍走 HTTP）
# 桌面形态（无端口）：Go 侧 RPC + Go→引擎 stdio；OMO_ENGINE_CMD 支持引号包裹含空格的路径
cd server && OMO_AUTH_MODE=none OMO_ENGINE_TRANSPORT=stdio OMO_ENGINE_CMD='python -m omo.rpc' go run ./cmd/omopredict --stdio

# 前端
cd frontend && pnpm install
cd frontend && pnpm dev                   # 开发服务器（/api 代理到 Go :8080）
cd frontend && pnpm lint                  # ESLint（0 告警为通过标准）
cd frontend && pnpm test                  # vitest 单测（jsdom；传输/门禁/守卫/历史页删除）
cd frontend && pnpm build                 # vue-tsc -b + vite build

# 桌面壳（Host 层 T6 + Electron 壳 T7）
cd desktop && pnpm install
cd desktop && pnpm type-check             # tsc --noEmit（含真实 Electron 类型）
cd desktop && pnpm test                   # vitest（node；用例会真拉起子进程）
# 真实端到端集成测试默认跳过，需显式给出后端与引擎（详见 desktop/README.md）：
#   OMO_BACKEND_EXE=<omopredict.exe> OMO_ENGINE_CMD='python -m omo.rpc' pnpm vitest run src/host/integration.test.ts
# 启动壳（需 Electron 二进制；本环境尚未下载，见 docs/desktop.md §13）：pnpm exec electron dist/main.js

# 打包与运维脚本（T8；Windows 优先，但已写成可跨平台）
powershell -ExecutionPolicy Bypass -File scripts\setup-engine.ps1              # 轻量包用户准备引擎
powershell -ExecutionPolicy Bypass -File scripts\setup-engine.ps1 -SkipInstall # 只验证引擎可用
powershell -ExecutionPolicy Bypass -File scripts\build-lite.ps1               # 出轻量包（0 出包/1 失败/2 仅暂存）
```

> 端到端联调步骤、端口占用与其它环境坑见 `docs/HANDOVER.md` §3 与 §6。

---

## 8. 约定与术语表

| 术语 | 含义 |
|---|---|
| OMO | Oxide-Metal-Oxide，氧化物/金属/氧化物三层膜系 |
| TMM | Transfer Matrix Method，传输矩阵法（光学） |
| Rs | Sheet Resistance，方阻（Ω/sq） |
| SE | Shielding Effectiveness，屏蔽效能（dB） |
| T | Transmittance，透过率（%） |
| FoM | Figure of Merit，品质因子（如 T¹⁰/Rs） |
| 对标 | 用高水平论文实测数据校验仿真结果 |

---

*最后更新：T8（轻量包 + 体积门禁）完成。每次架构、物理模型或里程碑变更时，记得同步更新本文件。*
