# omo —— 数据科学层

OMO 纳米多层薄膜轻量化仿真与设计软件的数据科学层：物理仿真引擎 + NN 代理模型。

## 包结构（Go 式包划分）

| 包 | 职责 | 里程碑 |
|---|---|---|
| `omo.optics` | 光学仿真：TMM、Drude–Lorentz | M1 |
| `omo.electrical` | 电学仿真：方阻、尺寸效应 | M1 |
| `omo.emi` | 电磁屏蔽效能 | M1 |
| `omo.benchmark` | 文献对标与误差评估 | M2 |
| `omo.neural` | NN 代理模型（仿真加速） | M2.5 |
| `omo.api` | FastAPI 服务（供 Go 中间层调用） | M3 |
| `omo.optimize` | 参数优化与工艺指导 | M5 |
| `omo.cli` | 命令行入口（omo-cli） | 已可用 |

每个子包目录下都有 `README.md`：职责说明 + 调用示例（AGENTS.md §6 第 10 条强制要求）。

## 常用命令

```bash
uv run pytest                # 运行测试（含文献基准）
uv run ruff check src tests  # 代码检查
uv run omo-cli --info        # CLI 入口
```

## 环境说明

- Python 版本锁定 3.12（见 `.python-version`）
- 依赖管理用 uv：新增依赖 `uv add <pkg>`，开发依赖 `uv add --dev <pkg>`
- 本仓库沙箱环境将 uv 缓存指向工作区（`.uv-cache/`、`.uv-python/`，已 gitignore）；本地开发无需该配置
