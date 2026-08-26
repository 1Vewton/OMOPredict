"""Drude 介电函数单元测试：解析性质（ω=ωp、金属性、高频极限）、输入校验。"""

from __future__ import annotations

import numpy as np
import pytest

from omo.constants import ELEMENTARY_CHARGE, PLANCK_CONSTANT, SPEED_OF_LIGHT
from omo.optics import SILVER, DrudeMaterial

# 波长(nm) → 光子能量(eV) 换算常数（与实现同源，独立复算校验）
EV_NM = PLANCK_CONSTANT * SPEED_OF_LIGHT / (ELEMENTARY_CHARGE * 1e-9)


def test_plasma_energy_analytic_value() -> None:
    """在 ħω = ħωp 处（λ0 = hc/(e·ωp)），ε' = ε∞ − ωp²/(ωp²+γ²)、ε'' = ωp²γ/(ωp·(ωp²+γ²))。"""
    wp = SILVER.plasma_energy_ev
    gamma = SILVER.damping_energy_ev
    lambda0 = EV_NM / wp
    eps = SILVER.permittivity(lambda0)
    denom = wp * wp + gamma * gamma
    assert eps.real == pytest.approx(SILVER.eps_inf - wp * wp / denom, rel=1e-9)
    assert eps.imag == pytest.approx(wp * wp * gamma / (wp * denom), rel=1e-9)


def test_metallic_in_visible() -> None:
    """可见光波段银应呈金属性：Re ε < 0 且 Im ε > 0。"""
    eps = SILVER.permittivity(np.array([450.0, 550.0, 650.0]))
    assert np.all(eps.real < 0)
    assert np.all(eps.imag > 0)


def test_high_energy_limit_approaches_eps_inf() -> None:
    """高频极限（ħω ≫ ħωp）ε → ε∞，银趋于透明。"""
    eps = SILVER.permittivity(10.0)  # ≈ 124 eV ≫ 9.1 eV
    assert eps.real == pytest.approx(SILVER.eps_inf, rel=2e-3)
    assert eps.imag < 1e-3


def test_refractive_index_conventions() -> None:
    """复折射率约定：吸收材料 Re(ñ) > 0、Im(ñ) > 0；无损极限 ñ → 1。"""
    n = SILVER.refractive_index(550.0)
    assert n.real > 0
    assert n.imag > 0
    n_free = DrudeMaterial(
        eps_inf=1.0, plasma_energy_ev=0.0, damping_energy_ev=0.0
    ).refractive_index(550.0)
    assert n_free == pytest.approx(1.0, abs=1e-12)


def test_scalar_and_array_return_types() -> None:
    """标量输入返回 python complex，数组输入返回复数数组。"""
    assert isinstance(SILVER.permittivity(550.0), complex)
    assert isinstance(SILVER.refractive_index(550.0), complex)
    arr = SILVER.permittivity(np.array([500.0, 600.0]))
    assert arr.shape == (2,)
    assert np.iscomplexobj(arr)


def test_drude_material_validation() -> None:
    """非法参数与非正波长应抛 ValueError。"""
    with pytest.raises(ValueError):
        DrudeMaterial(eps_inf=1.0, plasma_energy_ev=-1.0, damping_energy_ev=0.1)
    with pytest.raises(ValueError):
        DrudeMaterial(eps_inf=1.0, plasma_energy_ev=9.1, damping_energy_ev=-0.1)
    with pytest.raises(ValueError):
        SILVER.permittivity(0.0)
    with pytest.raises(ValueError):
        SILVER.permittivity(-100.0)


def test_callable_usable_as_layer_index() -> None:
    """DrudeMaterial 可作为 Layer.index 的可调用对象（__call__ = refractive_index）。"""
    from omo.optics import Layer, transfer_matrix

    spec = transfer_matrix([Layer(SILVER, 10.0)], np.array([550.0]))
    assert 0.0 <= spec.transmittance[0] <= 1.0
    assert spec.absorptance[0] > 0.0  # 银层有吸收
