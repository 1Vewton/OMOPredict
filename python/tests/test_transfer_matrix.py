"""TMM 求解器单元测试：解析解对照（裸界面 / Airy / 增透 / 半波 / 薄层）、守恒、偏振。"""

from __future__ import annotations

import math

import numpy as np
import pytest

from omo.optics import SILVER, Layer, transfer_matrix

WL = np.linspace(400.0, 800.0, 401)  # 1 nm 步长


def airy_reflectance(n0: float, n1: float, ns: float, d_nm: float, wl_nm: float) -> float:
    """单层膜（无吸收）振幅反射率的 Airy 求和解析式。

    r = (r01 + r12·e^{−2iδ}) / (1 + r01·r12·e^{−2iδ})，
    其中 r01 = (n0−n1)/(n0+n1)、r12 = (n1−ns)/(n1+ns)、δ = 2π·n1·d/λ。
    """
    r01 = (n0 - n1) / (n0 + n1)
    r12 = (n1 - ns) / (n1 + ns)
    delta = 2.0 * math.pi * n1 * d_nm / wl_nm
    r = (r01 + r12 * np.exp(-2j * delta)) / (1.0 + r01 * r12 * np.exp(-2j * delta))
    return float(abs(r) ** 2)


def test_bare_interface_normal_incidence() -> None:
    """裸界面（空 stack）：R = ((n0−ns)/(n0+ns))² = 0.04，T = 0.96。"""
    spec = transfer_matrix([], np.array([550.0]))
    r_expect = ((1.0 - 1.5) / (1.0 + 1.5)) ** 2
    assert spec.reflectance[0] == pytest.approx(r_expect, abs=1e-12)
    assert spec.transmittance[0] == pytest.approx(1.0 - r_expect, abs=1e-12)
    assert spec.absorptance[0] == pytest.approx(0.0, abs=1e-12)


def test_bare_interface_at_angle_polarization() -> None:
    """45° 入射：s/p 反射率与 Fresnel 公式一致，非偏振为两者平均。"""
    angle = 45.0
    wl = np.array([550.0])
    spec_s = transfer_matrix([], wl, angle_deg=angle, polarization="s")
    spec_p = transfer_matrix([], wl, angle_deg=angle, polarization="p")
    spec_u = transfer_matrix([], wl, angle_deg=angle)

    n0, ns = 1.0, 1.5
    t0 = math.radians(angle)
    ts = math.asin(n0 * math.sin(t0) / ns)
    r_s = (n0 * math.cos(t0) - ns * math.cos(ts)) / (n0 * math.cos(t0) + ns * math.cos(ts))
    r_p = (n0 / math.cos(t0) - ns / math.cos(ts)) / (n0 / math.cos(t0) + ns / math.cos(ts))

    assert spec_s.reflectance[0] == pytest.approx(r_s**2, abs=1e-12)
    assert spec_p.reflectance[0] == pytest.approx(r_p**2, abs=1e-12)
    assert spec_s.transmittance[0] == pytest.approx(1.0 - r_s**2, abs=1e-12)
    assert spec_p.transmittance[0] == pytest.approx(1.0 - r_p**2, abs=1e-12)
    assert spec_u.reflectance[0] == pytest.approx((r_s**2 + r_p**2) / 2.0, abs=1e-12)
    assert spec_u.transmittance[0] == pytest.approx(1.0 - (r_s**2 + r_p**2) / 2.0, abs=1e-12)


def test_single_layer_matches_airy() -> None:
    """单层无吸收膜：TMM 结果与 Airy 解析式一致（多个波长）。"""
    n1, d = 2.0, 100.0
    spec = transfer_matrix([Layer(complex(n1), d)], WL)
    for wl_test in (400.0, 500.0, 600.0, 800.0):
        idx = int(np.argmin(np.abs(spec.wavelengths_nm - wl_test)))
        r_airy = airy_reflectance(1.0, n1, 1.5, d, wl_test)
        assert spec.reflectance[idx] == pytest.approx(r_airy, abs=1e-10)
        assert spec.transmittance[idx] == pytest.approx(1.0 - r_airy, abs=1e-10)


def test_quarter_wave_antireflection() -> None:
    """四分之一波增透膜（n1 = √(n0·ns)，d = λ0/(4n1)）：设计波长处 R → 0。"""
    lambda0 = 550.0
    n1 = math.sqrt(1.0 * 1.5)
    d = lambda0 / (4.0 * n1)
    spec = transfer_matrix([Layer(complex(n1), d)], np.array([lambda0]))
    assert spec.reflectance[0] == pytest.approx(0.0, abs=1e-10)
    assert spec.transmittance[0] == pytest.approx(1.0, abs=1e-10)


def test_half_wave_layer_equals_bare_interface() -> None:
    """半波膜（δ = π）特征矩阵为 ±I：结果回归裸界面。"""
    lambda0 = 550.0
    n1, d = 2.0, lambda0 / (2.0 * 2.0)
    spec = transfer_matrix([Layer(complex(n1), d)], np.array([lambda0]))
    r_bare = ((1.0 - 1.5) / (1.0 + 1.5)) ** 2
    assert spec.reflectance[0] == pytest.approx(r_bare, abs=1e-10)
    assert spec.transmittance[0] == pytest.approx(1.0 - r_bare, abs=1e-10)


def test_vanishing_thickness_approaches_bare_interface() -> None:
    """极薄吸收层极限：结果回归裸界面。"""
    spec = transfer_matrix([Layer(2.5 + 0.3j, 1e-9)], np.array([550.0]))
    r_bare = ((1.0 - 1.5) / (1.0 + 1.5)) ** 2
    assert spec.reflectance[0] == pytest.approx(r_bare, abs=1e-8)
    assert spec.transmittance[0] == pytest.approx(1.0 - r_bare, abs=1e-8)


