"""模型常数校准：灵敏度分析 → 拟合最敏感常数 → 留出法验证（M2.3）。

纪律（AGENTS.md §6）：
- 只拟合灵敏度分析筛选出的 1–3 个最敏感常数，且限制在物理合理边界内；
- 留出验证集：校准只在训练记录上拟合，验证集评估泛化，防过拟合；
- 拟合结果以数据集 simulation 覆盖段的形式导出（不直接改写引擎注册表默认值）；
- 对超出模型能力的偏差（如薄 Ag 的渗流/界面散射，FS 模型无法表达），
  不强行用常数"拟合"，而是保留为模型边界并在报告中说明。

损失定义（按量加权 MSE）：
- sheet_resistance_log10：log₁₀(Rs) 空间，权重 1
- transmittance / reflectance：绝对值（0–1），权重 1
- se / se_x_band：dB，权重 0.1（量纲更大）
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from scipy.optimize import minimize

from omo.benchmark.materials import MaterialResolver
from omo.benchmark.metrics import QuantityMetrics, compute_metrics
from omo.benchmark.report import collect_samples
from omo.benchmark.schema import (
    BenchmarkDataset,
    ElectricalOverride,
    MaterialOverrides,
    OpticsOverride,
)
from omo.optics import DrudeMaterial

# 各量的损失权重（见模块文档字符串）
_LOSS_WEIGHTS: dict[str, float] = {
    "sheet_resistance_log10": 1.0,
    "transmittance": 1.0,
    "reflectance": 1.0,
    "se": 0.1,
    "se_x_band": 0.1,
}

# 允许校准的参数名（按域）
_ELECTRICAL_PARAMS = ("bulk_resistivity", "mean_free_path_nm", "specularity")
_INDEX_PARAMS = ("index_real", "index_imag")
_DRUDE_PARAMS = ("eps_inf", "plasma_energy_ev", "damping_energy_ev")


@dataclass(frozen=True)
class CalibrationConstant:
    """一个可校准常数（材料 + 参数 + 物理合理边界）。

    参数:
        name: 唯一名（如 "Ag_mean_free_path_nm"）
        material: 材料名（ITO / Ag / WO3x ...）
        param: 参数标识——电学：
            "bulk_resistivity" | "mean_free_path_nm" | "specularity"；
            常数折射率光学："index_real" | "index_imag"；
            Drude 光学："eps_inf" | "plasma_energy_ev" | "damping_energy_ev"
        bounds: (min, max) 拟合边界
    """

    name: str
    material: str
    param: str
    bounds: tuple[float, float]


@dataclass(frozen=True)
class CalibrationResult:
    """校准结果：拟合值、灵敏度、训练/验证误差（校准前后）。"""

    constants: tuple[CalibrationConstant, ...]
    fitted: dict[str, float]
    sensitivity: dict[str, float]
    train_record_ids: tuple[str, ...]
    val_record_ids: tuple[str, ...]
    before_train: dict[str, QuantityMetrics]
    after_train: dict[str, QuantityMetrics]
    before_val: dict[str, QuantityMetrics]
    after_val: dict[str, QuantityMetrics]

    def to_dict(self) -> dict[str, Any]:
        return {
            "fitted": self.fitted,
            "sensitivity": self.sensitivity,
            "train_record_ids": list(self.train_record_ids),
            "val_record_ids": list(self.val_record_ids),
            "before_train": {k: v.to_dict() for k, v in self.before_train.items()},
            "after_train": {k: v.to_dict() for k, v in self.after_train.items()},
            "before_val": {k: v.to_dict() for k, v in self.before_val.items()},
            "after_val": {k: v.to_dict() for k, v in self.after_val.items()},
        }

    def save_json(self, path: str | Path) -> None:
        """将校准报告写入 JSON 文件（UTF-8）。"""
        Path(path).write_text(
            __import__("json").dumps(self.to_dict(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


def merge_overrides(
    base: Mapping[str, MaterialOverrides],
    extra: Mapping[str, MaterialOverrides],
) -> dict[str, MaterialOverrides]:
    """逐材料逐字段合并覆盖（extra 优先，未涉及的字段保留 base）。

    用于把数据集自带覆盖（如 Al / WO3x）与校准拟合值合并。
    """
    result: dict[str, MaterialOverrides] = {}
    for material in set(base) | set(extra):
        b = base.get(material, MaterialOverrides())
        e = extra.get(material, MaterialOverrides())
        result[material] = MaterialOverrides(
            optics=OpticsOverride(
                constant_index=(
                    e.optics.constant_index
                    if e.optics.constant_index is not None
                    else b.optics.constant_index
                ),
                drude=e.optics.drude if e.optics.drude is not None else b.optics.drude,
            ),
            electrical=ElectricalOverride(
                bulk_resistivity=(
                    e.electrical.bulk_resistivity
                    if e.electrical.bulk_resistivity is not None
                    else b.electrical.bulk_resistivity
                ),
                mean_free_path_nm=(
                    e.electrical.mean_free_path_nm
                    if e.electrical.mean_free_path_nm is not None
                    else b.electrical.mean_free_path_nm
                ),
                specularity=(
                    e.electrical.specularity
                    if e.electrical.specularity is not None
                    else b.electrical.specularity
                ),
            ),
        )
    return result


def _initial_value(constant: CalibrationConstant, resolver: MaterialResolver) -> float:
    """取常数当前值（引擎默认或数据集覆盖）。"""
    if constant.param in _ELECTRICAL_PARAMS:
        ed = resolver.electrical(constant.material)
        if ed is None:
            raise ValueError(
                f"材料 {constant.material!r} 无电学模型，无法校准 {constant.param}"
            )
        return float(getattr(ed, constant.param))
    idx = resolver.optics_index(constant.material)
    if isinstance(idx, complex):
        if constant.param == "index_real":
            return float(idx.real)
        if constant.param == "index_imag":
            return float(idx.imag)
        raise ValueError(f"常数折射率材料不支持参数 {constant.param!r}")
    if constant.param in _DRUDE_PARAMS:
        return float(getattr(idx, constant.param))
    raise ValueError(f"未知参数 {constant.param!r}")


def build_overrides(
    constants: Sequence[CalibrationConstant],
    values: Mapping[str, float],
    base_resolver: MaterialResolver,
) -> dict[str, MaterialOverrides]:
    """把拟合值映射为覆盖段；未校准参数取 base_resolver 当前值（含数据集覆盖）。"""
    by_material: dict[str, dict[str, float]] = {}
    for c in constants:
        by_material.setdefault(c.material, {})[c.param] = float(values[c.name])

    result: dict[str, MaterialOverrides] = {}
    for material, params in by_material.items():
        optics = OpticsOverride()
        base_index = base_resolver.optics_index(material)
        if isinstance(base_index, complex):
            n = params.get("index_real", base_index.real)
            k = params.get("index_imag", base_index.imag)
            if "index_real" in params or "index_imag" in params:
                optics = OpticsOverride(constant_index=complex(n, k))
        else:
            optics = OpticsOverride(
                drude=DrudeMaterial(
                    eps_inf=params.get("eps_inf", base_index.eps_inf),
                    plasma_energy_ev=params.get("plasma_energy_ev", base_index.plasma_energy_ev),
                    damping_energy_ev=params.get(
                        "damping_energy_ev", base_index.damping_energy_ev
                    ),
                )
            )
        electrical = ElectricalOverride()
        ed = base_resolver.electrical(material)
        if ed is not None:
            electrical = ElectricalOverride(
                bulk_resistivity=params.get("bulk_resistivity", ed.bulk_resistivity),
                mean_free_path_nm=params.get("mean_free_path_nm", ed.mean_free_path_nm),
                specularity=params.get("specularity", ed.specularity),
            )
        result[material] = MaterialOverrides(optics=optics, electrical=electrical)
    return result


def _merged_dataset_overrides(
    datasets: Sequence[BenchmarkDataset],
) -> dict[str, MaterialOverrides]:
    merged: dict[str, MaterialOverrides] = {}
    for ds in datasets:
        merged = merge_overrides(merged, ds.simulation)
    return merged


def _loss(
    settings: Mapping[str, float],
    datasets: Sequence[BenchmarkDataset],
    record_ids: Collection[str] | None,
    constants: Sequence[CalibrationConstant],
    weights: Mapping[str, float],
    base_overrides: Mapping[str, MaterialOverrides],
) -> float:
    """加权 MSE 损失（跨数据集、按量）。"""
    base_resolver = MaterialResolver(base_overrides)
    built = build_overrides(constants, settings, base_resolver)
    resolver = MaterialResolver(merge_overrides(base_overrides, built))
    total = 0.0
    n = 0
    for ds in datasets:
        samples = collect_samples(ds, resolver, record_ids)
        for name, pairs in samples.items():
            w = weights.get(name, 1.0)
            errs = np.asarray([p - m for p, m in pairs], dtype=float)
            total += w * float(np.mean(errs**2))
            n += len(pairs)
    return total / max(n, 1)


def evaluate(
    datasets: Sequence[BenchmarkDataset],
    resolver: MaterialResolver,
    *,
    record_ids: Collection[str] | None = None,
    weights: Mapping[str, float] | None = None,
) -> dict[str, QuantityMetrics]:
    """在数据集（可限定记录子集）上评估误差，跨数据集聚合样本。"""
    samples: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for ds in datasets:
        for name, pairs in collect_samples(ds, resolver, record_ids).items():
            samples[name].extend(pairs)
    return {
        name: compute_metrics([p for p, _ in v], [m for _, m in v])
        for name, v in samples.items()
    }


def sensitivity_analysis(
    datasets: Sequence[BenchmarkDataset],
    constants: Sequence[CalibrationConstant],
    *,
    record_ids: Collection[str] | None = None,
    epsilon: float = 0.05,
    weights: Mapping[str, float] | None = None,
) -> dict[str, float]:
    """对每个常数做 ±ε 相对扰动，返回损失变化幅度（越大越敏感）。

    用于筛选校准对象：只拟合灵敏度最高的 1–3 个常数。
    """
    weights = weights or _LOSS_WEIGHTS
    base_overrides = _merged_dataset_overrides(datasets)
    base_resolver = MaterialResolver(base_overrides)
    x0 = {c.name: _initial_value(c, base_resolver) for c in constants}
    loss0 = _loss(x0, datasets, record_ids, constants, weights, base_overrides)

    sensitivity: dict[str, float] = {}
    for c in constants:
        v = x0[c.name]
        dv = max(epsilon * abs(v), 1e-12)
        lo, hi = c.bounds
        plus = _loss(
            {**x0, c.name: min(v + dv, hi)},
            datasets, record_ids, constants, weights, base_overrides,
        )
        minus = _loss(
            {**x0, c.name: max(v - dv, lo)},
            datasets, record_ids, constants, weights, base_overrides,
        )
        sensitivity[c.name] = abs(plus - minus) / max(abs(loss0), 1e-12)
    return sensitivity


def calibrate(
    datasets: Sequence[BenchmarkDataset],
    constants: Sequence[CalibrationConstant],
    *,
    train_record_ids: Collection[str] | None = None,
    val_record_ids: Collection[str] | None = None,
    weights: Mapping[str, float] | None = None,
    maxiter: int = 300,
) -> CalibrationResult:
    """灵敏度分析 + L-BFGS-B 拟合 + 训练/验证误差对比（留出法）。

    参数:
        datasets: 参与校准的数据集（合并其 simulation 覆盖作为基底）
        constants: 待拟合常数（建议先经 sensitivity_analysis 筛选 1–3 个）
        train_record_ids: 拟合用的记录子集；None = 全部记录
        val_record_ids: 留出验证记录子集（不参与拟合）
        weights: 各量损失权重（默认见模块文档字符串）
        maxiter: 优化迭代上限

    返回:
        CalibrationResult（拟合值 + 灵敏度 + 训练/验证的前后误差）

    异常:
        ValueError: 初始值超出边界、常数无对应材料模型等
    """
    weights = weights or _LOSS_WEIGHTS
    base_overrides = _merged_dataset_overrides(datasets)
    base_resolver = MaterialResolver(base_overrides)
    names = [c.name for c in constants]
    x0 = np.array([_initial_value(c, base_resolver) for c in constants], dtype=float)
    bounds = [c.bounds for c in constants]
    if np.any(x0 < [b[0] for b in bounds]) or np.any(x0 > [b[1] for b in bounds]):
        raise ValueError("常数初始值超出边界")

    sensitivity = sensitivity_analysis(
        datasets, constants, record_ids=train_record_ids, weights=weights
    )

    def loss(x: np.ndarray) -> float:
        return _loss(
            dict(zip(names, x, strict=True)),
            datasets,
            train_record_ids,
            constants,
            weights,
            base_overrides,
        )

    result = minimize(loss, x0, method="L-BFGS-B", bounds=bounds, options={"maxiter": maxiter})
    if not result.success:
        raise RuntimeError(f"校准优化失败：{result.message}")

    fitted = {c.name: float(v) for c, v in zip(constants, result.x, strict=True)}
    base_res = MaterialResolver(base_overrides)
    fitted_overrides = merge_overrides(
        base_overrides, build_overrides(constants, fitted, base_resolver)
    )
    fitted_res = MaterialResolver(fitted_overrides)

    return CalibrationResult(
        constants=tuple(constants),
        fitted=fitted,
        sensitivity=sensitivity,
        train_record_ids=tuple(sorted(train_record_ids or ())),
        val_record_ids=tuple(sorted(val_record_ids or ())),
        before_train=evaluate(datasets, base_res, record_ids=train_record_ids, weights=weights),
        after_train=evaluate(datasets, fitted_res, record_ids=train_record_ids, weights=weights),
        before_val=evaluate(datasets, base_res, record_ids=val_record_ids, weights=weights),
        after_val=evaluate(datasets, fitted_res, record_ids=val_record_ids, weights=weights),
    )


def default_ag_constants() -> list[CalibrationConstant]:
    """Ag 常用校准候选（电阻率、平均自由程、Drude 阻尼）。"""
    return [
        CalibrationConstant("Ag_bulk_resistivity", "Ag", "bulk_resistivity", (1.2e-8, 2.6e-8)),
        CalibrationConstant("Ag_mean_free_path_nm", "Ag", "mean_free_path_nm", (20.0, 150.0)),
        CalibrationConstant("Ag_damping_energy_ev", "Ag", "damping_energy_ev", (0.005, 0.2)),
    ]
