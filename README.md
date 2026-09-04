# OMOPredict

聚焦 **OMO（Oxide-Metal-Oxide）纳米多层薄膜体系** 的轻量化仿真与设计软件，
面向大学生科研与课程设计：输入各层厚度 / 折射率 / 电阻率，输出**光学透过率、
方阻、电磁屏蔽效能**，并**严格对标高水平论文实测数据**，实现性能精准预测与工艺优化指导。

## 三层架构

```
┌────────────┐  REST/JSON   ┌──────────────┐   HTTP   ┌──────────────────┐
│  Vue3+TS   │ ────────────▶ │     Go       │ ───────▶ │  Python (FastAPI)│
│  前端 UI   │ ◀──────────── │ 用户/存储/任务│ ◀─────── │  物理仿真引擎     │
└────────────┘               └──────────────┘          └──────────────────┘
```

| 层 | 技术 | 目录 | 职责 |
|---|---|---|---|
| 数据科学层 | Python（numpy/scipy/torch） | `engine/` | TMM 光学、方阻、屏蔽、文献对标、NN 代理模型 |
| 中间层 | Go（GORM） | `server/` | 用户/JWT、SQLite/MySQL/PostgreSQL、任务编排 |
| 前端 | Vue 3 + TypeScript | `frontend/` | 参数设计、结果图表可视化、任务历史 |

## 功能状态（里程碑）

- ✅ M0 脚手架 + CI（Python ruff/pytest + Go fmt/vet/build/test + 前端 lint/build）
- ✅ M1 物理引擎：TMM + Drude、并联方阻 + Fuchs–Sondheimer、传输线屏蔽（44 测试）
- ✅ M2 文献对标：3 篇真实数据集 + 校准闭环（灵敏度分析 → 拟合 → 留出验证）
- ✅ M2.5 NN 代理模型：20k 训练，T/Rs/SE 精度 <0.1%
- ✅ M3 Go 中间层：JWT 认证 + GORM 多库 + 任务编排（Go→Python 端到端打通）
- ✅ M4 Vue 前端：登录/注册、膜层参数设计、ECharts 结果图表（T/Rs/SE）、任务历史（Vite 代理联调通过）
- ✅ M5 v1 目标反推（引擎层）：给定性能目标（T/Rs/SE 约束）→ 网格扫描反推膜厚组合 + FoM 排序 + 灵敏度/工艺窗口（`omo-cli optimize`）
- ⏳ M5 剩余（API/前端接入、报告导出、NN 代理加速）/ M6 集成

## 快速开始

```bash
# 数据科学层（物理引擎 API，默认 :8000）
cd engine && uv run uvicorn omo.api.main:app --port 8000

# 目标反推（引擎层 CLI，体验 M5 v1）
cd engine && uv run omo-cli optimize --min-t 0.85 --max-rs 12 --min-se 25

# 中间层（默认 :8080，读取 server/.env；OMO_ENGINE_URL 指向引擎）
cd server && go run ./cmd/omopredict

# 前端（默认 :5173，/api 代理到 Go :8080）
cd frontend && pnpm install && pnpm dev

# 测试
cd engine && uv run pytest            # Python 全量测试
cd server && go test ./...            # Go 全量测试
cd frontend && pnpm lint && pnpm build  # 前端检查与构建
```

详细启动/配置/接口见文档索引。

## 文档索引

- **项目宪法（Agent 入口）**：`AGENTS.md`
- **交接报告（续接工作必读）**：`docs/HANDOVER.md`
- **物理模型**：`docs/physics/{tmm,electrical,emi}.md`
- **文献对标与校准**：`docs/benchmarks/`（README + calibration）
- **API 契约**：`docs/api/`（rest = 对外 REST，engine = Go→Python 契约）
- **各层**：`engine/README.md`、`server/README.md`、`frontend/README.md`