def test_energy_conservation_lossy_layer() -> None:
    """吸收层：T、R、A 均在物理范围 [0,1]，且 A > 0。"""
    spec = transfer_matrix([Layer(2.5 + 0.3j, 80.0)], WL)
    assert np.all(spec.transmittance >= -1e-12) and np.all(spec.transmittance <= 1.0 + 1e-12)
    assert np.all(spec.reflectance >= -1e-12) and np.all(spec.reflectance <= 1.0 + 1e-12)
    assert np.all(spec.absorptance >= -1e-12) and np.all(spec.absorptance <= 1.0 + 1e-12)
    assert np.all(spec.absorptance > 0.0)


def test_three_layer_ito_ag_ito() -> None:
    """ITO/Ag/ITO 三层：物理量在范围内、银层带来吸收与反射、可见光平均透过率可用。"""
    stack = [
        Layer(1.8 + 0j, 40.0),
        Layer(SILVER, 10.0),
        Layer(1.8 + 0j, 40.0),
    ]
    spec = transfer_matrix(stack, np.linspace(380.0, 1000.0, 621))
    assert np.all((spec.transmittance >= -1e-12) & (spec.transmittance <= 1.0 + 1e-12))
    assert np.all((spec.reflectance >= -1e-12) & (spec.reflectance <= 1.0 + 1e-12))
    assert np.all((spec.absorptance >= -1e-12) & (spec.absorptance <= 1.0 + 1e-12))

    at_550 = int(np.argmin(np.abs(spec.wavelengths_nm - 550.0)))
    # 物理范围检查（模型无 ITO 吸收、界面理想，透过率偏高属正常；
    # 真实 ITO/Ag/ITO 因 ITO 吸收与界面散射通常低几个百分点）
    assert 0.8 < spec.transmittance[at_550] < 1.0
    assert 0.005 < spec.reflectance[at_550] < 0.5
    assert 0.005 < spec.absorptance[at_550] < 0.1

    avg = spec.visible_average_transmittance()
    mask = (spec.wavelengths_nm >= 400.0) & (spec.wavelengths_nm <= 800.0)
    assert avg == pytest.approx(float(np.mean(spec.transmittance[mask])), abs=1e-12)


def test_thick_metal_layer_blocks_light() -> None:
    """厚银膜（200 nm ≫ 趋肤深度 ~12 nm）：强烈反射、近乎不透光。"""
    spec = transfer_matrix([Layer(SILVER, 200.0)], np.array([550.0]))
    assert spec.reflectance[0] > 0.9
    assert spec.transmittance[0] < 0.01
    assert 0.0 < spec.absorptance[0] < 0.1


def test_s_and_p_equal_at_normal_incidence() -> None:
    """垂直入射时 s 与 p 结果必须完全一致。"""
    stack = [Layer(1.8 + 0j, 40.0), Layer(SILVER, 10.0), Layer(1.8 + 0j, 40.0)]
    spec_s = transfer_matrix(stack, WL, polarization="s")
    spec_p = transfer_matrix(stack, WL, polarization="p")
    np.testing.assert_allclose(spec_s.transmittance, spec_p.transmittance, atol=1e-12)
    np.testing.assert_allclose(spec_s.reflectance, spec_p.reflectance, atol=1e-12)


def test_polarization_splitting_at_angle() -> None:
    """60° 入射：s/p 透过率明显分裂，非偏振 = 两者平均。"""
    stack = [Layer(2.0 + 0j, 100.0)]
    spec_s = transfer_matrix(stack, WL, angle_deg=60.0, polarization="s")
    spec_p = transfer_matrix(stack, WL, angle_deg=60.0, polarization="p")
    spec_u = transfer_matrix(stack, WL, angle_deg=60.0)
    assert np.max(np.abs(spec_s.transmittance - spec_p.transmittance)) > 1e-3
    np.testing.assert_allclose(
        spec_u.transmittance,
        0.5 * (spec_s.transmittance + spec_p.transmittance),
        atol=1e-12,
    )


def test_visible_average_out_of_range() -> None:
    """波长网格不含可见光区间时，可见光平均透过率应抛 ValueError。"""
    spec = transfer_matrix([Layer(1.5 + 0j, 0.0)], np.array([1000.0, 1100.0]))
    with pytest.raises(ValueError):
        spec.visible_average_transmittance()


def test_invalid_inputs() -> None:
    """非法输入应抛 ValueError。"""
    with pytest.raises(ValueError):
        transfer_matrix([Layer(1.5 + 0j, 10.0)], np.array([0.0]))
    with pytest.raises(ValueError):
        transfer_matrix([Layer(1.5 + 0j, 10.0)], np.array([-1.0]))
    with pytest.raises(ValueError):
        transfer_matrix([Layer(1.5 + 0j, 10.0)], np.ones((2, 2)))
    with pytest.raises(ValueError):
        transfer_matrix([Layer(1.5 + 0j, 10.0)], WL, angle_deg=90.0)
    with pytest.raises(ValueError):
        transfer_matrix([Layer(1.5 + 0j, 10.0)], WL, angle_deg=-1.0)
    with pytest.raises(ValueError):
        transfer_matrix([Layer(1.5 + 0j, 10.0)], WL, polarization="x")
    with pytest.raises(ValueError):
        transfer_matrix([Layer(1.5 + 0j, 10.0)], WL, substrate_index=1.5 + 0.1j)
    with pytest.raises(ValueError):
        Layer(1.5 + 0j, -5.0)
