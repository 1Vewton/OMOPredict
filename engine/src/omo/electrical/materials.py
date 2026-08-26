"""薄膜材料电学常数（电阻率、电子平均自由程），全部标注文献来源。

注意：除 Ag 块体电阻率外，薄膜电阻率与自由程均为工艺/文献相关参考值，
M2 对标阶段将以文献实测数据校准（仿真—实测—校准闭环，见 AGENTS.md §3.5）。
"""

from __future__ import annotations

# 银（Ag）块体电阻率 @ 20°C（Ω·m）
# 来源：CRC Handbook of Chemistry and Physics（室温块体银电导率 6.30×10⁷ S/m
# 对应电阻率 1.59×10⁻⁸ Ω·m）
SILVER_BULK_RESISTIVITY: float = 1.59e-8

# 银电子平均自由程（室温，nm）
# 来源：超薄银膜 Fuchs–Sondheimer 分析文献常用值（常见引用范围 52–57 nm，
# 如 Handbook of Thin Film Materials 中 Ag 的 λ ≈ 52 nm）；取 52 nm，
# M2 阶段用实测 Rs 校准。
SILVER_MEAN_FREE_PATH_NM: float = 52.0

# 溅射 ITO 薄膜电阻率（Ω·m）—— 参考值，工艺相关性极强
# 来源：典型磁控溅射 ITO 的常见文献值（约 1–2×10⁻⁶ Ω·m 量级）；
# 具体论文取值在 M2 对标数据集中按来源标注。
ITO_BULK_RESISTIVITY: float = 1.5e-6
