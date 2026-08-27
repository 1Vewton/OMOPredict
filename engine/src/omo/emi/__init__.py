"""电磁屏蔽效能仿真包（M1 已实现）。

- 传输线模型：多层膜 SE(f) 精确计算（垂直入射平面波）
- Schelkunoff 组分分解：SE_R / SE_A / SE_M（单层，与传输线模型严格一致）
- 薄导电膜近似：SE ≈ 20·log10(1 + Z0/(2Rs))（d ≪ δ，Rs 来自 omo.electrical）
- 材料参数：Ag / ITO 电导率（materials.py，源自 electrical 单一数据源）

物理模型与文献来源见 docs/physics/emi.md。
"""

from __future__ import annotations

from omo.emi.materials import ITO_BULK_CONDUCTIVITY, SILVER_BULK_CONDUCTIVITY
from omo.emi.shielding import (
    SchelkunoffResult,
    ShieldingLayer,
    ShieldingSpectrum,
    schelkunoff_components,
    shielding_effectiveness,
    thin_film_se,
)

__all__ = [
    "ShieldingLayer",
    "ShieldingSpectrum",
    "SchelkunoffResult",
    "shielding_effectiveness",
    "thin_film_se",
    "schelkunoff_components",
    "SILVER_BULK_CONDUCTIVITY",
    "ITO_BULK_CONDUCTIVITY",
]
