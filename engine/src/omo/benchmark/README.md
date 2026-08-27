# omo.benchmark —— 文献对标与误差评估（M2 框架已实现）

## 职责

用高水平论文实测数据校验仿真结果（本项目差异化目标的核心）：

- 加载 `docs/benchmarks/` 下的文献数据集（含来源、DOI、提取条件）
- 自动运行仿真 vs 实测，输出 MAE / RMSE / 相对误差报告与可视化对比图
- 支持模型常数校准闭环：仿真 — 实测 — 校准（M2.3）

## 已实现模块

| 模块 | 职责 |
|---|---|
| `schema.py` | 数据集数据模型 + JSON 加载/校验（`load_dataset` / `parse_dataset`，格式错误抛 `SchemaError`） |
| `materials.py` | 材料名 → 引擎输入（光学 + 电学）；`MaterialResolver` 支持数据集覆盖（校准产物） |
| `runner.py` | `simulate_record`：按 measured 声明的量分发到 optics/electrical/emi |
| `metrics.py` | `compute_metrics`：MAE / RMSE / 最大绝对误差 / 相对 MAE |
| `report.py` | `run_benchmark`：按量聚合 + 逐记录明细；JSON 输出 + 实测 vs 仿真散点图（PNG） |

## 如何调用

```python
from omo.benchmark import load_dataset, run_benchmark

dataset = load_dataset("docs/benchmarks/synthetic_ito_ag_ito.json")
report = run_benchmark(dataset)

report.quantities            # {"transmittance": QuantityMetrics, "sheet_resistance_log10": ...}
report.quantities["transmittance"].mae
report.to_dict()             # JSON 化（metrics + 逐记录错误）
report.save_json("report.json")
report.plot("report.png")    # 实测 vs 仿真散点图
```

方阻在 **log₁₀ 空间**评估（跨数量级）；透过率/反射率/SE 用绝对值。
支持记录缺项：只有 Rs 的记录不会触发光学/屏蔽仿真。

## 数据集格式

见 `docs/benchmarks/README.md`（JSON schema 全貌）与 `docs/benchmarks/synthetic_ito_ag_ito.json`（示例）。

要点：
- 每条记录：层结构（material + thickness_nm）+ measured（T/R 波长点、Rs、SE 频点/X 波段平均，任意子集）
- 必须带论文元数据（title/authors/year/**DOI**）与提取条件（extraction）
- 透过率/反射率为小数（0–1）；Rs 单位 Ω/sq；SE 单位 dB
- `simulation.materials` 段可覆盖材料常数（M2.3 校准产物）

## 验证

- `tests/test_benchmark.py`：schema 校验（缺字段/非法值/空记录）、
  合成数据往返（框架复现引擎输出，MAE < 1e-9）、材料覆盖、缺项记录、报告 JSON/PNG 输出
