"""电学模块单元测试：并联模型、Fuchs–Sondheimer 尺寸效应、参数校验。"""

from __future__ import annotations

import pytest

from omo.electrical import (
    ITO_BULK_RESISTIVITY,
    SILVER_BULK_RESISTIVITY,
    SILVER_MEAN_FREE_PATH_NM,
    ConductiveLayer,
    fuchs_sondheimer_ratio,
    sheet_resistance,
)


def test_single_layer_sheet_resistance() -> None:
    """单层无尺寸效应：Rs = ρ/d。Ag 10 nm → 1.59 Ω/sq。"""
    layer = ConductiveLayer(
        thickness_nm=10.0, bulk_resistivity=SILVER_BULK_RESISTIVITY, name="Ag"
    )
    assert layer.sheet_resistance() == pytest.approx(1.59, rel=1e-9)
    assert sheet_resistance([layer]) == pytest.approx(1.59, rel=1e-9)


def test_parallel_model_halves_resistance() -> None:
    """两个相同导电层并联：方阻减半。"""
    layer = ConductiveLayer(thickness_nm=10.0, bulk_resistivity=SILVER_BULK_RESISTIVITY)
    assert sheet_resistance([layer, layer]) == pytest.approx(1.59 / 2.0, rel=1e-9)


def test_zero_thickness_layers_skipped() -> None:
    """厚度为 0 的层不贡献电导。"""
    d0 = ConductiveLayer(thickness_nm=0.0, bulk_resistivity=SILVER_BULK_RESISTIVITY)
    real = ConductiveLayer(thickness_nm=10.0, bulk_resistivity=SILVER_BULK_RESISTIVITY)
    assert sheet_resistance([d0, real]) == pytest.approx(1.59, rel=1e-9)


def test_no_conductive_path_raises() -> None:
    """空列表或全零厚度：无导电通路，抛 ValueError。"""
    d0 = ConductiveLayer(thickness_nm=0.0, bulk_resistivity=SILVER_BULK_RESISTIVITY)
    with pytest.raises(ValueError):
        sheet_resistance([])
    with pytest.raises(ValueError):
        sheet_resistance([d0])


def test_no_size_effect_without_mfp() -> None:
    """mean_free_path_nm = 0（默认）：有效电阻率 = 块体值。"""
    layer = ConductiveLayer(thickness_nm=10.0, bulk_resistivity=1.59e-8)
    assert layer.effective_resistivity() == pytest.approx(1.59e-8, rel=1e-12)


def test_fs_large_thickness_limit() -> None:
    """κ ≫ 1 极限：ρ_film/ρ_bulk ≈ 1 + 3λ/(8d)。"""
    d, lam = 1000.0, SILVER_MEAN_FREE_PATH_NM
    ratio = fuchs_sondheimer_ratio(d, lam)
    approx = 1.0 + 3.0 * lam / (8.0 * d)
    assert ratio == pytest.approx(approx, rel=1e-3)


def test_fs_specular_scattering_no_effect() -> None:
    """p = 1（全镜面散射）：无尺寸效应，比值恒为 1。"""
    for d in (5.0, 10.0, 50.0):
        assert fuchs_sondheimer_ratio(d, 52.0, specularity=1.0) == pytest.approx(1.0, abs=1e-12)


def test_fs_thin_film_enhancement_monotonic() -> None:
    """膜越薄增强越大且恒 > 1：r(5) > r(10) > r(100) > 1。"""
    r5 = fuchs_sondheimer_ratio(5.0, 52.0)
    r10 = fuchs_sondheimer_ratio(10.0, 52.0)
    r100 = fuchs_sondheimer_ratio(100.0, 52.0)
    assert r5 > r10 > r100 > 1.0
    assert r10 > 2.0  # 10 nm Ag：尺寸效应增强超过 2 倍（物理上界）


def test_fs_validation() -> None:
    """非法参数应抛 ValueError。"""
    with pytest.raises(ValueError):
        fuchs_sondheimer_ratio(0.0, 52.0)
    with pytest.raises(ValueError):
        fuchs_sondheimer_ratio(-10.0, 52.0)
    with pytest.raises(ValueError):
        fuchs_sondheimer_ratio(10.0, 0.0)
    with pytest.raises(ValueError):
        fuchs_sondheimer_ratio(10.0, 52.0, specularity=1.5)
    with pytest.raises(ValueError):
        fuchs_sondheimer_ratio(10.0, 52.0, specularity=-0.1)


def test_ito_ag_ito_sheet_resistance() -> None:
    """ITO(40)/Ag(10)/ITO(40)：Ag 主导、ITO 并联贡献，Rs 在物理范围。"""
    ag = ConductiveLayer(
        thickness_nm=10.0,
        bulk_resistivity=SILVER_BULK_RESISTIVITY,
        name="Ag",
        mean_free_path_nm=SILVER_MEAN_FREE_PATH_NM,
    )
    ito = ConductiveLayer(thickness_nm=40.0, bulk_resistivity=ITO_BULK_RESISTIVITY, name="ITO")
    rs = sheet_resistance([ito, ag, ito])
    rs_ag_only = sheet_resistance([ag])
    # 文献 ITO/Ag/ITO 常见 5–10 Ω/sq；本模型无界面/粗糙度散射项，结果偏低属正常
    assert 2.0 < rs < 4.5
    assert rs < rs_ag_only  # ITO 并联使总方阻低于纯 Ag


def test_layer_validation() -> None:
    """ConductiveLayer 参数校验。"""
    with pytest.raises(ValueError):
        ConductiveLayer(thickness_nm=-1.0, bulk_resistivity=1.59e-8)
    with pytest.raises(ValueError):
        ConductiveLayer(thickness_nm=10.0, bulk_resistivity=0.0)
    with pytest.raises(ValueError):
        ConductiveLayer(thickness_nm=10.0, bulk_resistivity=1.59e-8, specularity=2.0)
