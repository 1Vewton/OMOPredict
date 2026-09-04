"""参数优化与工艺指导包（M5 · v1：OMO 三层目标反推已完成）。

模块：
- target.py       目标约束模型（硬约束：T_vis / Rs / SE，可选）
- evaluate.py     候选结构求值（复用物理引擎，与正向仿真自洽）
- search.py       厚度空间网格扫描寻优（可行候选按 FoM 排序 + best_effort）
- sensitivity.py  最佳候选的逐层灵敏度与工艺窗口分析

用法示例见 README.md；CLI：`omo-cli optimize --help`。
"""

from __future__ import annotations

from omo.optimize.evaluate import CandidateMetrics, evaluate_candidate
from omo.optimize.search import OmoSearchConfig, OptimizeReport, search_designs
from omo.optimize.sensitivity import (
    LayerSensitivity,
    SensitivityAnalysis,
    analyze_sensitivity,
)
from omo.optimize.target import DesignTarget

__all__ = [
    "CandidateMetrics",
    "DesignTarget",
    "LayerSensitivity",
    "OmoSearchConfig",
    "OptimizeReport",
    "SensitivityAnalysis",
    "analyze_sensitivity",
    "evaluate_candidate",
    "search_designs",
]
