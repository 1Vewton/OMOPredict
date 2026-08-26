# omo.benchmark —— 文献对标与误差评估

## 职责

用高水平论文实测数据校验仿真结果（本项目差异化目标的核心）：

- 加载 `docs/benchmarks/` 下的文献数据集（含来源、DOI、提取条件）
- 自动运行仿真 vs 实测，输出 MAE / RMSE / 相对误差报告与可视化对比图
- 支撑模型常数校准闭环：仿真 — 实测 — 校准

## 核心模块（计划，M2 实现）

- `datasets.py`：文献数据加载与格式校验
- `metrics.py`：MAE / RMSE / 相对误差
- `report.py`：对标报告与可视化

## 如何调用（计划接口，M2 落地后生效）

```python
from omo.benchmark import run_benchmark

report = run_benchmark(dataset="docs/benchmarks/ito_ag_ito.json")
print(report.metrics)  # {"T_mae": 0.012, "Rs_rmse_log": 0.08, ...}
```

## 数据格式约定

- 每条记录：层结构、膜厚、实测 T / Rs / SE、来源 DOI、提取条件
- 数据文件放 `docs/benchmarks/`，命名 `体系_作者年份.json`
