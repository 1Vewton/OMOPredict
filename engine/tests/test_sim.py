"""omo.sim（中立编排层）测试：领域校验、无导电层行为、与引擎直算一致。"""

from __future__ import annotations

import numpy as np
import pytest

from omo.electrical import (
    ITO_BULK_RESISTIVITY,
    SILVER_BULK_RESISTIVITY,
    SILVER_MEAN_FREE_PATH_NM,
    ConductiveLayer,
    sheet_resistance,
)
from omo.optics import ITO, SILVER, Layer, transfer_matrix
from omo.sim import LayerSpec, SimulateSpec, simulate

ITO_AG_ITO = (
    LayerSpec(material="ITO", thickness_nm=40.0),
    LayerSpec(material="Ag", thickness_nm=10.0),
    LayerSpec(material="ITO", thickness_nm=40.0),
)


def test_simulate_matches_engine_directly() -> None:
    """sim 结果与直接调用物理子包一致（跨验）。"""
    result = simulate(SimulateSpec(layers=ITO_AG_ITO))

    wl = np.array([float(w) for w in np.arange(380.0, 1001.0, 10.0)])
    spec = transfer_matrix([Layer(ITO, 40.0), Layer(SILVER, 10.0), Layer(ITO, 40.0)], wl)
    cond = [
        ConductiveLayer(40.0, ITO_BULK_RESISTIVITY, "ITO"),
        ConductiveLayer(10.0, SILVER_BULK_RESISTIVITY, "Ag", SILVER_MEAN_FREE_PATH_NM),
        ConductiveLayer(40.0, ITO_BULK_RESISTIVITY, "ITO"),
    ]

    assert len(result.transmittance.x) == wl.size
    assert result.transmittance.value[0] == pytest.approx(spec.transmittance[0], rel=1e-9)
    assert result.sheet_resistance == pytest.approx(sheet_resistance(cond), rel=1e-9)
    assert len(result.se_db.x) == 18
    assert result.se_db.x[0] == pytest.approx(1.0)


def test_simulate_insulator_has_no_rs_or_se() -> None:
    """纯绝缘 stack（玻璃）：Rs 为 None、SE 为空序列（线格式为 []）。"""
    result = simulate(SimulateSpec(layers=(LayerSpec(material="glass", thickness_nm=1e6),)))
    assert result.sheet_resistance is None
    assert result.se_db.value == ()
    body = result.to_dict()
    assert body["sheet_resistance"] is None
    assert body["se_db"] == []
    assert body["transmittance"]  # 光学仍然有结果


def test_simulate_custom_grids() -> None:
    """自定义输出网格。"""
    result = simulate(
        SimulateSpec(layers=ITO_AG_ITO, wavelengths_nm=(550.0,), freqs_ghz=(10.0,))
    )
    assert result.transmittance.x == (550.0,)
    assert result.se_db.x == (10.0,)


@pytest.mark.parametrize(
    "spec, message_part",
    [
        (SimulateSpec(layers=()), "layers 至少需要一层"),
        (
            SimulateSpec(layers=(LayerSpec(material="ITO", thickness_nm=-1.0),)),
            "厚度必须为 ≥ 0",
        ),
        (
            SimulateSpec(layers=(LayerSpec(material="", thickness_nm=10.0),)),
            "材料名不能为空",
        ),
        (SimulateSpec(layers=ITO_AG_ITO, substrate_index=0.0), "substrate_index 必须 > 0"),
        (
            SimulateSpec(layers=ITO_AG_ITO, wavelengths_nm=(0.0,)),
            "wavelengths_nm 必须是一维且全为正",
        ),
        (SimulateSpec(layers=ITO_AG_ITO, freqs_ghz=(-1.0,)), "freqs_ghz 必须是一维且全为正"),
    ],
)
def test_simulate_domain_validation(spec: SimulateSpec, message_part: str) -> None:
    """领域校验失败 → ValueError（两种传输都映射为 422）。"""
    with pytest.raises(ValueError, match=message_part):
        simulate(spec)


def test_simulate_unknown_material() -> None:
    """未知材料由 MaterialResolver 抛 ValueError（消息含材料名）。"""
    with pytest.raises(ValueError, match="ZnO"):
        simulate(SimulateSpec(layers=(LayerSpec(material="ZnO", thickness_nm=40.0),)))
