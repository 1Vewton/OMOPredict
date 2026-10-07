# omo —— 数据科学层

> **中文** · [English version](README.en.md)

OMO 纳米多层薄膜轻量化仿真与设计软件的数据科学层：物理仿真引擎 + NN 代理模型。

## 包结构（Go 式包划分）

| 包 | 职责 | 里程碑 |
|---|---|---|
| `omo.optics` | 光学仿真：TMM、Drude–Lorentz | M1 |
| `omo.electrical` | 电学仿真：方阻、尺寸效应 | M1 |
| `omo.emi` | 电磁屏蔽效能 | M1 |
| `omo.sim` | **仿真/反推编排（中立层）**：Web 与桌面共用，不含框架依赖 | M6-a T4 |
| `omo.benchmark` | 文献对标与误差评估 | M2 |
| `omo.neural` | NN 代理模型（仿真加速） | M2.5 |
| `omo.api` | FastAPI 服务（HTTP 传输适配，供 Go 中间层调用） | M3 |
| `omo.rpc` | **stdio JSON-RPC 入口**（桌面传输适配，`python -m omo.rpc`） | M6-a T4 |
| `omo.optimize` | 参数优化与工艺指导 | M5 |
| `omo.cli` | 命令行入口（omo-cli） | 已可用 |

每个子包目录下都有 `README.md`：职责说明 + 调用示例（AGENTS.md §6 第 10 条强制要求）。

## 依赖分层（extras）

基础依赖只有 **numpy / scipy**（`omo.sim` + 物理子包即可用，桌面引擎只需这些）；
其余按形态作为可选依赖安装：

| extra | 内容 | 用途 |
|---|---|---|
| `api` | fastapi / pydantic / uvicorn | HTTP 服务形态（Web、开发） |
| `neural` | torch | NN 代理模型（桌面完整包会排除） |
| `plot` | matplotlib | 对标报告绘图 |

```bash
uv sync --all-extras    # 开发/CI：装齐全部 extras
uv sync                 # 精简：仅基础依赖（桌面引擎形态）
```

> ⚠️ `uv run` 会按 extras **精确同步**环境（未显式带 `--extra`/`--all-extras` 时会移除已装的
> fastapi/torch 等）——跑测试或前端联调前请先 `uv sync --all-extras`，或用
> `uv run --all-extras pytest`。

## 常用命令

```bash
uv sync --all-extras         # 装齐依赖（测试与联调必需）
uv run pytest                # 运行测试（含文献基准）
uv run ruff check src tests  # 代码检查
uv run omo-cli --info        # CLI 入口
uv run python -m omo.rpc     # stdio JSON-RPC 入口（桌面形态；协议见 docs/api/rpc.md）
```

## 环境说明

- Python 版本锁定 3.12（见 `.python-version`）
- 依赖管理用 uv：新增依赖 `uv add <pkg>`，开发依赖 `uv add --dev <pkg>`
- 本仓库沙箱环境将 uv 缓存指向工作区（`.uv-cache/`、`.uv-python/`，已 gitignore）；本地开发无需该配置
