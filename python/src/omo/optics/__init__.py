"""光学仿真包：多层膜系光学性能计算（M1 已实现）。

- TMM（传输矩阵法，特征矩阵法实现）：透过率 T / 反射率 R / 吸收率 A
  （支持入射角与 s/p/非偏振）
- Drude 金属介电函数：含 Ag 常用参数（SILVER）
- 输出：光谱曲线、可见光平均透过率（色度坐标计划中）

物理模型与文献来源见 docs/physics/tmm.md。
"""

from __future__ import annotations

from omo.optics.drude import SILVER, DrudeMaterial
from omo.optics.transfer_matrix import Layer, OpticalSpectrum, transfer_matrix

__all__ = ["DrudeMaterial", "SILVER", "Layer", "OpticalSpectrum", "transfer_matrix"]
