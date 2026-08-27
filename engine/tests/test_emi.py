"""EMI 模块单元测试：薄膜近似、传输线模型、Schelkunoff 组分、多层膜、参数校验。"""

from __future__ import annotations

import math

import numpy as np
import pytest

from omo.constants import VACUUM_IMPEDANCE, VACUUM_PERMEABILITY
from omo.electrical import (
    ITO_BULK_RESISTIVITY,
    SILVER_BULK_RESISTIVITY,
    SILVER_MEAN_FREE_PATH_NM,
    ConductiveLayer,
    sheet_resistance,
)
from omo.emi import (
    SILVER_BULK_CONDUCTIVITY,
    SchelkunoffResult,
    ShieldingLayer,
    schelkunoff_components,
    shielding_effectiveness,
    thin_film_se,
)

FREQS = np.linspace(1.0, 18.0, 171)


def test_thin_film_formula_basic() -> None:
    """薄膜近似解析值：Rs=5 → SE = 20·log10(1+Z0/10)；绝缘极限 SE→0。"""
    expected = 20.0 * np.log10(1.0 + VACUUM_IMPEDANCE / (2.0 * 5.0))
    assert thin_film_se(5.0) == pytest.approx(expected, rel=1e-12)
    assert thin_film_se(1e12) == pytest.approx(0.0, abs=1e-8)
    arr = thin_film_se(np.array([5.0, 10.0]))
    assert arr.shape == (2,)
    assert np.all(arr > 0)


def test_no_layers_zero_se() -> None:
    """无屏蔽层（空序列）：SE ≡ 0。"""
    spec = shielding_effectiveness([], FREQS)
    np.testing.assert_allclose(spec.se_db, 0.0, atol=1e-12)


def test_single_thin_layer_matches_thin_film_formula() -> None:
    """10 nm Ag 单层：传输线模型 ≈ 薄膜近似（d ≪ δ，d/δ ≈ 0.009）。"""
    ag = ConductiveLayer(10.0, SILVER_BULK_RESISTIVITY, "Ag", SILVER_MEAN_FREE_PATH_NM)
    rs_ag = sheet_resistance([ag])
    spec = shielding_effectiveness(
        [ShieldingLayer.from_conductive_layer(ag)], np.array([10.0])
    )
    assert spec.se_db[0] == pytest.approx(thin_film_se(rs_ag), abs=0.2)


def test_schelkunoff_components_match_transmission_line() -> None:
    """单层：Schelkunoff 组分和与传输线模型严格一致（全频段）。"""
    d_nm = 3175.0  # ≈ 5·δ_Ag(10GHz)，厚层场景
    comp = schelkunoff_components(FREQS, d_nm, SILVER_BULK_CONDUCTIVITY)
    assert isinstance(comp, SchelkunoffResult)
    spec = shielding_effectiveness([ShieldingLayer(d_nm, SILVER_BULK_CONDUCTIVITY)], FREQS)
    np.testing.assert_allclose(comp.total_db, spec.se_db, atol=1e-6)


def test_schelkunoff_absorption_analytic() -> None:
    """厚层吸收损耗解析值：SE_A = 8.686·d/δ，δ = 1/√(πfμ₀σ)。"""
    f_ghz = 10.0
    sigma = SILVER_BULK_CONDUCTIVITY
    d_nm = 3175.0
    delta = 1.0 / math.sqrt(
        math.pi * f_ghz * 1e9 * VACUUM_PERMEABILITY * sigma
    )
    comp = schelkunoff_components(np.array([f_ghz]), d_nm, sigma)
    assert comp.absorption_db[0] == pytest.approx(
        (20.0 / math.log(10.0)) * (d_nm * 1e-9) / delta, rel=1e-6
    )
    # 厚层（d = 5δ）：多次反射可忽略
    assert abs(comp.multiple_reflection_db[0]) < 0.1


def test_thick_layer_se_grows_with_frequency() -> None:
    """厚层吸收主导：SE 随频率增大（∝√f）；薄层近似频率平坦。"""
    thick = shielding_effectiveness(
        [ShieldingLayer(3175.0, SILVER_BULK_CONDUCTIVITY)], FREQS
    )
    assert thick.se_db[-1] > thick.se_db[0]
    thin = shielding_effectiveness(
        [ShieldingLayer(10.0, SILVER_BULK_CONDUCTIVITY)], FREQS
    )
    assert np.ptp(thin.se_db) < 0.5


def test_multilayer_ito_ag_ito() -> None:
    """ITO/Ag/ITO 三层：X 波段 SE 与 Rs 近似一致，且 > 25 dB（文献 25–35 dB）。"""
    ag = ConductiveLayer(10.0, SILVER_BULK_RESISTIVITY, "Ag", SILVER_MEAN_FREE_PATH_NM)
    ito = ConductiveLayer(40.0, ITO_BULK_RESISTIVITY, "ITO")
    rs_total = sheet_resistance([ito, ag, ito])
    stack = [ShieldingLayer.from_conductive_layer(x) for x in (ito, ag, ito)]
    spec = shielding_effectiveness(stack, FREQS)
    assert spec.x_band_average() == pytest.approx(thin_film_se(rs_total), abs=1.5)
    assert spec.x_band_average() > 25.0


def test_lossless_dielectric_no_shielding() -> None:
    """玻璃衬底（σ=0）几乎不屏蔽：SE ≈ 0（< 0.5 dB）。"""
    glass = ShieldingLayer(
        thickness_nm=1e6, conductivity=0.0, relative_permittivity=2.25, name="glass"
    )
    spec = shielding_effectiveness([glass], FREQS)
    assert np.max(spec.se_db) < 0.5


def test_glass_substrate_included_in_stack() -> None:
    """玻璃衬底可作为介质层计入堆叠（两侧仍为自由空间）。"""
    ag = ShieldingLayer.from_conductive_layer(
        ConductiveLayer(10.0, SILVER_BULK_RESISTIVITY, "Ag", SILVER_MEAN_FREE_PATH_NM)
    )
    glass = ShieldingLayer(1e6, 0.0, relative_permittivity=2.25, name="glass")
    spec = shielding_effectiveness([ag, glass], FREQS)
    assert np.all(spec.se_db > 0)


def test_validation() -> None:
    """非法参数应抛 ValueError。"""
    with pytest.raises(ValueError):
        thin_film_se(0.0)
    with pytest.raises(ValueError):
        thin_film_se(-5.0)
    with pytest.raises(ValueError):
        shielding_effectiveness([], np.array([0.0]))
    with pytest.raises(ValueError):
        shielding_effectiveness([], np.ones((2, 2)))
    with pytest.raises(ValueError):
        shielding_effectiveness([], FREQS, input_impedance=-1.0)
    with pytest.raises(ValueError):
        ShieldingLayer(10.0, -1.0)
    with pytest.raises(ValueError):
        ShieldingLayer(-1.0, 1.0)
    with pytest.raises(ValueError):
        ShieldingLayer(10.0, 1.0, relative_permittivity=0.0)
    with pytest.raises(ValueError):
        schelkunoff_components(np.array([10.0]), 0.0, 1.0)
    with pytest.raises(ValueError):
        schelkunoff_components(np.array([10.0]), 100.0, 0.0)
