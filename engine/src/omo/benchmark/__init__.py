"""文献对标包（M2 框架 + 校准已完成；数据集可继续扩充）。

职责：
- 数据集加载与格式校验（schema.py）
- 材料解析与覆盖（materials.py）
- 对标执行（runner.py）、误差指标（metrics.py）、报告与图表（report.py）
- 模型常数校准（calibrate.py）：灵敏度分析 → 拟合 → 留出法验证

物理模型与数据集格式见 docs/benchmarks/README.md。
"""

from __future__ import annotations

from omo.benchmark.calibrate import (
    CalibrationConstant,
    CalibrationResult,
    build_overrides,
    calibrate,
    default_ag_constants,
    evaluate,
    merge_overrides,
    sensitivity_analysis,
)
from omo.benchmark.metrics import QuantityMetrics, compute_metrics
from omo.benchmark.report import (
    BenchmarkReport,
    RecordError,
    collect_samples,
    plot_report,
    run_benchmark,
)
from omo.benchmark.runner import SimulationResult, simulate_record
from omo.benchmark.schema import (
    BenchmarkDataset,
    BenchmarkRecord,
    DatasetMeta,
    ExtractionInfo,
    Measurements,
    PaperMeta,
    SchemaError,
    SpectralPoint,
    StackLayer,
    SubstrateInfo,
    load_dataset,
    parse_dataset,
)
from omo.materials import ElectricalDefaults, MaterialResolver

__all__ = [
    "BenchmarkDataset",
    "BenchmarkRecord",
    "BenchmarkReport",
    "CalibrationConstant",
    "CalibrationResult",
    "DatasetMeta",
    "ElectricalDefaults",
    "ElectricalOverride",
    "ExtractionInfo",
    "MaterialOverrides",
    "MaterialResolver",
    "Measurements",
    "OpticsOverride",
    "PaperMeta",
    "QuantityMetrics",
    "RecordError",
    "SchemaError",
    "SimulationResult",
    "SpectralPoint",
    "StackLayer",
    "SubstrateInfo",
    "build_overrides",
    "calibrate",
    "collect_samples",
    "compute_metrics",
    "default_ag_constants",
    "evaluate",
    "load_dataset",
    "merge_overrides",
    "parse_dataset",
    "plot_report",
    "run_benchmark",
    "sensitivity_analysis",
    "simulate_record",
]
