"""电学仿真包：多层膜导电性能计算（M1 已实现）。

- 方阻 Rs（Ω/sq）：多层膜并联等效模型
- 超薄金属电阻率尺寸效应：Fuchs–Sondheimer 模型（精确积分式）
- 材料常数：Ag / ITO 电学参数（materials.py，标注文献来源）

物理模型与文献来源见 docs/physics/electrical.md。
"""

from __future__ import annotations

from omo.electrical.materials import (
    ITO_BULK_RESISTIVITY,
    SILVER_BULK_RESISTIVITY,
    SILVER_MEAN_FREE_PATH_NM,
)
from omo.electrical.sheet_resistance import (
    ConductiveLayer,
    fuchs_sondheimer_ratio,
    sheet_resistance,
)

__all__ = [
    "ConductiveLayer",
    "fuchs_sondheimer_ratio",
    "sheet_resistance",
    "SILVER_BULK_RESISTIVITY",
    "SILVER_MEAN_FREE_PATH_NM",
    "ITO_BULK_RESISTIVITY",
]
