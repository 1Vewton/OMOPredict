"""benchmark 模块单元测试：schema 校验、材料解析、执行器、指标、报告。"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from omo.benchmark import (
    MaterialResolver,
    QuantityMetrics,
    SchemaError,
    compute_metrics,
    load_dataset,
    parse_dataset,
    run_benchmark,
    simulate_record,
)
from omo.benchmark.schema import MaterialOverrides, OpticsOverride
from omo.electrical import (
    ITO_BULK_RESISTIVITY,
    SILVER_BULK_RESISTIVITY,
    SILVER_MEAN_FREE_PATH_NM,
    ConductiveLayer,
    sheet_resistance,
)
from omo.emi import ShieldingLayer, shielding_effectiveness
from omo.optics import ITO, SILVER, Layer, transfer_matrix

ROOT = Path(__file__).resolve().parents[2]
SYNTHETIC = ROOT / "docs" / "benchmarks" / "synthetic_ito_ag_ito.json"


def make_stack_dict() -> list[dict]:
    return [
        {"material": "ITO", "thickness_nm": 40.0},
        {"material": "Ag", "thickness_nm": 10.0},
        {"material": "ITO", "thickness_nm": 40.0},
    ]


def make_dataset_dict(**overrides: object) -> dict:
    data = {
        "meta": {
            "id": "test_dataset",
            "paper": {"title": "Test", "authors": "T", "year": 2020, "doi": "10.1/test"},
        },
        "records": [
            {
                "id": "r1",
                "stack": make_stack_dict(),
                "measured": {
                    "transmittance": [{"wavelength_nm": 550.0, "value": 0.9}],
                    "sheet_resistance": 5.0,
                    "se_x_band": 30.0,
                },
            }
        ],
    }
    data.update(overrides)
    return data


def test_load_synthetic_file() -> None:
    ds = load_dataset(SYNTHETIC)
    assert ds.meta.id == "synthetic_ito_ag_ito"
    assert len(ds.records) == 3
    assert all(len(r.stack) == 3 for r in ds.records)
    assert ds.meta.paper.doi == "synthetic"


def test_schema_errors() -> None:
    with pytest.raises(SchemaError):
        parse_dataset({"meta": make_dataset_dict()["meta"]})  # 缺 records

    bad = make_dataset_dict()
    bad["meta"]["paper"].pop("doi")
    with pytest.raises(SchemaError):
        parse_dataset(bad)

    bad = make_dataset_dict()
    bad["records"] = []
    with pytest.raises(SchemaError):
        parse_dataset(bad)

    bad = make_dataset_dict()
    bad["records"][0]["stack"][0]["thickness_nm"] = -1.0
    with pytest.raises(SchemaError):
        parse_dataset(bad)

    bad = make_dataset_dict()
    bad["records"][0]["measured"]["transmittance"][0]["value"] = 87.0  # 应为小数
    with pytest.raises(SchemaError):
        parse_dataset(bad)

    bad = make_dataset_dict()
    bad["simulation"] = {
        "materials": {
            "Ag": {
                "optics": {
                    "constant_index": [0.1, 3.0],
                    "drude": {
                        "eps_inf": 3.7,
                        "plasma_energy_ev": 9.1,
                        "damping_energy_ev": 0.02,
                    },
                }
            }
        }
    }
    with pytest.raises(SchemaError):
        parse_dataset(bad)


def test_material_resolver() -> None:
    resolver = MaterialResolver()
    assert resolver.optics_index("ITO") == ITO
    assert resolver.optics_index("Ag") == SILVER
    assert resolver.electrical("glass") is None
    with pytest.raises(ValueError):
        resolver.optics_index("SiO2")

    # 覆盖：只改光学，电学保留默认
    over = {"ITO": MaterialOverrides(optics=OpticsOverride(constant_index=1.9 + 0j))}
    r2 = MaterialResolver(over)
    assert r2.optics_index("ITO") == 1.9 + 0j
    assert r2.electrical("ITO").bulk_resistivity == pytest.approx(ITO_BULK_RESISTIVITY)


def test_round_trip_exact() -> None:
    """合成往返：引擎生成"实测"→ 框架必须精确复现（MAE < 1e-9）。"""
    stack = [("ITO", 40.0), ("Ag", 10.0), ("ITO", 40.0)]
    opt = [Layer(SILVER if m == "Ag" else ITO, d) for m, d in stack]
    spec = transfer_matrix(opt, np.array([550.0]))
    elec = [
        ConductiveLayer(
            d,
            SILVER_BULK_RESISTIVITY if m == "Ag" else ITO_BULK_RESISTIVITY,
            m,
            SILVER_MEAN_FREE_PATH_NM if m == "Ag" else 0.0,
        )
        for m, d in stack
    ]
    rs = sheet_resistance(elec)
    se_x = shielding_effectiveness(
        [ShieldingLayer.from_conductive_layer(c) for c in elec],
        np.linspace(8.2, 12.4, 43),
    ).x_band_average()
    se_10 = shielding_effectiveness(
        [ShieldingLayer.from_conductive_layer(c) for c in elec], np.array([10.0])
    ).se_db[0]

    ds = parse_dataset(
        {
            "meta": make_dataset_dict()["meta"],
            "records": [
                {
                    "id": "r1",
                    "stack": [{"material": m, "thickness_nm": d} for m, d in stack],
                    "measured": {
                        "transmittance": [
                            {"wavelength_nm": 550.0, "value": float(spec.transmittance[0])}
                        ],
                        "reflectance": [
                            {"wavelength_nm": 550.0, "value": float(spec.reflectance[0])}
                        ],
                        "sheet_resistance": float(rs),
                        "se": [{"frequency_ghz": 10.0, "value": float(se_10)}],
                        "se_x_band": float(se_x),
                    },
                }
            ],
        }
    )
    report = run_benchmark(ds)
    for name in ("transmittance", "reflectance", "sheet_resistance_log10", "se", "se_x_band"):
        assert name in report.quantities, name
        assert report.quantities[name].mae < 1e-9, name


def test_metrics_basic() -> None:
    m = compute_metrics(np.array([1.0, 2.0, 3.0]), np.array([1.0, 2.0, 4.0]))
    assert isinstance(m, QuantityMetrics)
    assert m.mae == pytest.approx(1.0 / 3.0)
    assert m.rmse == pytest.approx(np.sqrt(1.0 / 3.0))
    assert m.max_abs_error == pytest.approx(1.0)
    with pytest.raises(ValueError):
        compute_metrics(np.array([1.0]), np.array([1.0, 2.0]))


def test_partial_measurements() -> None:
    """只有 Rs 的记录：光学/屏蔽不触发。"""
    ds = parse_dataset(
        {
            "meta": make_dataset_dict()["meta"],
            "records": [
                {
                    "id": "r1",
                    "stack": [{"material": "Ag", "thickness_nm": 10.0}],
                    "measured": {"sheet_resistance": 5.04},
                }
            ],
        }
    )
    rec = ds.records[0]
    sim = simulate_record(rec, MaterialResolver(ds.simulation))
    expected = sheet_resistance(
        [ConductiveLayer(10.0, SILVER_BULK_RESISTIVITY, "Ag", SILVER_MEAN_FREE_PATH_NM)]
    )
    assert sim.sheet_resistance == pytest.approx(expected, rel=1e-9)  # Ag 10nm 含 FS 尺寸效应
    assert sim.transmittance == ()
    assert sim.se == ()


def test_se_without_conductive_raises() -> None:
    ds = parse_dataset(
        {
            "meta": make_dataset_dict()["meta"],
            "records": [
                {
                    "id": "r1",
                    "stack": [{"material": "glass", "thickness_nm": 1e6}],
                    "measured": {"se_x_band": 0.0},
                }
            ],
        }
    )
    with pytest.raises(ValueError):
        run_benchmark(ds)


def test_report_outputs(tmp_path: Path) -> None:
    ds = parse_dataset(make_dataset_dict())
    report = run_benchmark(ds)
    data = report.to_dict()
    assert "sheet_resistance_log10" in data["quantities"]
    assert data["records"][0]["record_id"] == "r1"

    jp = tmp_path / "report.json"
    report.save_json(jp)
    assert json.loads(jp.read_text(encoding="utf-8"))["dataset_id"] == "test_dataset"

    png = tmp_path / "report.png"
    report.plot(png)
    assert png.exists() and png.stat().st_size > 1000
