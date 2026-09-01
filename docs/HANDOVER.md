# OMOPredict 交接报告（HANDOVER）

> 给**后续 agent** 的当前状态与续接指南。请先读本文件与 `AGENTS.md`（项目宪法），
> 再按需阅读下文文档索引中的对应文档。
> 最后更新：M4 完成（2026-09）。

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
| M5/M6 | ⏳ | 优化 / 集成 | 待做 |

测试现状：Python **72 passed / ruff 0**（本机沙箱 4 个 tmp_path 用例报 PermissionError，属环境限制非代码问题）；Go 全量测试通过（api/model/store/user/task）；前端 `pnpm lint` 0 告警 + `vue-tsc -b` + `vite build` 通过。

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
| optics/ | TMM（transfer_matrix.py）、Drude（drude.py）、常数材料（materials.py） |
| electrical/ | sheet_resistance.py（并联+FS）、materials.py（ρ/λ） |
| emi/ | shielding.py（传输线+Schelkunoff+薄膜近似）、materials.py |
| benchmark/ | schema/materials(已迁出)/runner/metrics/report/calibrate |
| neural/ | data.py（引擎生成数据）、model.py（MLP）、validate.py |
| api/ | schemas.py / service.py / main.py（FastAPI /simulate） |
| cli/ | omo-cli（--version/--info；simulate 子命令待做） |
| optimize/ | 空骨架（M5） |

**server/internal/**（Go）：api（路由+认证+任务 handler）、user（bcrypt+JWT+GORM）、
model（FilmStack/SimulationTask/TaskResult）、store（GORM Open/Migrate/.env）、task（engine 客户端+异步编排）。

**frontend/**（Vue 3 + TS，M4 完成）：`src/api/`（http 封装 + auth/tasks 接口）、`src/stores/`（Pinia auth）、
`src/router/`（认证守卫）、`src/views/`（Login/Design/TaskDetail/History）、`src/components/`（SpectrumChart/SeChart/StatusBadge）、
`src/composables/useEChart.ts`（ECharts 按需注册 + 生命周期）、`vite.config.ts`（/api 代理到 Go :8080）。

## 5. 文档索引

| 文档 | 内容 |
|---|---|
| `AGENTS.md` | 项目宪法：架构/物理模型/守则/里程碑 |
| `docs/physics/{tmm,electrical,emi}.md` | 物理模型与公式来源 |
| `docs/benchmarks/README.md` + `calibration.md` | 数据集格式 + 校准方法/结果 |
| `docs/api/README.md` + `rest.md` + `engine.md` | API 契约（对外 REST / Go→Python） |
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
10. **npm 源**：本机 npm registry 已是 npmmirror（`npm config get registry`），pnpm 安装正常。
11. **pnpm 11 + 受限环境**：pnpm 11 的 settings 在 `pnpm-workspace.yaml`（package.json 的 `pnpm` 字段已废弃）；
    esbuild 构建脚本在 `allowBuilds` 中显式关闭（二进制由 optionalDependencies 提供）。
    沙箱内 `vite build`/`vite dev` 因 esbuild IPC 需完整文件权限；CI（Linux）无此限制。
12. **curl.exe 传参坑**：本机 PowerShell → curl.exe 传 `-d '{...}'` 会被剥引号导致 JSON 损坏，
    联调一律用 `--data-binary "@文件"`（或 Invoke-RestMethod）。
13. **Vite 绑定**：dev server 绑定 IPv6 `::1`，浏览器/联调用 `http://localhost:5173`（127.0.0.1 不通）。
14. **前端类型检查**：`vue-tsc` 须用 `-b`（build 模式）才会真正检查引用项目（`--noEmit` 直接跑会静默跳过）；
    模板字符串 `ref="x"` 不计为 setup 变量读取（TS6133），组件容器 ref 请传入 composable 并在 JS 中读取。

## 7. 未完成事项与后续计划

**M4（Vue 3 + TS + Vite）前端 —— ✅ 已完成（2026-09）**：
- 页面：登录/注册 → 参数设计页（膜层表 + 体系模板 + 衬底折射率）→ 提交任务（`POST /api/tasks`）→
  轮询结果页（ECharts 画 T(λ)/R(λ) + SE(f) 曲线 + Rs 卡片）→ 任务历史（`GET /api/tasks`）
- API 封装：`src/api/` 对接 `docs/api/rest.md`；Vite 代理 `/api` → Go :8080（规避 CORS）
- CI：workflow 新增 frontend job（pnpm install --frozen-lockfile + lint + build）
- 验证：vue-tsc -b / eslint 0 告警 / vite build 通过；端到端联调值对齐引擎契约示例
  （Rs=3.9708 Ω/sq、T@550nm=0.9745、SE@10GHz=33.70 dB）
- 注意：Go 服务未配 CORS，生产部署需在反向代理层完成 /api 转发

**M5（优化）**：`omo/optimize/` 实现参数扫描/优化（可用 NN 代理加速）、灵敏度分析、报告导出；
前端可加"优化模式"入口。
**M6（集成）**：部署（Go 静态托管 frontend/dist + CORS 配置）、示例数据与演示、端到端测试完善。

**其他可做**：`omo-cli simulate` 子命令（M1 计划过）；benchmark 数据集扩充（更多体系）；
NN 代理 v2（材料参数入特征 / 逆向设计）。

## 8. 续接 checklist

1. 读 `AGENTS.md` §6 守则 + 本文件 §6 环境坑
2. 跑通现有验证：`cd engine && uv run pytest -q`（72 passed）、`cd server && go test ./...`
3. 若做 M4：按 §7 计划，先建 frontend/ 脚手架（pnpm create vite），再接 API
4. 改动物理模型时：更新 docs/physics + 重跑 benchmark（守则 §2/§3）
5. 提交规范：Conventional Commits；每里程碑可运行 + 测试 + 文档
