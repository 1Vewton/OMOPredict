"""电磁屏蔽效能（EMI SE）计算：传输线模型 + Schelkunoff 组分分解 + 薄膜近似。

物理模型：

1. 传输线模型（多层，垂直入射平面波，精确）：
   每层视为一段传输线，特征阻抗 η_j 与传播常数 γ_j：
       η_j = sqrt(j·ω·μ_j / (σ_j + j·ω·ε_j))
       γ_j = sqrt(j·ω·μ_j·(σ_j + j·ω·ε_j))
   其中 μ_j = μ₀·μ_rj、ε_j = ε₀·ε_rj，ω = 2π·f。
   层 ABCD 矩阵：
       L_j = [[cosh(γ_j·d_j), η_j·sinh(γ_j·d_j)],
              [sinh(γ_j·d_j)/η_j, cosh(γ_j·d_j)]]
   总矩阵 M = ∏L_j。设出射介质波阻抗 η_s，则电场透射系数：
       t = E_t/E_i = 2η_s / (M11·η_s + M12 + η_0·η_s·M21 + η_0·M22)
   两侧同为自由空间时（功率 ∝ |E|²）：
       SE = 20·log₁₀(1/|t|)   [dB]

2. Schelkunoff 组分分解（单层、两侧自由空间；为精确分解，非近似）：
       SE_A = 20·log₁₀|e^{γd}|          （吸收损耗）
       SE_R = 20·log₁₀|(Z₀+η)²/(4Z₀η)|  （反射损耗）
       SE_M = 20·log₁₀|1 − q·e^{−2γd}|  （多次反射，q = ((Z₀−η)/(Z₀+η))²）
   注意：薄膜（d ≪ δ）时 SE_M 大幅为负并与 SE_R 抵消，组分单独解读仅适用
   于 d ≳ δ（SE_M ≈ 0）的场景；总和始终与传输线模型一致。

3. 薄导电膜近似（透明导电膜场景，d ≪ δ，两侧自由空间）：
       SE ≈ 20·log₁₀(1 + Z₀/(2·Rs))
   其中 Rs 为方阻（由 omo.electrical 计算，含 Fuchs–Sondheimer 尺寸效应）。

约定：频率 GHz，厚度 nm，电导率 S/m；两侧默认自由空间（Z₀ ≈ 376.73 Ω）。
膜厚适用范围：导电层总衰减 Σαd ≲ 100（毫米级实心金属板请用 schelkunoff_components）。

参考文献：
- S. A. Schelkunoff, "Electromagnetic Waves", Van Nostrand (1943)
- C. R. Paul, "Introduction to Electromagnetic Compatibility", 2nd ed., Wiley (2006)
- H. W. Ott, "Electromagnetic Compatibility Engineering", Wiley (2009)
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

from omo.constants import VACUUM_IMPEDANCE, VACUUM_PERMEABILITY, VACUUM_PERMITTIVITY
from omo.electrical import ConductiveLayer

# 20·log₁₀(e)：奈培 → 分贝换算常数
_DB_PER_NEPER = 20.0 / math.log(10.0)


@dataclass(frozen=True)
class ShieldingLayer:
    """屏蔽层（传输线模型中的一段）。

    参数:
        thickness_nm: 层厚（nm），≥ 0（0 层为恒等变换）
        conductivity: 电导率 σ（S/m），≥ 0（0 表示纯介质，如玻璃衬底）
        relative_permittivity: 相对介电常数 ε_r（> 0，默认 1）
        relative_permeability: 相对磁导率 μ_r（> 0，默认 1）
        name: 材料名（可空）

    异常:
        ValueError: 参数非法
    """

    thickness_nm: float
    conductivity: float
    relative_permittivity: float = 1.0
    relative_permeability: float = 1.0
    name: str = ""

    def __post_init__(self) -> None:
        if self.thickness_nm < 0:
            raise ValueError(f"thickness_nm 必须 ≥ 0，收到 {self.thickness_nm}")
        if self.conductivity < 0:
            raise ValueError(f"conductivity 必须 ≥ 0，收到 {self.conductivity}")
        if self.relative_permittivity <= 0:
            raise ValueError(
                f"relative_permittivity 必须 > 0，收到 {self.relative_permittivity}"
            )
        if self.relative_permeability <= 0:
            raise ValueError(
                f"relative_permeability 必须 > 0，收到 {self.relative_permeability}"
            )

    @classmethod
    def from_conductive_layer(cls, layer: ConductiveLayer) -> ShieldingLayer:
        """由电学模块的 ConductiveLayer 构造：σ_eff = 1/ρ_eff（含 Fuchs–Sondheimer 尺寸效应）。

        参数:
            layer: omo.electrical 的导电层

        返回:
            等效屏蔽层（σ 取有效电导率，与 omo.electrical 的方阻结果自洽）
        """
        return cls(
            thickness_nm=layer.thickness_nm,
            conductivity=1.0 / layer.effective_resistivity(),
            name=layer.name or "",
        )


@dataclass(frozen=True)
class ShieldingSpectrum:
    """屏蔽效能频谱结果。

    属性:
        freqs_ghz: 频率网格（GHz）
        se_db: 屏蔽效能（dB）
    """

    freqs_ghz: npt.NDArray[np.floating]
    se_db: npt.NDArray[np.floating]

    def x_band_average(self, min_ghz: float = 8.2, max_ghz: float = 12.4) -> float:
        """X 波段（默认 8.2–12.4 GHz）平均屏蔽效能（dB）。

        异常:
            ValueError: 频率网格不包含给定区间内的点
        """
        mask = (self.freqs_ghz >= min_ghz) & (self.freqs_ghz <= max_ghz)
        if not np.any(mask):
            raise ValueError(f"频率网格不包含 [{min_ghz}, {max_ghz}] GHz 区间内的点")
        return float(np.mean(self.se_db[mask]))


@dataclass(frozen=True)
class SchelkunoffResult:
    """Schelkunoff 组分分解结果（SE = SE_R + SE_A + SE_M，精确分解）。"""

    freqs_ghz: npt.NDArray[np.floating]
    reflection_db: npt.NDArray[np.floating]
    absorption_db: npt.NDArray[np.floating]
    multiple_reflection_db: npt.NDArray[np.floating]

    @property
    def total_db(self) -> npt.NDArray[np.floating]:
        """总屏蔽效能 = SE_R + SE_A + SE_M（与 shielding_effectiveness 单层结果一致）。"""
        return self.reflection_db + self.absorption_db + self.multiple_reflection_db


def _validate_freqs(freqs_ghz: npt.ArrayLike) -> np.ndarray:
    freqs = np.asarray(freqs_ghz, dtype=float)
    if freqs.ndim != 1 or freqs.size == 0:
        raise ValueError("freqs_ghz 必须是一维非空数组")
    if np.any(freqs <= 0):
        raise ValueError("freqs_ghz 必须全为正")
    return freqs


def _layer_matrix(layer: ShieldingLayer, omega: np.ndarray) -> np.ndarray:
    """单层 ABCD 矩阵（shape (W, 2, 2)）；γ、η 取主分支（无源介质 Re ≥ 0）。"""
    mu = VACUUM_PERMEABILITY * layer.relative_permeability
    eps = VACUUM_PERMITTIVITY * layer.relative_permittivity
    z = 1j * omega * mu
    denom = layer.conductivity + 1j * omega * eps
    gamma = np.sqrt(z * denom)
    eta = np.sqrt(z / denom)
    gd = gamma * (layer.thickness_nm * 1e-9)
    ch = np.cosh(gd)
    sh = np.sinh(gd)
    m = np.empty((omega.size, 2, 2), dtype=np.complex128)
    m[:, 0, 0] = ch
    m[:, 1, 1] = ch
    m[:, 0, 1] = eta * sh
    m[:, 1, 0] = sh / eta
    return m


def shielding_effectiveness(
    layers: Sequence[ShieldingLayer],
    freqs_ghz: npt.ArrayLike,
    input_impedance: float = VACUUM_IMPEDANCE,
    output_impedance: float = VACUUM_IMPEDANCE,
) -> ShieldingSpectrum:
    """多层膜电磁屏蔽效能（dB），垂直入射平面波，传输线模型（精确）。

    参数:
        layers: 屏蔽层序列（入射侧 → 出射侧；空序列 = 无屏蔽，SE ≡ 0）
        freqs_ghz: 频率网格（GHz），一维且全为正
        input_impedance: 入射侧介质波阻抗（Ω，默认自由空间）
        output_impedance: 出射侧介质波阻抗（Ω，默认自由空间）

    返回:
        ShieldingSpectrum（频率与 SE）

    异常:
        ValueError: 参数非法

    注意:
        SE 定义要求两侧介质相同（默认自由空间）；导电层总衰减 Σαd ≲ 100，
        毫米级实心金属板请改用 schelkunoff_components 评估。
    """
    freqs = _validate_freqs(freqs_ghz)
    if input_impedance <= 0 or output_impedance <= 0:
        raise ValueError("input_impedance 与 output_impedance 必须 > 0")

    omega = 2.0 * np.pi * freqs * 1e9  # rad/s
    eta0 = float(input_impedance)
    eta_s = float(output_impedance)

    total = np.tile(np.eye(2, dtype=np.complex128), (freqs.size, 1, 1))
    for layer in layers:
        total = np.einsum("wij,wjk->wik", total, _layer_matrix(layer, omega))

    m11 = total[:, 0, 0]
    m12 = total[:, 0, 1]
    m21 = total[:, 1, 0]
    m22 = total[:, 1, 1]
    denom = m11 * eta_s + m12 + eta0 * eta_s * m21 + eta0 * m22
    t = 2.0 * eta_s / denom
    se = 20.0 * np.log10(1.0 / np.abs(t))
    return ShieldingSpectrum(freqs_ghz=freqs, se_db=se)


def thin_film_se(
    sheet_resistance: float | npt.ArrayLike,
    impedance: float = VACUUM_IMPEDANCE,
) -> float | np.ndarray:
    """薄导电膜屏蔽效能近似：SE = 20·log₁₀(1 + Z₀/(2·Rs))（dB）。

    适用条件：膜厚 d ≪ 趋肤深度 δ（透明导电膜典型场景）、两侧自由空间。
    Rs 由 omo.electrical 的 sheet_resistance 计算（含 Fuchs–Sondheimer 尺寸效应）。

    参数:
        sheet_resistance: 方阻 Rs（Ω/sq），标量或数组
        impedance: 自由空间波阻抗 Z₀（Ω，默认 376.73）

    返回:
        屏蔽效能（dB）；标量输入返回 float，数组输入返回数组

    异常:
        ValueError: Rs ≤ 0 或 impedance ≤ 0
    """
    scalar = np.isscalar(sheet_resistance)
    rs = np.atleast_1d(np.asarray(sheet_resistance, dtype=float))
    if np.any(rs <= 0):
        raise ValueError("sheet_resistance 必须 > 0")
    if impedance <= 0:
        raise ValueError("impedance 必须 > 0")
    se = 20.0 * np.log10(1.0 + impedance / (2.0 * rs))
    return float(se[0]) if scalar else se


def schelkunoff_components(
    freqs_ghz: npt.ArrayLike,
    thickness_nm: float,
    conductivity: float,
    relative_permittivity: float = 1.0,
    relative_permeability: float = 1.0,
) -> SchelkunoffResult:
    """Schelkunoff 屏蔽效能组分分解：SE = SE_R + SE_A + SE_M（单层，两侧自由空间）。

    该分解为精确分解，与 shielding_effectiveness 对单层的结果严格一致：
        SE_A = 20·log₁₀|e^{γd}|           （吸收损耗）
        SE_R = 20·log₁₀|(Z₀+η)²/(4Z₀η)|   （反射损耗）
        SE_M = 20·log₁₀|1 − q·e^{−2γd}|   （多次反射，q = ((Z₀−η)/(Z₀+η))²）

    参数:
        freqs_ghz: 频率网格（GHz）
        thickness_nm: 屏蔽体厚度（nm），> 0
        conductivity: 电导率（S/m），> 0
        relative_permittivity: ε_r（默认 1）
        relative_permeability: μ_r（默认 1）

    返回:
        SchelkunoffResult（三组分；total_db = 三者之和）

    异常:
        ValueError: 参数非法
    """
    freqs = _validate_freqs(freqs_ghz)
    if thickness_nm <= 0:
        raise ValueError(f"thickness_nm 必须 > 0，收到 {thickness_nm}")
    if conductivity <= 0:
        raise ValueError(f"conductivity 必须 > 0，收到 {conductivity}")
    if relative_permittivity <= 0 or relative_permeability <= 0:
        raise ValueError("relative_permittivity / relative_permeability 必须 > 0")

    omega = 2.0 * np.pi * freqs * 1e9
    mu = VACUUM_PERMEABILITY * relative_permeability
    eps = VACUUM_PERMITTIVITY * relative_permittivity
    z = 1j * omega * mu
    denom = conductivity + 1j * omega * eps
    gamma = np.sqrt(z * denom)
    eta = np.sqrt(z / denom)
    d = thickness_nm * 1e-9
    z0 = float(VACUUM_IMPEDANCE)

    se_a = _DB_PER_NEPER * gamma.real * d
    se_r = 20.0 * np.log10(np.abs((z0 + eta) ** 2 / (4.0 * z0 * eta)))
    q = ((z0 - eta) / (z0 + eta)) ** 2
    se_m = 20.0 * np.log10(np.abs(1.0 - q * np.exp(-2.0 * gamma * d)))

    return SchelkunoffResult(
        freqs_ghz=freqs,
        reflection_db=se_r,
        absorption_db=se_a,
        multiple_reflection_db=se_m,
    )
