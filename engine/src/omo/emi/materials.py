"""EMI 屏蔽材料电参数。

电导率由 omo.electrical.materials 的电阻率导出（单一数据源，避免两处维护常数）。
含尺寸效应的有效电导率请使用 ShieldingLayer.from_conductive_layer（与方阻结果自洽）。
"""

from __future__ import annotations

from omo.electrical.materials import (
    ITO_BULK_RESISTIVITY,
    SILVER_BULK_RESISTIVITY,
)

# 银（Ag）块体电导率（S/m）—— 来源同 SILVER_BULK_RESISTIVITY（CRC Handbook，20°C）
SILVER_BULK_CONDUCTIVITY: float = 1.0 / SILVER_BULK_RESISTIVITY

# 溅射 ITO 薄膜电导率（S/m）—— 参考值，工艺相关（来源同 ITO_BULK_RESISTIVITY）
ITO_BULK_CONDUCTIVITY: float = 1.0 / ITO_BULK_RESISTIVITY
