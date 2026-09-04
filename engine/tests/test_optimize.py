"""omo.optimize —— 目标反推模块测试（M5 v1）。

覆盖：目标模型校验与满足逻辑、网格扫描的可行性与排序、候选回灌物理
引擎自洽、SE 约束求值开关、灵敏度有限差分、工艺窗口、报告序列化与
确定性。测试用小型网格保持秒级以内。
"""

from __future__ import annotations

import json

import pytest

from omo.optimize import (
    CandidateMetrics,
    DesignTarget,
    OmoSearchConfig,
    analyze_sensitivity,
    evaluate_candidate,
    search_designs,
)

# 三层材料（默认体系）
MAT = ("ITO", "Ag", "ITO")


def _small_config() -> OmoSearchConfig:
    """小型网格：外层 30/40/50 × 金属 5/10/15 = 27 组合。"""
    return OmoSearchConfig(
        outer_bounds_nm=(30.0, 50.0),
        outer_step_nm=10.0,
        metal_bounds_nm=(5.0, 15.0),
        metal_step_nm=5.0,
    )


def _fake_metrics(**overrides: float) -> CandidateMetrics:
    """合成指标（不经过引擎），仅测约束逻辑。"""
    base: dict = {
        "thicknesses_nm": (40.0, 10.0, 40.0),
        "visible_transmittance": 0.9,
        "sheet_resistance": 5.0,
        "se_min_db": 35.0,
    }
    base.update(overrides)
    return CandidateMetrics(**base)  # type: ignore[arg-type]


# ---------------------------------------------------------------- 目标模型

class TestDesignTarget:
    def test_validation_rejects_invalid(self) -> None:
        with pytest.raises(ValueError):
            DesignTarget(min_visible_transmittance=1.5)
        with pytest.raises(ValueError):
            DesignTarget(min_visible_transmittance=0.0)
        with pytest.raises(ValueError):
            DesignTarget(max_sheet_resistance=0)
        with pytest.raises(ValueError):
            DesignTarget(min_se_db=-3)
        with pytest.raises(ValueError):
            DesignTarget(se_freq_range_ghz=(12.4, 8.2))

    def test_empty_target_is_browsing_scan(self) -> None:
        t = DesignTarget()
        assert not t.has_constraints
        assert t.describe() == []

    def test_has_constraints(self) -> None:
        assert DesignTarget(min_se_db=30.0).has_constraints
        assert DesignTarget(min_visible_transmittance=0.85).has_constraints

    def test_satisfied_all_constraints(self) -> None:
        t = DesignTarget(
            min_visible_transmittance=0.85, max_sheet_resistance=10.0, min_se_db=30.0
        )
        assert t.is_satisfied_by(_fake_metrics())

    def test_unsatisfied_when_any_violated(self) -> None:
        t = DesignTarget(min_visible_transmittance=0.95, max_sheet_resistance=10.0)
        assert not t.is_satisfied_by(_fake_metrics())  # T 不足
        t2 = DesignTarget(min_visible_transmittance=0.8, max_sheet_resistance=2.0)
        assert not t2.is_satisfied_by(_fake_metrics())  # Rs 超标
        t3 = DesignTarget(min_se_db=40.0)
        assert not t3.is_satisfied_by(_fake_metrics())  # SE 不足

    def test_none_metric_fails_constraint(self) -> None:
        t = DesignTarget(max_sheet_resistance=10.0, min_se_db=30.0)
        m = _fake_metrics(sheet_resistance=None, se_min_db=None)
        assert not t.is_satisfied_by(m)


# ---------------------------------------------------------------- 扫描寻优

