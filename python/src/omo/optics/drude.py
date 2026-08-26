"""Drude 金属介电函数模型。

模型（ω 为角频率）：
    ε(ω) = ε_∞ − ω_p² / (ω² + i·γ·ω)

实现中 ω_p、γ 以能量单位（eV）给出（即 ħ·ω_p、ħ·γ），波长与光子能量换算：
    E[eV] = h·c / (e·λ[nm])
常数取自 omo.constants（CODATA 2018，来源见该模块文档字符串）。

参考文献：
- P. B. Johnson, R. W. Christy, "Optical constants of the noble metals",
  Phys. Rev. B 6, 4370 (1972)（Ag 光学常数实测数据）
- 本模块的 Ag 参数（SILVER）为可见光波段常用 Drude 拟合值；
  M2 文献对标阶段将用实测数据校准（仿真—实测—校准闭环，见 AGENTS.md §3.5）。
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

from omo.constants import ELEMENTARY_CHARGE, PLANCK_CONSTANT, SPEED_OF_LIGHT

# h·c/e：波长(nm) → 光子能量(eV) 的换算常数，约 1239.84 eV·nm
_WAVELENGTH_TO_EV = PLANCK_CONSTANT * SPEED_OF_LIGHT / (ELEMENTARY_CHARGE * 1e-9)


@dataclass(frozen=True)
class DrudeMaterial:
    """Drude 模型描述的金属材料。

    参数:
        eps_inf: 高频介电常数 ε_∞（无量纲）
        plasma_energy_ev: 等离子体能量 ħ·ω_p（eV）
        damping_energy_ev: 阻尼能量 ħ·γ（eV）
        name: 材料名（如 "Ag"）
        source: 参数来源文献（必填，遵守 AGENTS.md 守则：常数须可溯源）

    异常:
        ValueError: plasma_energy_ev 或 damping_energy_ev 为负
    """

    eps_inf: float
    plasma_energy_ev: float
    damping_energy_ev: float
    name: str = "metal"
    source: str = ""

    def __post_init__(self) -> None:
        if self.plasma_energy_ev < 0 or self.damping_energy_ev < 0:
            raise ValueError("plasma_energy_ev 与 damping_energy_ev 必须 ≥ 0")

    def permittivity(
        self, wavelength_nm: float | npt.ArrayLike
    ) -> complex | npt.NDArray[np.complexfloating]:
        """计算介电函数 ε(λ) = ε' + i·ε''。

        参数:
            wavelength_nm: 波长（nm），标量或数组
        返回:
            复介电常数；标量输入返回 python complex，数组输入返回复数数组

        异常:
            ValueError: 存在非正波长
        """
        scalar = np.isscalar(wavelength_nm)
        wl = np.atleast_1d(np.asarray(wavelength_nm, dtype=float))
        if np.any(wl <= 0):
            raise ValueError("wavelength_nm 必须全为正")
        hbar_w = _WAVELENGTH_TO_EV / wl
        hbar_gamma = self.damping_energy_ev
        wp2 = self.plasma_energy_ev**2
        denom = hbar_w * hbar_w + hbar_gamma * hbar_gamma
        # ε = ε∞ − ωp²/(ω²+iγω)，分母乘共轭分解：
        #   ε' = ε∞ − ωp²/(ω²+γ²)
        #   ε'' = ωp²·γ / (ω·(ω²+γ²))
        eps = (self.eps_inf - wp2 / denom) + 1j * (wp2 * hbar_gamma / (hbar_w * denom))
        return complex(eps[0]) if scalar else eps

    def refractive_index(
        self, wavelength_nm: float | npt.ArrayLike
    ) -> complex | npt.NDArray[np.complexfloating]:
        """由介电函数求复折射率 ñ = n + i·k（分支约定 Re(ñ) ≥ 0）。"""
        eps = self.permittivity(wavelength_nm)
        n = np.sqrt(np.asarray(eps, dtype=np.complex128))
        return complex(n) if np.isscalar(eps) else n

    def __call__(
        self, wavelength_nm: float | npt.ArrayLike
    ) -> complex | npt.NDArray[np.complexfloating]:
        """可调用对象：等价于 refractive_index，便于直接作为 Layer 的 index 使用。"""
        return self.refractive_index(wavelength_nm)


# Ag 的常用 Drude 参数（可见光波段）：
#   ε_∞ = 3.7，ħ·ω_p = 9.1 eV，ħ·γ = 0.02 eV
# 来源：对 Johnson & Christy (1972) 实测光学常数的 Drude 拟合，
# 该组参数广泛见于 ITO/Ag/ITO 等 OMO 体系仿真文献。
SILVER: DrudeMaterial = DrudeMaterial(
    eps_inf=3.7,
    plasma_energy_ev=9.1,
    damping_energy_ev=0.02,
    name="Ag",
    source="Drude fit to Johnson & Christy (1972), Phys. Rev. B 6, 4370",
)
