# omo.optimize —— 参数优化与工艺指导

## 职责

在性能约束下寻找最优膜厚/层序组合，并输出工艺指导：

- 参数扫描（网格搜索起步）
- 约束寻优（遗传算法 / 贝叶斯优化）：如 T ≥ 85% 且 Rs ≤ 10 Ω/sq
- 灵敏度分析：识别对目标性能影响最大的膜厚

## 核心模块（计划，M5 实现）

- `scan.py`：网格扫描
- `optimizers.py`：遗传算法 / 贝叶斯优化
- `sensitivity.py`：灵敏度分析

## 如何调用（计划接口，M5 落地后生效）

```python
from omo.optimize import optimize

result = optimize(
    objective=lambda stack: -fom(stack),   # 最大化品质因子 FoM = T¹⁰/Rs
    constraints=[lambda s: transmittance(s) >= 0.85],
    bounds=[(20, 60), (5, 15), (20, 60)],  # ITO/Ag/ITO 厚度范围 (nm)
)
```

## 说明

- 依赖 `omo.optics` / `omo.electrical` / `omo.emi` 物理引擎
- M2.5 之后可改用 NN 代理模型（`omo.neural`）加速寻优
