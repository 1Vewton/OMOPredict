"""多层膜方阻计算：并联等效模型 + Fuchs–Sondheimer 尺寸效应。

物理模型：

1. 并联方阻模型：电流在面内流动，各导电层并联，
       1/Rs = Σ 1/Rs_i = Σ d_i / ρ_eff,i
   其中 Rs_i = ρ_eff,i / d_i 为第 i 层单独存在时的方阻。
   绝缘层（ρ 极大）贡献可忽略，可不传入；弱导电层（如 ITO）自动计入并联。

2. Fuchs–Sondheimer 尺寸效应（超薄金属膜）：当膜厚 d 与电子平均自由程 λ
   可比时，表面散射使有效电阻率增大：
       ρ_eff/ρ_bulk = 1 / [1 − (3(1−p)/(2κ))·∫₁^∞ (1/t³ − 1/t⁵)(1−e^(−κt))/(1−p·e^(−κt)) dt]
   其中 κ = d/λ，p 为镜面散射系数（0 全漫射、1 全镜面）。
   大厚度极限（κ ≫ 1）退化为常用近似 ρ_eff/ρ_bulk ≈ 1 + 3(1−p)λ/(8d)。

参考文献：
- E. Fuchs, Proc. Cambridge Philos. Soc. 34, 100 (1938)
- E. H. Sondheimer, Adv. Phys. 1, 1 (1952)
- C. R. Tellier, A. J. Tosser, "Size Effects in Thin Films", Elsevier (1982)
- H. S. Nalwa (ed.), Handbook of Thin Film Materials（Ag 电学参数综述）

约定：厚度单位 nm，电阻率单位 Ω·m，方阻单位 Ω/sq。
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
from scipy.integrate import quad


def fuchs_sondheimer_ratio(
    thickness_nm: float,
    mean_free_path_nm: float,
    specularity: float = 0.0,
) -> float:
    """Fuchs–Sondheimer 尺寸效应因子 ρ_film/ρ_bulk。

    精确积分式（见模块文档字符串）；κ ≫ 1 时退化为 1 + 3(1−p)λ/(8d)。

    参数:
        thickness_nm: 膜厚（nm），> 0
        mean_free_path_nm: 电子平均自由程（nm），> 0
        specularity: 镜面散射系数 p ∈ [0,1]（默认 0，全漫射）

    返回:
        ρ_film/ρ_bulk（≥ 1；p = 1 时恒为 1）

    异常:
        ValueError: 参数非法；或 d/λ 过小导致模型发散（数值保护）
    """
    if thickness_nm <= 0:
        raise ValueError(f"thickness_nm 必须 > 0，收到 {thickness_nm}")
    if mean_free_path_nm <= 0:
        raise ValueError(f"mean_free_path_nm 必须 > 0，收到 {mean_free_path_nm}")
    if not 0.0 <= specularity <= 1.0:
        raise ValueError(f"specularity 必须在 [0,1] 内，收到 {specularity}")

    kappa = thickness_nm / mean_free_path_nm

    def integrand(t: float) -> float:
        exp_kt = np.exp(-kappa * t)
        return (t**-3 - t**-5) * (1.0 - exp_kt) / (1.0 - specularity * exp_kt)

    integral, _ = quad(integrand, 1.0, np.inf)
    ratio = 1.0 - 3.0 * (1.0 - specularity) / (2.0 * kappa) * integral
    if ratio <= 0.0:
        raise ValueError(
            f"Fuchs–Sondheimer 模型发散：d/λ = {kappa:.3f} 过小（膜过薄）"
        )
    return 1.0 / ratio


@dataclass(frozen=True)
class ConductiveLayer:
    """多层膜中的导电层（并联方阻模型单元）。

    参数:
        thickness_nm: 层厚（nm），≥ 0（0 表示无导电贡献）
        bulk_resistivity: 块体电阻率 ρ₀（Ω·m），> 0
        name: 材料名（可空）
        mean_free_path_nm: 电子平均自由程 λ（nm）；> 0 时启用 Fuchs–Sondheimer 尺寸效应
        specularity: 镜面散射系数 p ∈ [0,1]（默认 0，全漫射）

    异常:
        ValueError: thickness_nm < 0、bulk_resistivity ≤ 0 或 specularity 越界
    """

    thickness_nm: float
    bulk_resistivity: float
    name: str = ""
    mean_free_path_nm: float = 0.0
    specularity: float = 0.0

    def __post_init__(self) -> None:
        if self.thickness_nm < 0:
            raise ValueError(f"thickness_nm 必须 ≥ 0，收到 {self.thickness_nm}")
        if self.bulk_resistivity <= 0:
            raise ValueError(f"bulk_resistivity 必须 > 0，收到 {self.bulk_resistivity}")
        if not 0.0 <= self.specularity <= 1.0:
            raise ValueError(f"specularity 必须在 [0,1] 内，收到 {self.specularity}")

    def effective_resistivity(self) -> float:
        """有效电阻率 ρ_eff（含尺寸效应；mean_free_path_nm = 0 时等于块体值）。"""
        if self.mean_free_path_nm <= 0:
            return self.bulk_resistivity
        return self.bulk_resistivity * fuchs_sondheimer_ratio(
            self.thickness_nm, self.mean_free_path_nm, self.specularity
        )

    def sheet_resistance(self) -> float:
        """本层单独存在时的方阻 Rs_i = ρ_eff / d（Ω/sq）。

        异常:
            ValueError: thickness_nm == 0（零厚度层无方阻定义）
        """
        if self.thickness_nm == 0:
            raise ValueError("thickness_nm 为 0 的层没有方阻定义")
        return self.effective_resistivity() / (self.thickness_nm * 1e-9)


def sheet_resistance(layers: Sequence[ConductiveLayer]) -> float:
    """多层膜并联方阻（Ω/sq）。

    并联模型：1/Rs = Σ d_i/ρ_eff,i，仅计入厚度 > 0 的层。

    参数:
        layers: 导电层序列（面内并联）

    返回:
        总方阻 Rs（Ω/sq）

    异常:
        ValueError: 无任何厚度 > 0 的层（无导电通路）
    """
    conductance = 0.0
    for layer in layers:
        if layer.thickness_nm > 0:
            conductance += 1.0 / layer.sheet_resistance()
    if conductance <= 0.0:
        raise ValueError("layers 中至少需要一层厚度 > 0 的导电层")
    return 1.0 / conductance
