"""OMO 三层厚度空间网格扫描寻优（M5 · 目标反推）。

方法：在（入射侧外层, 金属层, 出射侧外层）三维厚度网格上逐一调用
物理引擎求值；满足目标约束的组合构成"可行解集"，按 Haacke 品质因子
FoM（见 target.py 文献来源）降序取前 top_n 返回；另附全体中 FoM 最高
的 best_effort（可能不满足约束），供"无可行解"时参考最接近的方案。

说明：
- 纯网格扫描（确定性、可复现），默认网格规模 ~4k 组合，进程内秒级完成；
- 反推结果以物理引擎为唯一基准（自洽性由测试回灌验证），不依赖 NN 代理；
- M2.5 NN 代理可在后续作为加速后端替换求值器，接口不变。
"""

from __future__ import annotations

import itertools
import time
from dataclasses import dataclass

import numpy as np

from omo.optimize.evaluate import CandidateMetrics, evaluate_candidate
from omo.optimize.target import DesignTarget

# 反推管线版本（网格/求值语义变更时递增，报告随附可追溯）
PIPELINE_VERSION = "omo.optimize.search-v1"


@dataclass(frozen=True)
class OmoSearchConfig:
    """OMO 三层厚度扫描空间（默认与 NN 代理训练域一致：外层 20–80、金属 5–20 nm）。

    参数:
        outer_bounds_nm: 外层（入射侧/出射侧）厚度范围 (min, max) nm
        outer_step_nm: 外层网格步长（nm，> 0）
        metal_bounds_nm: 金属层厚度范围 (min, max) nm
        metal_step_nm: 金属层网格步长（nm，> 0）
        outer_material: 外层材料名（默认 ITO，须在 omo.materials 注册表）
        metal_material: 金属层材料名（默认 Ag）
        substrate_index: 衬底折射率（默认 1.5 玻璃）
        top_n: 返回的可行候选数量上限
    """

    outer_bounds_nm: tuple[float, float] = (20.0, 80.0)
    outer_step_nm: float = 4.0
    metal_bounds_nm: tuple[float, float] = (5.0, 20.0)
    metal_step_nm: float = 1.0
    outer_material: str = "ITO"
    metal_material: str = "Ag"
    substrate_index: float = 1.5
    top_n: int = 10

    def __post_init__(self) -> None:
        lo_o, hi_o = self.outer_bounds_nm
        lo_m, hi_m = self.metal_bounds_nm
        if not (lo_o < hi_o):
            raise ValueError(f"outer_bounds_nm 需满足 lo < hi，收到 {(lo_o, hi_o)}")
        if not (lo_m < hi_m):
            raise ValueError(f"metal_bounds_nm 需满足 lo < hi，收到 {(lo_m, hi_m)}")
        if self.outer_step_nm <= 0 or self.metal_step_nm <= 0:
            raise ValueError("网格步长必须 > 0")
        if self.substrate_index <= 0:
            raise ValueError(f"substrate_index 需 > 0，收到 {self.substrate_index}")
        if self.top_n <= 0:
            raise ValueError(f"top_n 需 > 0，收到 {self.top_n}")
        n = self.n_combinations
        if n > 2_000_000:
            raise ValueError(f"网格组合数 {n} 过大（> 2e6），请缩小范围/加大步长")

    @property
    def materials(self) -> tuple[str, str, str]:
        """三层材料：(入射侧外层, 金属层, 出射侧外层)。"""
        return (self.outer_material, self.metal_material, self.outer_material)

    @property
    def n_combinations(self) -> int:
        """网格组合总数。"""
        return len(self.grids()[0]) * len(self.grids()[1]) * len(self.grids()[2])

    def grids(self) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """三层厚度网格数组（外层/金属/外层）。"""
        lo_o, hi_o = self.outer_bounds_nm
        lo_m, hi_m = self.metal_bounds_nm
        g_outer = _arange(lo_o, hi_o, self.outer_step_nm)
        g_metal = _arange(lo_m, hi_m, self.metal_step_nm)
        return (g_outer, g_metal, g_outer)


def _arange(lo: float, hi: float, step: float) -> np.ndarray:
    """含端点的等差数列（修整浮点噪声，端点包含用 half-step 容差）。"""
    return np.round(np.arange(lo, hi + step / 2.0, step), 6)