class TestSearchDesigns:
    def test_default_grid_size(self) -> None:
        cfg = OmoSearchConfig()
        # 外层 20..80 步长 4 → 16 点；金属 5..20 步长 1 → 16 点
        assert cfg.n_combinations == 16 * 16 * 16
        g_outer, g_metal, g_outer2 = cfg.grids()
        assert g_outer[0] == 20.0 and g_outer[-1] == 80.0
        assert g_metal[0] == 5.0 and g_metal[-1] == 20.0

    def test_config_validation(self) -> None:
        with pytest.raises(ValueError):
            OmoSearchConfig(outer_bounds_nm=(80.0, 20.0))
        with pytest.raises(ValueError):
            OmoSearchConfig(metal_step_nm=0.0)
        with pytest.raises(ValueError):
            OmoSearchConfig(
                outer_bounds_nm=(0.0, 1.0),
                outer_step_nm=1e-6,
                metal_bounds_nm=(0.0, 1.0),
                metal_step_nm=1e-6,
            )  # 组合数超上限

    def test_loose_target_all_feasible_and_ranked(self) -> None:
        t = DesignTarget(min_visible_transmittance=0.3, max_sheet_resistance=100.0)
        report = search_designs(t, _small_config())
        assert report.n_scanned == 27
        assert report.n_feasible == 27
        assert len(report.candidates) == 10  # top_n 上限
        foms = [m.fom for m in report.candidates]
        assert foms == sorted(foms, reverse=True)
        for m in report.candidates:
            assert t.is_satisfied_by(m)

    def test_rank_ties_deterministic_thickness_tiebreak(self) -> None:
        t = DesignTarget(min_visible_transmittance=0.3, max_sheet_resistance=100.0)
        r1 = search_designs(t, _small_config())
        r2 = search_designs(t, _small_config())
        assert [m.thicknesses_nm for m in r1.candidates] == [
            m.thicknesses_nm for m in r2.candidates
        ]

    def test_top_candidate_self_consistent_with_engine(self) -> None:
        """Top 候选回灌物理引擎复核：指标一致且满足约束（自洽验收）。"""
        t = DesignTarget(
            min_visible_transmittance=0.85, max_sheet_resistance=50.0, min_se_db=20.0
        )
        report = search_designs(t, _small_config())
        assert report.candidates, "该目标在小型网格上应存在可行解"
        top = report.candidates[0]
        # 回灌：按同一语义重新求值（含 SE 频带）
        fresh = evaluate_candidate(
            top.thicknesses_nm,
            MAT,
            se_band_ghz=t.se_freq_range_ghz,
        )
        assert fresh.visible_transmittance == pytest.approx(top.visible_transmittance, abs=1e-12)
        assert fresh.sheet_resistance == pytest.approx(
            top.sheet_resistance if top.sheet_resistance is not None else 0.0, abs=1e-12
        )
        assert fresh.se_min_db == pytest.approx(
            top.se_min_db if top.se_min_db is not None else 0.0, abs=1e-12
        )
        assert t.is_satisfied_by(fresh)
        # FoM 应为全局最高（与全体求值的 best_effort 一致，因全部可行）
        assert report.best_effort is not None
        assert top.thicknesses_nm == report.best_effort.thicknesses_nm

    def test_no_se_constraint_skips_shielding(self) -> None:
        t = DesignTarget(min_visible_transmittance=0.3, max_sheet_resistance=100.0)
        report = search_designs(t, _small_config())
        assert all(m.se_min_db is None for m in report.candidates)

    def test_impossible_target_reports_empty(self) -> None:
        t = DesignTarget(min_visible_transmittance=0.99, max_sheet_resistance=0.1)
        report = search_designs(t, _small_config())
        assert report.n_feasible == 0
        assert report.candidates == ()
        assert report.best_effort is not None  # 提供最接近参考

    def test_report_to_dict_json_roundtrip(self) -> None:
        t = DesignTarget(min_visible_transmittance=0.3, max_sheet_resistance=100.0)
        report = search_designs(t, _small_config())
        d = report.to_dict()
        text = json.dumps(d, ensure_ascii=False)
        loaded = json.loads(text)
        assert loaded["n_scanned"] == 27
        assert loaded["pipeline_version"].startswith("omo.optimize.search")
        assert loaded["candidates"][0]["thicknesses_nm"][1] > 0


# ---------------------------------------------------------------- 灵敏度

class TestSensitivity:
    def test_finite_difference_matches_direct_eval(self) -> None:
        nominal = evaluate_candidate((40.0, 10.0, 40.0), MAT, se_band_ghz=(8.2, 12.4))
        sens = analyze_sensitivity(nominal, MAT, step_nm=1.0)
        metal = sens.layers[1]
        # 手算中心差分对照（金属层 ±1 nm）
        m_plus = evaluate_candidate((40.0, 11.0, 40.0), MAT)
        m_minus = evaluate_candidate((40.0, 9.0, 40.0), MAT)
        expect_dt = (m_plus.visible_transmittance - m_minus.visible_transmittance) / 2.0
        assert metal.dt_abs_per_nm == pytest.approx(expect_dt, abs=1e-12)
        # 金属加厚 → 方阻下降（log10 Rs 导数为负）
        assert metal.dlog10_rs_per_nm is not None and metal.dlog10_rs_per_nm < 0
        # 金属加厚 → T 下降 → FoM 相对变化为负（T¹⁰ 主导）
        assert metal.dfom_rel_per_nm < 0

    def test_outer_layers_derivatives_finite(self) -> None:
        nominal = evaluate_candidate((40.0, 10.0, 40.0), MAT)
        sens = analyze_sensitivity(nominal, MAT, step_nm=1.0)
        for s in sens.layers:
            assert s.dfom_rel_per_nm == pytest.approx(s.dfom_rel_per_nm)  # 有限值
            assert abs(s.dt_abs_per_nm) < 1.0  # 每 nm 的 T 变化在合理量级

    def test_process_window_bounds_feasibility(self) -> None:
        nominal = evaluate_candidate((40.0, 10.0, 40.0), MAT)
        # 目标：T 在标称基础上留 5% 余量 → 金属加厚会先破坏约束
        t = DesignTarget(min_visible_transmittance=nominal.visible_transmittance - 0.05)
        sens = analyze_sensitivity(
            nominal, MAT, target=t, max_tolerance_nm=3.0, probe_step_nm=0.5
        )
        metal = sens.layers[1]
        assert metal.tolerance_nm is not None
        assert 0.0 < metal.tolerance_nm <= 3.0
        # 容差内（标称 + tol）仍可行；再推 0.5 nm 必违反（tol < 上限时）
        in_win = evaluate_candidate((40.0, 10.0 + metal.tolerance_nm, 40.0), MAT)
        assert t.is_satisfied_by(in_win)
        if metal.tolerance_nm < 3.0:
            out = evaluate_candidate((40.0, 10.0 + metal.tolerance_nm + 0.5, 40.0), MAT)
            assert not t.is_satisfied_by(out)

    def test_tolerance_none_for_infeasible_nominal(self) -> None:
        nominal = evaluate_candidate((50.0, 15.0, 50.0), MAT)
        t = DesignTarget(min_visible_transmittance=0.999)  # 标称不满足
        sens = analyze_sensitivity(nominal, MAT, target=t)
        assert all(s.tolerance_nm is None for s in sens.layers)

    def test_invalid_params(self) -> None:
        nominal = evaluate_candidate((40.0, 10.0, 40.0), MAT)
        with pytest.raises(ValueError):
            analyze_sensitivity(nominal, MAT, step_nm=0.0)
        with pytest.raises(ValueError):
            analyze_sensitivity(nominal, MAT, max_tolerance_nm=-1.0)
