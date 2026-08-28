"""calibrate 模块单元测试：覆盖合并、拟合、灵敏度、真值恢复、留出法。"""

from __future__ import annotations

import math
from pathlib import Path

import pytest

from omo.benchmark import (
    CalibrationConstant,
    build_overrides,
    calibrate,
    default_ag_constants,
    load_dataset,
    merge_overrides,
    parse_dataset,
    run_benchmark,
    sensitivity_analysis,
)
from omo.benchmark.schema import ElectricalOverride, MaterialOverrides
from omo.electrical import SILVER_BULK_RESISTIVITY, ConductiveLayer, sheet_resistance
from omo.materials import MaterialResolver
from omo.optics import SILVER

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / "docs" / "benchmarks"
SYNTHETIC = BASE / "synthetic_ito_ag_ito.json"


def _real_datasets():
    return [
        load_dataset(BASE / "in2o3_ag_in2o3_voronin2025.json"),
        load_dataset(BASE / "ito_al_ag_ito_isiyaku2020.json"),
        load_dataset(BASE / "wo3x_ag_wo3x_lim2020.json"),
    ]


def test_merge_overrides() -> None:
    """合并：extra 优先，未涉及的字段保留 base，材料并集。"""
    base = {"ITO": MaterialOverrides(electrical=ElectricalOverride(bulk_resistivity=1.5e-6))}
    extra = {
        "ITO": MaterialOverrides(electrical=ElectricalOverride(mean_free_path_nm=10.0)),
        "Ag": MaterialOverrides(),
    }
    merged = merge_overrides(base, extra)
    assert merged["ITO"].electrical.bulk_resistivity == pytest.approx(1.5e-6)
    assert merged["ITO"].electrical.mean_free_path_nm == pytest.approx(10.0)
    assert "Ag" in merged


def test_build_overrides_drude() -> None:
    """拟合 Ag Drude 阻尼：生成完整 Drude 覆盖，其余参数保留默认。"""
    resolver = MaterialResolver()
    const = CalibrationConstant(
        "Ag_damping_energy_ev", "Ag", "damping_energy_ev", (0.005, 0.2)
    )
    built = build_overrides([const], {"Ag_damping_energy_ev": 0.05}, resolver)
    drude = built["Ag"].optics.drude
    assert drude is not None
    assert drude.damping_energy_ev == pytest.approx(0.05)
    assert drude.eps_inf == pytest.approx(SILVER.eps_inf)
    assert drude.plasma_energy_ev == pytest.approx(SILVER.plasma_energy_ev)


def test_calibrate_recovers_known_lambda() -> None:
    """合成真值恢复：已知 λ=80 nm 生成 Rs 数据 → 校准应找回 ≈80。

    这是校准机制的核心验证：给定可识别的问题，拟合必须收敛到真值。
    """
    lam_true = 80.0
    records = []
    for d in (8.0, 10.0, 12.0, 14.0, 16.0):
        rs = sheet_resistance(
            [ConductiveLayer(d, SILVER_BULK_RESISTIVITY, "Ag", lam_true)]
        )
        records.append(
            {
                "id": f"d{d}",
                "stack": [{"material": "Ag", "thickness_nm": d}],
                "measured": {"sheet_resistance": float(rs)},
            }
        )
    ds = parse_dataset(
        {
            "meta": {
                "id": "syn_cal",
                "paper": {"title": "T", "authors": "A", "year": 2025, "doi": "10.1/syn"},
            },
            "records": records,
        }
    )
    const = CalibrationConstant(
        "Ag_mean_free_path_nm", "Ag", "mean_free_path_nm", (20.0, 150.0)
    )
    result = calibrate([ds], [const])
    fitted = result.fitted["Ag_mean_free_path_nm"]
    assert lam_true * 0.9 <= fitted <= lam_true * 1.1, f"拟合 λ={fitted} 偏离真值"
    before = sum(v.mae for v in result.before_train.values())
    after = sum(v.mae for v in result.after_train.values())
    assert after < before


def test_sensitivity_analysis_runs() -> None:
    """真实数据上灵敏度分析：返回全部常数的有限值。"""
    sens = sensitivity_analysis(_real_datasets(), default_ag_constants())
    assert set(sens) == {
        "Ag_bulk_resistivity",
        "Ag_mean_free_path_nm",
        "Ag_damping_energy_ev",
    }
    assert all(math.isfinite(v) for v in sens.values())


def test_calibrate_real_datasets(tmp_path: Path) -> None:
    """真实数据留出法校准：训练损失必须改善，拟合值在边界内。"""
    train = {"IAI-3", "annealed_400C", "ag_rate_0.50", "ag_rate_0.75", "ag_rate_1.00"}
    val = {"IAI-1", "IAI-2", "ag_rate_0.25"}
    consts = default_ag_constants()[:2]  # Ag 电阻率 + 平均自由程
    result = calibrate(
        _real_datasets(), consts, train_record_ids=train, val_record_ids=val
    )

    def loss(metrics: dict) -> float:
        return sum(v.mae for v in metrics.values())

    assert loss(result.after_train) < loss(result.before_train)
    for c in consts:
        assert c.bounds[0] <= result.fitted[c.name] <= c.bounds[1]
    assert result.train_record_ids == tuple(sorted(train))
    assert result.val_record_ids == tuple(sorted(val))
    out = tmp_path / "calibration.json"
    result.save_json(out)
    assert out.exists() and out.stat().st_size > 0


def test_run_benchmark_record_ids() -> None:
    """run_benchmark 支持记录子集过滤（留出法基础）。"""
    ds = load_dataset(SYNTHETIC)
    rep = run_benchmark(ds, record_ids={"s1"})
    assert len(rep.records) == 1
    assert rep.records[0].record_id == "s1"
    assert rep.quantities["sheet_resistance_log10"].n == 1