@dataclass(frozen=True)
class OptimizeReport:
    """目标反推报告。

    属性:
        target: 本次目标
        config: 本次扫描配置
        n_scanned: 求值组合总数
        n_feasible: 满足全部约束的可行组合数
        candidates: 可行解按 FoM 降序取前 top_n（元组；无可行解时为空）
        best_effort: 全体中 FoM 最高的候选（可能不满足约束），None 表示无可排名候选
        elapsed_seconds: 扫描用时
        pipeline_version: 反推管线版本
    """

    target: DesignTarget
    config: OmoSearchConfig
    n_scanned: int
    n_feasible: int
    candidates: tuple[CandidateMetrics, ...]
    best_effort: CandidateMetrics | None
    elapsed_seconds: float
    pipeline_version: str = PIPELINE_VERSION

    def to_dict(self) -> dict:
        """报告序列化为可 JSON 化的 dict。"""
        return {
            "pipeline_version": self.pipeline_version,
            "target": {
                "min_visible_transmittance": self.target.min_visible_transmittance,
                "max_sheet_resistance": self.target.max_sheet_resistance,
                "min_se_db": self.target.min_se_db,
                "se_freq_range_ghz": list(self.target.se_freq_range_ghz),
            },
            "config": {
                "outer_bounds_nm": list(self.config.outer_bounds_nm),
                "outer_step_nm": self.config.outer_step_nm,
                "metal_bounds_nm": list(self.config.metal_bounds_nm),
                "metal_step_nm": self.config.metal_step_nm,
                "materials": list(self.config.materials),
                "substrate_index": self.config.substrate_index,
                "top_n": self.config.top_n,
            },
            "n_scanned": self.n_scanned,
            "n_feasible": self.n_feasible,
            "elapsed_seconds": round(self.elapsed_seconds, 3),
            "candidates": [_metric_to_dict(c) for c in self.candidates],
            "best_effort": (
                _metric_to_dict(self.best_effort) if self.best_effort is not None else None
            ),
        }


def _metric_to_dict(m: CandidateMetrics) -> dict:
    """候选指标 → dict（厚度与全部指标，含排序键 fom）。"""
    return {
        "thicknesses_nm": list(m.thicknesses_nm),
        "visible_transmittance": round(m.visible_transmittance, 6),
        "sheet_resistance": m.sheet_resistance,
        "se_min_db": m.se_min_db,
        "se_band_ghz": list(m.se_band_ghz) if m.se_band_ghz is not None else None,
        "fom": m.fom,
    }


def _rank_key(m: CandidateMetrics) -> tuple[float, float, float, float]:
    """排序键：FoM 降序（None 视为 -inf），同分按厚度升序保证确定性。"""
    fom = m.fom if m.fom is not None else float("-inf")
    return (-fom, *m.thicknesses_nm)


def search_designs(
    target: DesignTarget | None = None,
    config: OmoSearchConfig | None = None,
    progress_callback=None,
) -> OptimizeReport:
    """网格扫描寻优：给定目标 → 可行候选（按 FoM 排序）+ best_effort。

    参数:
        target: 性能目标；None 用空目标（无约束，按 FoM 排序的浏览扫描）
        config: 扫描空间配置；None 用默认（外层 20–80 步长 4、金属 5–20 步长 1）
        progress_callback: 可选回调（已求值数, 总数），供进度显示；返回 None

    返回:
        OptimizeReport

    异常:
        ValueError: 配置非法（范围/步长/组合上限，见 OmoSearchConfig）
    """
    target = target or DesignTarget()
    config = config or OmoSearchConfig()
    materials = config.materials
    g_outer, g_metal, g_outer2 = config.grids()

    # SE 仅当目标需要时才求值（显著提速；无 SE 约束的扫描不跑屏蔽模型）
    se_band = target.se_freq_range_ghz if target.min_se_db is not None else None

    n_total = config.n_combinations
    evaluated: list[CandidateMetrics] = []
    feasible: list[CandidateMetrics] = []

    t0 = time.perf_counter()
    for i, (t1, t2, t3) in enumerate(
        itertools.product(g_outer, g_metal, g_outer2), start=1
    ):
        metrics = evaluate_candidate(
            (float(t1), float(t2), float(t3)),
            materials,
            substrate_index=config.substrate_index,
            se_band_ghz=se_band,
        )
        evaluated.append(metrics)
        if target.is_satisfied_by(metrics):
            feasible.append(metrics)
        if progress_callback is not None and (i % 500 == 0 or i == n_total):
            progress_callback(i, n_total)
    elapsed = time.perf_counter() - t0

    evaluated.sort(key=_rank_key)
    feasible.sort(key=_rank_key)
    best_effort = evaluated[0] if evaluated and evaluated[0].fom is not None else None

    return OptimizeReport(
        target=target,
        config=config,
        n_scanned=n_total,
        n_feasible=len(feasible),
        candidates=tuple(feasible[: config.top_n]),
        best_effort=best_effort,
        elapsed_seconds=elapsed,
    )
