"""灵敏度与工艺窗口分析（M5 · 目标反推）。

对最佳可行候选，逐层做 ±1 nm 有限差分得到"每 nm 厚度变化对指标的
影响"（相对 FoM / 绝对 T_vis / log₁₀ Rs 的导数），回答"哪一层对目标
性能影响最大"；再自标称点向外探测单层厚度可移动的对称容差——保持
目标约束仍被满足的"工艺窗口"，供工艺指导使用。

参考：AGENTS.md §3.4（工艺指导：输出灵敏度分析与推荐工艺窗口）。
导数取中心差分；标称点贴 0 边界时退化为前向差分。
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from omo.optimize.evaluate import CandidateMetrics, evaluate_candidate
from omo.optimize.target import DesignTarget


@dataclass(frozen=True)
class LayerSensitivity:
    """单层的灵敏度与工艺容差。

    属性:
        layer_index: 层序号（0 = 入射侧外层，1 = 金属层，2 = 出射侧外层）
        material: 材料名
        thickness_nm: 标称厚度（nm）
        dfom_rel_per_nm: FoM 相对变化率（每 nm 的 ΔFoM/FoM）
        dt_abs_per_nm: 可见光透过率绝对变化率（每 nm 的 ΔT_vis）
        dlog10_rs_per_nm: log₁₀(Rs) 变化率；无 Rs 时为 None
        tolerance_nm: 保持目标可行的单层对称容差（±nm，自标称点外推到
            首次违反约束处）；标称不可行或无约束时为 None
    """

    layer_index: int
    material: str
    thickness_nm: float
    dfom_rel_per_nm: float
    dt_abs_per_nm: float
    dlog10_rs_per_nm: float | None
    tolerance_nm: float | None


@dataclass(frozen=True)
class SensitivityAnalysis:
    """最佳候选的灵敏度分析结果。"""

    nominal: CandidateMetrics
    layers: tuple[LayerSensitivity, ...]


def analyze_sensitivity(
    nominal: CandidateMetrics,
    materials: tuple[str, str, str],
    target: DesignTarget | None = None,
    substrate_index: float = 1.5,
    step_nm: float = 1.0,
    max_tolerance_nm: float = 5.0,
    probe_step_nm: float = 0.5,
) -> SensitivityAnalysis:
    """分析最佳候选的逐层灵敏度与工艺窗口。

    参数:
        nominal: 标称候选（通常是搜索报告的首个可行候选）
        materials: 三层材料名
        target: 目标（容差判断用）；None 或标称不满足时 tolerance 为 None
        substrate_index: 衬底折射率
        step_nm: 灵敏度有限差分步长（默认 1 nm）
        max_tolerance_nm: 工艺窗口探测上限（默认 ±5 nm）
        probe_step_nm: 工艺窗口探测分辨率（默认 0.5 nm）

    返回:
        SensitivityAnalysis

    异常:
        ValueError: step_nm/probe_step_nm ≤ 0 或 max_tolerance_nm < 0
    """
    if step_nm <= 0 or probe_step_nm <= 0 or max_tolerance_nm < 0:
        raise ValueError("step_nm/probe_step_nm 需 > 0 且 max_tolerance_nm ≥ 0")

    t_nominal = nominal.thicknesses_nm
    nominal_feasible = target is not None and target.is_satisfied_by(nominal)
    # 目标含 SE 约束时，重求值需带同一频带（否则 se_min_db=None 被误判违反约束）
    se_band = (
        target.se_freq_range_ghz
        if (target is not None and target.min_se_db is not None)
        else None
    )

    layers: list[LayerSensitivity] = []
    for idx, (t0, mat) in enumerate(zip(t_nominal, materials, strict=True)):
        # ---- 导数（中心差分；贴 0 边界退化为前向）----
        h = step_nm
        ts_plus = _perturbed(t_nominal, idx, t0 + h)
        ts_minus = _perturbed(t_nominal, idx, t0 - h) if t0 - h >= 0 else None
        m_plus = evaluate_candidate(
            ts_plus, materials, substrate_index=substrate_index, se_band_ghz=se_band
        )
        m_minus = (
            evaluate_candidate(
                ts_minus, materials, substrate_index=substrate_index, se_band_ghz=se_band
            )
            if ts_minus is not None
            else None
        )

        fom0 = nominal.fom
        if fom0:
            dfom_rel = _deriv_value(
                _fom_or_zero(m_plus),
                _fom_or_zero(nominal),
                _fom_or_zero(m_minus) if m_minus is not None else None,
                h,
            ) / fom0
        else:
            dfom_rel = 0.0
        dt_abs = _deriv_value(
            m_plus.visible_transmittance,
            nominal.visible_transmittance,
            m_minus.visible_transmittance if m_minus is not None else None,
            h,
        )
        dlog10_rs: float | None = None
        if nominal.sheet_resistance is not None:
            dlog10_rs = _deriv_value(
                _log10_rs(m_plus),
                _log10_rs(nominal),
                _log10_rs(m_minus) if m_minus is not None else None,
                h,
            )

        # ---- 工艺窗口：自标称点向外探测到首次违反约束 ----
        tol: float | None = None
        if nominal_feasible and target is not None:
            tol = _tolerance(
                nominal, idx, t0, target, materials, substrate_index,
                max_tolerance_nm, probe_step_nm, se_band,
            )

        layers.append(
            LayerSensitivity(
                layer_index=idx,
                material=mat,
                thickness_nm=t0,
                dfom_rel_per_nm=float(dfom_rel),
                dt_abs_per_nm=dt_abs,
                dlog10_rs_per_nm=dlog10_rs,
                tolerance_nm=tol,
            )
        )

    return SensitivityAnalysis(nominal=nominal, layers=tuple(layers))


def _perturbed(
    base: tuple[float, float, float], index: int, new_value: float
) -> tuple[float, float, float]:
    """把 base 的第 index 层替换为 new_value（保持其余不变）。"""
    out = list(base)
    out[index] = new_value
    return (out[0], out[1], out[2])


def _fom_or_zero(m: CandidateMetrics) -> float:
    return m.fom if m.fom is not None else 0.0


def _log10_rs(m: CandidateMetrics) -> float:
    """log₁₀(Rs)；Rs 缺失时按 NaN（调用方仅在 Rs 存在时使用）。"""
    if m.sheet_resistance is None:
        return float("nan")
    return math.log10(m.sheet_resistance)


def _deriv_value(
    v_plus: float,
    v_nominal: float,
    v_minus: float | None,
    h: float,
) -> float:
    """中心差分 (f(+h)−f(−h))/2h；v_minus 缺失（贴 0 边界）退化为前向差分。"""
    if v_minus is None:
        return float((v_plus - v_nominal) / h)
    return float((v_plus - v_minus) / (2.0 * h))


def _tolerance(
    nominal: CandidateMetrics,
    index: int,
    t0: float,
    target: DesignTarget,
    materials: tuple[str, str, str],
    substrate_index: float,
    max_tolerance_nm: float,
    probe_step_nm: float,
    se_band: tuple[float, float] | None,
) -> float:
    """单层对称容差：± 方向各自外推到首次违反约束处的最大偏移。

    返回 min(下向偏移, 上向偏移)；任一侧贴 0 边界时取该侧可行偏移。
    默认探测步长 0.5 nm，结果向 probe_step_nm 取整语义（保守取下沿）。
    """
    if max_tolerance_nm <= 0:
        return 0.0

    def reach(direction: int) -> float:
        offset = 0.0
        while offset < max_tolerance_nm:
            offset += probe_step_nm
            t_new = t0 + direction * offset
            if t_new < 0:
                return offset - probe_step_nm  # 物理下界
            m = evaluate_candidate(
                _perturbed(nominal.thicknesses_nm, index, t_new),
                materials,
                substrate_index=substrate_index,
                se_band_ghz=se_band,
            )
            if not target.is_satisfied_by(m):
                return offset - probe_step_nm
        return max_tolerance_nm

    down = reach(-1)
    up = reach(+1)
    return min(down, up)
