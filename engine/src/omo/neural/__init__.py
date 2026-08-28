"""神经网络代理模型包（M2.5 已实现，v1：ITO/Ag/ITO 三层厚度输入）。

定位：用 NN 逼近物理引擎的「结构参数 → 性能」映射，作为仿真加速器与优化代理；
物理引擎仍是唯一验证基准，NN 不替代物理引擎。

模块：
- data.py：由物理引擎生成训练/验证/测试数据（固定种子、边界覆盖、版本化）
- model.py：MLP 正向代理（T(λ) 固定网格向量回归、Rs 取 log、SE(f) 向量回归），
  训练/预测/保存/加载
- validate.py：与物理引擎的 MAE/RMSE 对比与外推风险报告

v1 范围：ITO/Ag/ITO 三层，输入三个厚度（底氧化物/金属/顶氧化物）；
材料参数入特征为后续扩展。
"""

from __future__ import annotations

from omo.neural.data import (
    PIPELINE_VERSION,
    SurrogateConfig,
    SurrogateDataset,
    generate_dataset,
)
from omo.neural.model import (
    SurrogateModel,
    SurrogatePredictions,
    TrainConfig,
)
from omo.neural.validate import (
    SurrogateValidationReport,
    validate,
)

__all__ = [
    "PIPELINE_VERSION",
    "SurrogateConfig",
    "SurrogateDataset",
    "SurrogateModel",
    "SurrogatePredictions",
    "SurrogateValidationReport",
    "TrainConfig",
    "generate_dataset",
    "validate",
]
