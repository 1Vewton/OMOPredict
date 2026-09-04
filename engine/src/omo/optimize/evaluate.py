"""候选结构求值（M5 · 目标反推）。

对给定（三层 OMO）膜厚组合运行完整物理引擎，产出统一指标供
扫描寻优与灵敏度分析使用。求值路径与 omo.api.service / omo.neural.data
同源（同一材料注册表 + TMM/并联方阻/传输线屏蔽），保证"反推结果
与正向仿真自洽"——反推器不引入任何第二套物理。

输出网格默认值与 omo.api.service.DEFAULT_* 及 omo.neural.SurrogateConfig
保持一致（380–1000 nm 步长 10、1–18 GHz 步长 1）；改动需三处同步。
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from omo.electrical import ConductiveLayer, sheet_resistance
from omo.emi import ShieldingLayer, shielding_effectiveness
from omo.materials import MaterialResolver
from omo.optics import Layer, transfer_matrix

# 可见光区间（nm）：T_vis 与 Haacke FoM 的定义区间
VISIBLE_RANGE_NM: tuple[float, float] = (400.0, 800.0)

# 光学/屏蔽输出默认网格（与 api.service / neural.data 同步）
DEFAULT_WAVELENGTHS_NM = tuple(float(w) for w in np.arange(380.0, 1001.0, 10.0))
DEFAULT_FREQS_GHZ = tuple(float(f) for f in np.arange(1.0, 19.0, 1.0))


@dataclass(frozen=True)
class CandidateMetrics:
    """单个候选结构的性能指标。

    属性:
        thicknesses_nm: (入射侧外层, 金属层, 出射侧外层) 三层厚度（nm）
        visible_transmittance: 可见光(400–800 nm)平均透过率（0–1）
        sheet_resistance: 并联方阻（Ω/sq，含 Fuchs–Sondheimer 尺寸效应）；无导电层时 None
        se_min_db: 目标频带内最小屏蔽效能（dB）；未求值或无导电层时 None
        se_band_ghz: 实际求值用的 SE 频带；未求值时 None

    说明:
        fom 为属性（Haacke FoM = T_vis¹⁰/Rs，见 target.py 文献来源）；
        Rs 为 None（无导电通路）时 FoM 无定义，返回 None。
    """

    thicknesses_nm: tuple[float, float, float]
    visible_transmittance: float
    sheet_resistance: float | None
    se_min_db: float | None = None
    se_band_ghz: tuple[float, float] | None = None

    @property
    def fom(self) -> float | None:
        """Haacke 品质因子 FoM = T_vis¹⁰ / Rs；Rs 无定义时为 None。"""
        if self.sheet_resistance is None or self.sheet_resistance <= 0:
            return None
        return self.visible_transmittance**10 / self.sheet_resistance


def evaluate_candidate(
    thicknesses_nm: Sequence[float],
    materials: Sequence[str],
    substrate_index: float = 1.5,
    wavelengths_nm: Sequence[float] | None = None,
    freqs_ghz: Sequence[float] | None = None,
    se_band_ghz: tuple[float, float] | None = None,
) -> CandidateMetrics:
    """求值一个三层膜结构（入射侧外层 / 金属层 / 出射侧外层）。

    参数:
        thicknesses_nm: 三层厚度（nm，各 ≥ 0）
        materials: 三层材料名（须收录于 omo.materials 注册表，长度与厚度一致）
        substrate_index: 衬底折射率（默认 1.5 玻璃）
        wavelengths_nm: 光学输出网格（缺省 380–1000 nm 步长 10）
        freqs_ghz: 屏蔽输出网格（缺省 1–18 GHz 步长 1）
        se_band_ghz: 需要 SE 指标时给出评估频带 (低, 高) GHz；
            None 则跳过屏蔽求值（se_min_db 为 None，扫描更快）

    返回:
        CandidateMetrics

    异常:
        ValueError: 输入长度不一致 / 厚度为负 / 未知材料 / 频带不在网格内
    """
    ts = tuple(float(t) for t in thicknesses_nm)
    ms = tuple(str(m) for m in materials)
    if len(ts) != 3 or len(ms) != 3:
        raise ValueError(f"三层体系要求厚度与材料各 3 项，收到 {len(ts)}/{len(ms)}")
    if any(t < 0 for t in ts):
        raise ValueError(f"厚度必须 ≥ 0，收到 {ts}")
    if substrate_index <= 0:
        raise ValueError(f"substrate_index 需 > 0，收到 {substrate_index}")

    wl = np.array(
        list(wavelengths_nm) if wavelengths_nm is not None else DEFAULT_WAVELENGTHS_NM,
        dtype=float,
    )
    freqs = np.array(
        list(freqs_ghz) if freqs_ghz is not None else DEFAULT_FREQS_GHZ, dtype=float
    )

    resolver = MaterialResolver()

    # ---- 光学：TMM（玻璃衬底）→ 可见光平均透过率 ----
    spec = transfer_matrix(
        [
            Layer(index=resolver.optics_index(m), thickness_nm=t)
            for t, m in zip(ts, ms, strict=True)
        ],
        wl,
        substrate_index=substrate_index,
    )
    lo_v, hi_v = VISIBLE_RANGE_NM
    t_vis = spec.visible_average_transmittance(lo_v, hi_v)

    # ---- 电学：并联方阻（仅统计注册表中有电学模型的层）----
    conductive: list[ConductiveLayer] = []
    for t, m in zip(ts, ms, strict=True):
        ed = resolver.electrical(m)
        if ed is None:
            continue
        conductive.append(
            ConductiveLayer(
                thickness_nm=t,
                bulk_resistivity=ed.bulk_resistivity,
                name=m,
                mean_free_path_nm=ed.mean_free_path_nm,
                specularity=ed.specularity,
            )
        )
    rs = sheet_resistance(conductive) if conductive else None

    # ---- 屏蔽：传输线模型（可选）----
    se_min: float | None = None
    band: tuple[float, float] | None = None
    if se_band_ghz is not None and conductive:
        lo_f, hi_f = se_band_ghz
        if not (0.0 <= lo_f < hi_f):
            raise ValueError(f"se_band_ghz 需满足 0 ≤ lo < hi，收到 {se_band_ghz}")
        se_spec = shielding_effectiveness(
            [ShieldingLayer.from_conductive_layer(c) for c in conductive], freqs
        )
        mask = (se_spec.freqs_ghz >= lo_f) & (se_spec.freqs_ghz <= hi_f)
        if not np.any(mask):
            raise ValueError(
                f"频率网格 {freqs.tolist()} 不覆盖频带 {se_band_ghz} GHz"
            )
        se_min = float(np.min(se_spec.se_db[mask]))
        band = (lo_f, hi_f)

    return CandidateMetrics(
        thicknesses_nm=ts,
        visible_transmittance=float(t_vis),
        sheet_resistance=rs,
        se_min_db=se_min,
        se_band_ghz=band,
    )
