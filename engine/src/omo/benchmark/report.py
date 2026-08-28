"""对标报告：按量聚合误差 + 记录明细 + JSON/图表输出。"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from collections.abc import Collection
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")  # 无显示环境（CI/服务端）headless 出图

import numpy as np

from omo.benchmark.metrics import QuantityMetrics, compute_metrics
from omo.benchmark.runner import simulate_record
from omo.benchmark.schema import BenchmarkDataset
from omo.materials import MaterialResolver

# 报告面板顺序（plot 用）
_QUANTITY_ORDER = (
    "transmittance",
    "reflectance",
    "sheet_resistance_log10",
    "se",
    "se_x_band",
)


@dataclass(frozen=True)
class RecordError:
    """单条记录的对标误差（按量，平均绝对误差）。"""

    record_id: str
    errors: dict[str, float]


@dataclass(frozen=True)
class BenchmarkReport:
    """整份数据集的对标报告。"""

    dataset_id: str
    paper_title: str
    quantities: dict[str, QuantityMetrics]
    records: tuple[RecordError, ...]
    samples: dict[str, tuple[list[float], list[float]]] = field(default_factory=dict)
    source: str = ""

    def to_dict(self) -> dict[str, Any]:
        """序列化为可 JSON 化的字典（不含原始样本点）。"""
        return {
            "dataset_id": self.dataset_id,
            "paper_title": self.paper_title,
            "source": self.source,
            "quantities": {k: v.to_dict() for k, v in self.quantities.items()},
            "records": [{"record_id": r.record_id, "errors": r.errors} for r in self.records],
        }

    def save_json(self, path: str | Path) -> None:
        """将报告写入 JSON 文件（UTF-8）。"""
        Path(path).write_text(
            json.dumps(self.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def plot(self, path: str | Path) -> None:
        """生成实测 vs 仿真散点图（按量分面板，PNG）。"""
        plot_report(self, path)


def collect_samples(
    dataset: BenchmarkDataset,
    resolver: MaterialResolver,
    record_ids: Collection[str] | None = None,
    *,
    substrate_index: float | None = None,
) -> dict[str, list[tuple[float, float]]]:
    """收集 (仿真, 实测) 样本对（按量），可限定记录子集。

    方阻在 log₁₀ 空间；透过率/反射率/SE 用绝对值（与 run_benchmark 一致）。
    供 run_benchmark 与 calibrate.py 复用。
    """
    if substrate_index is None:
        substrate_index = dataset.meta.substrate.index
    samples: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for rec in dataset.records:
        if record_ids is not None and rec.id not in record_ids:
            continue
        sim = simulate_record(rec, resolver, substrate_index=substrate_index)
        if rec.measured.transmittance:
            samples["transmittance"].extend(
                (s.value, m.value)
                for s, m in zip(sim.transmittance, rec.measured.transmittance, strict=True)
            )
        if rec.measured.reflectance:
            samples["reflectance"].extend(
                (s.value, m.value)
                for s, m in zip(sim.reflectance, rec.measured.reflectance, strict=True)
            )
        if rec.measured.sheet_resistance is not None and sim.sheet_resistance is not None:
            samples["sheet_resistance_log10"].append(
                (math.log10(sim.sheet_resistance), math.log10(rec.measured.sheet_resistance))
            )
        if rec.measured.se:
            samples["se"].extend(
                (s.value, m.value) for s, m in zip(sim.se, rec.measured.se, strict=True)
            )
        if rec.measured.se_x_band is not None and sim.se_x_band is not None:
            samples["se_x_band"].append((sim.se_x_band, rec.measured.se_x_band))
    return samples


def run_benchmark(
    dataset: BenchmarkDataset,
    *,
    substrate_index: float | None = None,
    resolver: MaterialResolver | None = None,
    record_ids: Collection[str] | None = None,
) -> BenchmarkReport:
    """运行整份数据集的对标：逐记录仿真 → 按量聚合误差。

    方阻在 log₁₀ 空间评估（跨数量级）；透过率/反射率/SE 用绝对值。

    参数:
        dataset: 已加载的数据集
        substrate_index: 光学衬底折射率；None 时取数据集 meta.substrate.index
        resolver: 材料解析器（默认按 dataset.simulation 构造）
        record_ids: 仅对标这些记录（校准的留出法验证用）；None = 全部

    返回:
        BenchmarkReport（quantities 为各量聚合指标，records 为逐记录明细）
    """
    resolver = resolver or MaterialResolver(dataset.simulation)
    if substrate_index is None:
        substrate_index = dataset.meta.substrate.index

    samples = collect_samples(dataset, resolver, record_ids, substrate_index=substrate_index)
    record_errors: list[RecordError] = []
    for rec in dataset.records:
        if record_ids is not None and rec.id not in record_ids:
            continue
        per_record = collect_samples(
            dataset, resolver, {rec.id}, substrate_index=substrate_index
        )
        errs = {name: _mean_abs_error(pairs) for name, pairs in per_record.items()}
        record_errors.append(RecordError(record_id=rec.id, errors=errs))

    quantities = {
        name: compute_metrics([p for p, _ in pairs], [m for _, m in pairs])
        for name, pairs in samples.items()
    }
    return BenchmarkReport(
        dataset_id=dataset.meta.id,
        paper_title=dataset.meta.paper.title,
        quantities=quantities,
        records=tuple(record_errors),
        samples={name: ([p for p, _ in v], [m for _, m in v]) for name, v in samples.items()},
    )


def plot_report(report: BenchmarkReport, path: str | Path) -> None:
    """实测 vs 仿真散点图（每量一面板 + y=x 参考线），PNG 输出。

    异常:
        ValueError: 报告没有可绘制的样本
    """
    import matplotlib.pyplot as plt

    names = [n for n in _QUANTITY_ORDER if n in report.quantities]
    if not names or not report.samples:
        raise ValueError("报告没有可绘制的样本数据")
    fig, axes = plt.subplots(1, len(names), figsize=(4.5 * len(names), 4.2))
    if len(names) == 1:
        axes = [axes]

    for ax, name in zip(axes, names, strict=True):
        pred, meas = report.samples[name]
        ax.scatter(meas, pred, s=18, alpha=0.7)
        lo = min(min(meas), min(pred))
        hi = max(max(meas), max(pred))
        pad = (hi - lo) * 0.05 if hi > lo else 1.0
        ax.plot([lo - pad, hi + pad], [lo - pad, hi + pad], "k--", lw=1, label="y=x")
        ax.set_xlabel("measured")
        ax.set_ylabel("simulated")
        ax.set_title(name)
        ax.legend(loc="upper left", fontsize=8)
        q = report.quantities[name]
        ax.text(
            0.03,
            0.95,
            f"MAE={q.mae:.3g}\nRMSE={q.rmse:.3g}",
            transform=ax.transAxes,
            va="top",
            fontsize=9,
        )
    fig.suptitle(f"{report.dataset_id} — {report.paper_title}", fontsize=11)
    fig.tight_layout(rect=[0, 0, 1, 0.94])
    fig.savefig(Path(path), dpi=150)
    plt.close(fig)


def _mean_abs_error(pairs: list[tuple[float, float]]) -> float:
    return float(np.mean([abs(p - m) for p, m in pairs]))
