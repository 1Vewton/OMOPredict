"""文献对标包（M2 框架已实现；真实文献数据集进行中）。

职责：
- 数据集加载与格式校验（schema.py）
- 材料解析与覆盖（materials.py）
- 对标执行（runner.py）、误差指标（metrics.py）、报告与图表（report.py）
- 模型常数校准（calibrate.py，M2.3）

物理模型与数据集格式见 docs/benchmarks/README.md。
"""

from __future__ import annotations

from omo.benchmark.materials import ElectricalDefaults, MaterialResolver
from omo.benchmark.metrics import QuantityMetrics, compute_metrics
from omo.benchmark.report import BenchmarkReport, RecordError, plot_report, run_benchmark
from omo.benchmark.runner import SimulationResult, simulate_record
from omo.benchmark.schema import (
    BenchmarkDataset,
    BenchmarkRecord,
    DatasetMeta,
    ElectricalOverride,
    ExtractionInfo,
    MaterialOverrides,
    Measurements,
    OpticsOverride,
    PaperMeta,
    SchemaError,
    SpectralPoint,
    StackLayer,
    SubstrateInfo,
    load_dataset,
    parse_dataset,
)

__all__ = [
    "BenchmarkDataset",
    "BenchmarkRecord",
    "BenchmarkReport",
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
    "compute_metrics",
    "load_dataset",
    "parse_dataset",
    "plot_report",
    "run_benchmark",
    "simulate_record",
]
