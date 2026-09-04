"""目标约束模型（M5 · 目标反推）。

"指定目标 → 反推结构"的第一步：把用户目标表达为硬约束（硬不等式）。
约束均为可选，语义为"AND"：
- min_visible_transmittance：可见光(400–800 nm)平均透过率下限（0–1）；
- max_sheet_resistance：方阻上限（Ω/sq）；
- min_se_db：指定频带内最差（最小）屏蔽效能下限（dB）。
至少给出一个约束时，扫描只保留全部满足的候选（可行解）；
一个约束都不给时退化为"按品质因子排序"的浏览扫描。

候选排序指标（Haacke 品质因子，文献来源）：
    FoM = T_vis¹⁰ / Rs
    G. Haacke, "New figure of merit for transparent conductors",
    J. Appl. Phys. 47, 4086 (1976).  https://doi.org/10.1063/1.322306
其中 T_vis 为可见光平均透过率（0–1），Rs 为方阻（Ω/sq）。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # 仅类型标注，避免运行期环依赖
    from omo.optimize.evaluate import CandidateMetrics


@dataclass(frozen=True)
class DesignTarget:
    """性能目标：硬约束集合 + SE 评估频带。

    参数:
        min_visible_transmittance: 可见光平均透过率下限（0–1，含），None 表示不限
        max_sheet_resistance: 方阻上限（Ω/sq，> 0），None 表示不限
        min_se_db: 频带内最小 SE 下限（dB），None 表示不限
        se_freq_range_ghz: SE 评估频带 (低, 高)（GHz），默认 X 波段 8.2–12.4

    异常:
        ValueError: 任一约束取值越界或频带非法
    """

    min_visible_transmittance: float | None = None
    max_sheet_resistance: float | None = None
    min_se_db: float | None = None
    se_freq_range_ghz: tuple[float, float] = (8.2, 12.4)

    def __post_init__(self) -> None:
        t = self.min_visible_transmittance
        if t is not None and not 0.0 < t <= 1.0:
            raise ValueError(f"min_visible_transmittance 需在 (0, 1] 内，收到 {t}")
        rs = self.max_sheet_resistance
        if rs is not None and rs <= 0:
            raise ValueError(f"max_sheet_resistance 需 > 0，收到 {rs}")
        se = self.min_se_db
        if se is not None and se <= 0:
            raise ValueError(f"min_se_db 需 > 0（dB），收到 {se}")
        lo, hi = self.se_freq_range_ghz
        if not (lo >= 0.0 and lo < hi):
            raise ValueError(f"se_freq_range_ghz 需满足 0 ≤ lo < hi，收到 {(lo, hi)}")

    @property
    def has_constraints(self) -> bool:
        """是否至少有一个约束（False = 纯排序浏览扫描）。"""
        return (
            self.min_visible_transmittance is not None
            or self.max_sheet_resistance is not None
            or self.min_se_db is not None
        )

    def is_satisfied_by(self, metrics: CandidateMetrics) -> bool:
        """候选指标是否满足全部约束（AND 语义）。

        参数:
            metrics: 候选求值指标（omo.optimize.evaluate.CandidateMetrics）

        返回:
            True 表示可行候选；Rs/SE 未求值（None）时对应约束视为不满足
        """
        if (
            self.min_visible_transmittance is not None
            and metrics.visible_transmittance < self.min_visible_transmittance
        ):
            return False
        if (
            self.max_sheet_resistance is not None
            and (
                metrics.sheet_resistance is None
                or metrics.sheet_resistance > self.max_sheet_resistance
            )
        ):
            return False
        if (
            self.min_se_db is not None
            and (metrics.se_min_db is None or metrics.se_min_db < self.min_se_db)
        ):
            return False
        return True

    def describe(self) -> list[str]:
        """人类可读约束描述（CLI/报告展示用）。"""
        items: list[str] = []
        if self.min_visible_transmittance is not None:
            items.append(f"可见光平均透过率 ≥ {self.min_visible_transmittance:.0%}")
        if self.max_sheet_resistance is not None:
            items.append(f"方阻 ≤ {self.max_sheet_resistance:g} Ω/sq")
        if self.min_se_db is not None:
            lo, hi = self.se_freq_range_ghz
            items.append(f"{lo:g}–{hi:g} GHz 最小 SE ≥ {self.min_se_db:g} dB")
        return items
