"""对标执行器：BenchmarkRecord → 引擎仿真结果（只计算声明的量）。"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from omo.benchmark.materials import MaterialResolver
from omo.benchmark.schema import BenchmarkRecord, SpectralPoint


@dataclass(frozen=True)
class SimulationResult:
    """一条记录的全量仿真结果（与 measured 点一一对应）。"""

    transmittance: tuple[SpectralPoint, ...] = ()
    reflectance: tuple[SpectralPoint, ...] = ()
    sheet_resistance: float | None = None
    se: tuple[SpectralPoint, ...] = ()
    se_x_band: float | None = None


def simulate_record(
    record: BenchmarkRecord,
    resolver: MaterialResolver,
    *,
    substrate_index: float = 1.5,
) -> SimulationResult:
    """对一条记录运行物理引擎，按 measured 声明的量分发到 optics/electrical/emi。

    参数:
        record: 数据集记录（stack + measured）
        resolver: 材料解析器（引擎默认 + 数据集覆盖）
        substrate_index: 光学衬底折射率（默认玻璃 1.5，与数据集 meta 对齐）

    返回:
        SimulationResult（各量仅在 measured 声明时计算）

    异常:
        ValueError: 声明的测量无法计算（未知材料、SE 但无可导电层等）
    """
    from omo.electrical import ConductiveLayer, sheet_resistance
    from omo.emi import ShieldingLayer, shielding_effectiveness
    from omo.optics import Layer, transfer_matrix

    measured = record.measured

    # ---- 光学 ----
    t_pts: list[SpectralPoint] = []
    r_pts: list[SpectralPoint] = []
    if measured.transmittance or measured.reflectance:
        wls = sorted({p.x for p in (*measured.transmittance, *measured.reflectance)})
        layers = [
            Layer(index=resolver.optics_index(layer.material), thickness_nm=layer.thickness_nm)
            for layer in record.stack
        ]
        spec = transfer_matrix(layers, np.array(wls, dtype=float), substrate_index=substrate_index)
        t_by_wl = dict(zip(wls, spec.transmittance, strict=True))
        r_by_wl = dict(zip(wls, spec.reflectance, strict=True))
        t_pts = [SpectralPoint(p.x, float(t_by_wl[p.x])) for p in measured.transmittance]
        r_pts = [SpectralPoint(p.x, float(r_by_wl[p.x])) for p in measured.reflectance]

    # ---- 电学（导电层构造，供 Rs 与 SE 共用）----
    conductive: list[ConductiveLayer] = []
    for layer in record.stack:
        ed = resolver.electrical(layer.material)
        if ed is not None:
            conductive.append(
                ConductiveLayer(
                    thickness_nm=layer.thickness_nm,
                    bulk_resistivity=ed.bulk_resistivity,
                    name=layer.material,
                    mean_free_path_nm=ed.mean_free_path_nm,
                    specularity=ed.specularity,
                )
            )

    rs: float | None = None
    if measured.sheet_resistance is not None:
        rs = sheet_resistance(conductive)

    # ---- 屏蔽 ----
    se_pts: list[SpectralPoint] = []
    se_x_band: float | None = None
    if measured.se or measured.se_x_band is not None:
        if not conductive:
            raise ValueError(
                f"记录 {record.id}: SE 测量需要至少一个导电层（当前 stack 均无电学模型）"
            )
        sh_layers = [ShieldingLayer.from_conductive_layer(c) for c in conductive]
        if measured.se:
            freqs = sorted({p.x for p in measured.se})
            se_spec = shielding_effectiveness(sh_layers, np.array(freqs))
            se_by_f = dict(zip(freqs, se_spec.se_db, strict=True))
            se_pts = [SpectralPoint(p.x, float(se_by_f[p.x])) for p in measured.se]
        if measured.se_x_band is not None:
            se_x = shielding_effectiveness(sh_layers, np.linspace(8.2, 12.4, 43))
            se_x_band = float(se_x.x_band_average())

    return SimulationResult(
        transmittance=tuple(t_pts),
        reflectance=tuple(r_pts),
        sheet_resistance=rs,
        se=tuple(se_pts),
        se_x_band=se_x_band,
    )
