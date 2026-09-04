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
| **数据科学层** | Python（numpy / scipy） | 物理建模与仿真计算：光学、电学、电磁屏蔽、参数优化、文献对标 |
| **中间层** | Go | 用户管理、数据持久化、仿真任务编排、对外 REST API |
| **前端** | Vue 3 + TypeScript（Vite） | 参数输入、结果图表可视化、任务历史、对标报告展示 |

**服务间通信约定**：前端只与 Go 中间层通信；Go 中间层通过 HTTP（FastAPI 微服务）调用 Python 仿真引擎。
Python 侧同时提供可独立运行的 CLI，便于脚本化批量仿真与对标。

```
┌────────────┐   REST/JSON   ┌──────────────┐   HTTP   ┌──────────────────┐
│  Vue3+TS   │ ────────────▶ │     Go       │ ───────▶ │  Python (FastAPI)│
│  前端 UI   │ ◀──────────── │ 用户/存储/任务│ ◀─────── │  物理仿真引擎     │
└────────────┘               └──────────────┘          └──────────────────┘
```

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

### 3.4 综合指标与优化—— ✅ M5 v1 已完成（engine 层，见 engine/src/omo/optimize/）
- **品质因子**：Haacke FoM = T¹⁰ / Rs（G. Haacke, J. Appl. Phys. 47, 4086 (1976)），用于候选横向对比。
- **参数优化（目标反推 v1）**：硬约束（T_vis ≥ x / Rs ≤ y / SE ≥ z，可任选）下的
  三层膜厚**网格扫描寻优**（默认 ITO/Ag/ITO：外层 20–80 步长 4、金属 5–20 步长 1 ≈ 4k 组合，
  进程内 ~3 s），可行候选按 FoM 排序，另给 best_effort（无可行解时的最接近参考）。
- **工艺指导**：最佳候选的**逐层灵敏度**（±1 nm 有限差分：ΔFoM/FoM、ΔT_vis、Δlog₁₀Rs）
  与**工艺窗口**（保持目标可行的单层厚度容差）。CLI：`omo-cli optimize`。
- 反推求值与正向仿真同源（同一物理引擎），自洽性由测试回灌验证；M2.5 NN 代理可作加速后端（尚未接入）。
- **M5 剩余**：优化 API/前端接入、报告导出、遗传/贝叶斯等高级寻优、NN 代理加速。

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
│   ├── HANDOVER.md             # 交接报告（续接工作必读：状态/环境坑/M4 计划）
│   ├── physics/               # 物理模型文档（TMM、Drude、屏蔽理论）
│   ├── benchmarks/            # 文献对标数据集与来源（含 DOI）
│   └── api/                   # API 契约：对外 REST（rest.md）+ 引擎契约（engine.md）
├── engine/                    # ── 数据科学层 ──（uv 项目，脚手架已完成）
│   ├── pyproject.toml         # 项目元数据 + pytest/ruff 配置（依赖用 uv add 管理）
│   ├── README.md
│   ├── .python-version        # 锁定 Python 3.12
│   ├── src/omo/               # 包模式划分（仿 Go：一个模块、多个职责包）
│   │   ├── __init__.py
│   │   ├── constants.py       # 通用物理常数集中管理（含 CODATA 来源）
│   │   ├── optics/            # TMM、Drude–Lorentz（M1）
│   │   ├── electrical/        # 方阻、尺寸效应（M1）
│   │   ├── emi/               # 屏蔽效能（M1）
│   │   ├── optimize/          # 目标反推 v1（M5 完成：约束网格扫描 + FoM 排序 + 灵敏度/工艺窗口）
│   │   ├── neural/            # NN 代理模型（M2.5 完成：v1 代理，T/Rs/SE 精度 <0.1%）
│   │   ├── benchmark/         # 文献对标与校准（M2 完成：框架 + 3 篇数据集 + 校准）
│   │   ├── api/               # FastAPI 服务（M3 完成：/simulate + /health）
│   │   └── cli/               # 命令行入口（omo-cli，M1 起可用）
│   └── tests/                 # 单元测试 + 文献基准测试
├── server/                    # ── Go 中间层 ──（M3 完成：用户/存储/任务编排，端到端打通）
│   ├── cmd/omopredict/        # 主程序入口（HTTP 服务，优雅退出）
│   ├── internal/
│   │   ├── user/              # 用户注册/登录 + JWT（GORM：sqlite/mysql/postgres + bcrypt）
│   │   ├── model/             # 数据模型（膜结构、任务、结果）—— snake_case JSON
│   │   ├── task/              # 任务编排（M3 完成：异步执行 + 调 Python 引擎）
│   │   └── api/               # REST 路由与中间件（/health、/version）
│   └── go.mod
└── frontend/                  # ── Vue 3 + TS 前端 ──（M4 完成）
    ├── package.json           # pnpm 工程（pnpm-lock.yaml / pnpm-workspace.yaml）
    ├── vite.config.ts         # /api 代理到 Go :8080（开发期规避 CORS，OMO_SERVER_URL 可覆盖）
    ├── tsconfig{,.app,.node}.json / eslint.config.js / .prettierrc.json
    ├── index.html / public/
    └── src/
        ├── views/             # 页面（Login / Design / TaskDetail / History）
        ├── components/        # 图表（SpectrumChart / SeChart）、StatusBadge
        ├── composables/       # useEChart（ECharts 生命周期封装）
        ├── api/               # HTTP 客户端（JWT/错误统一处理）+ auth/tasks 接口
        ├── stores/            # Pinia：auth（token/user 持久化）
        ├── router/            # 路由 + 认证守卫
        ├── types/             # 与 REST 契约对齐的 TS 类型（snake_case）
        └── styles/            # 全局样式
```

> 当前仓库处于 **M4 阶段（已完成）**：Python omo.api（/simulate）、Go 用户系统
> （JWT + GORM 多库 + .env 配置）、任务编排（异步执行 → 调 Python 引擎 → 结果持久化）、
> Vue 3 前端（登录/参数设计/结果图表/任务历史）全部落地，端到端冒烟通过
> （浏览器代理 → Go → uvicorn → T/Rs/SE 回传渲染）；API 契约见 docs/api/。
> 下一步 M5（优化与工艺指导）。

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
| **M5** | 优化与工艺指导 | 参数优化、灵敏度分析、报告导出（**v1 引擎层目标反推完成**：约束网格扫描 + FoM 排序 + 逐层灵敏度/工艺窗口，CLI `omo-cli optimize`；剩余：API/前端接入、报告导出、高级寻优） |
| **M6** | 集成与打磨 | 端到端联调、文档完善、示例数据与演示 |

**当前进度**：M4 ✅ 完成（Vue 3 前端）+ M5 v1 ✅ 完成（omo.optimize 目标反推：约束网格扫描、FoM 排序、灵敏度与工艺窗口，19 测试全过、默认 4k 组合 ~3 s）；下一步 M5 剩余（优化 API/前端接入、报告导出、NN 代理加速）。

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

## 7. 常用命令（规划中，随脚手架落地）

```bash
# Python 数据科学层（脚手架已就绪，目录 engine/）
cd engine && uv run pytest                # 运行测试（含文献基准）
cd engine && uv run ruff check src tests  # 代码检查
cd engine && uv run omo-cli --info        # CLI 入口

# Go 中间层（M3 起可用）
cd server && go build ./...
cd server && go vet ./...
cd server && go test ./...

# 前端（M4 后可用）
cd frontend && pnpm install
cd frontend && pnpm dev
```

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

*最后更新：M5 v1（引擎层目标反推）完成。每次架构或物理模型变更时，记得同步更新本文件。*
