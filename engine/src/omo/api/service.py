"""仿真/反推编排：请求模型 → 引擎调用（只做翻译，不含物理逻辑）。"""

from __future__ import annotations

import numpy as np

from omo.api.schemas import (
    OptimizeRequest,
    SimulateRequest,
    SimulateResponse,
    SpectrumPoint,
)
from omo.electrical import ConductiveLayer, sheet_resistance
from omo.emi import ShieldingLayer, shielding_effectiveness
from omo.materials import MaterialResolver
from omo.optics import Layer, transfer_matrix
from omo.optimize import (
    DesignTarget,
    OmoSearchConfig,
    analyze_sensitivity,
    search_designs,
)

# 默认输出网格（与 omo.neural.SurrogateConfig 一致）
DEFAULT_WAVELENGTHS_NM = tuple(float(w) for w in np.arange(380.0, 1001.0, 10.0))
DEFAULT_FREQS_GHZ = tuple(float(f) for f in np.arange(1.0, 19.0, 1.0))


def run_simulation(req: SimulateRequest) -> SimulateResponse:
    """执行同步仿真：光学（TMM）+ 电学（方阻）+ 屏蔽（SE）。

    材料解析走共享注册表（omo.materials.MaterialResolver）；
    无导电层的 stack（如纯玻璃）返回 sheet_resistance=null、se_db=[]。

    参数:
        req: 仿真请求

    返回:
        SimulateResponse

    异常:
        ValueError: 未知材料、网格非正等（由 main.py 转为 422）
    """
    resolver = MaterialResolver()

    # ---- 光学（TMM，玻璃衬底）----
    wl = np.array(req.wavelengths_nm or DEFAULT_WAVELENGTHS_NM, dtype=float)
    if np.any(wl <= 0):
        raise ValueError("wavelengths_nm 必须全为正")
    layers = [
        Layer(index=resolver.optics_index(layer.material), thickness_nm=layer.thickness_nm)
        for layer in req.layers
    ]
    spec = transfer_matrix(layers, wl, substrate_index=req.substrate_index)

    # ---- 电学（并联方阻，含 Fuchs–Sondheimer 尺寸效应）----
    conductive: list[ConductiveLayer] = []
    for layer in req.layers:
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

    # ---- 屏蔽（传输线模型）----
    freqs = np.array(req.freqs_ghz or DEFAULT_FREQS_GHZ, dtype=float)
    if np.any(freqs <= 0):
        raise ValueError("freqs_ghz 必须全为正")
    se_db: list[SpectrumPoint] = []
    if conductive:
        se_spec = shielding_effectiveness(
            [ShieldingLayer.from_conductive_layer(c) for c in conductive], freqs
        )
        se_db = [
            SpectrumPoint(x=float(f), value=float(v))
            for f, v in zip(freqs, se_spec.se_db, strict=True)
        ]

    return SimulateResponse(
        transmittance=[
            SpectrumPoint(x=float(w), value=float(v))
            for w, v in zip(wl, spec.transmittance, strict=True)
        ],
        reflectance=[
            SpectrumPoint(x=float(w), value=float(v))
            for w, v in zip(wl, spec.reflectance, strict=True)
        ],
        sheet_resistance=float(sheet_resistance(conductive)) if conductive else None,
        se_db=se_db,
    )


def run_optimization(req: OptimizeRequest) -> dict:
    """执行目标反推（M5）：约束目标 → 网格扫描 → 候选 + 最佳候选灵敏度。

    只做请求模型的翻译：None 字段落到 omo.optimize 的默认值；
    物理逻辑全部在 omo.optimize（本函数不含任何公式）。

    参数:
        req: 反推请求（target/space 均可缺省）

    返回:
        报告 dict（OptimizeReport.to_dict() + 顶层 "sensitivity"）：
        n_scanned / n_feasible / elapsed_seconds / candidates / best_effort /
        sensitivity（compute_sensitivity=True 且存在可行候选时为
        SensitivityAnalysis.to_dict()，否则 None）

    异常:
        ValueError: 配置非法（范围/步长/未知材料/组合超限），由 main 转 422
    """
    # ---- 目标（缺省 = 无约束浏览扫描）----
    if req.target is None:
        target = DesignTarget()
    else:
        t = req.target
        target = DesignTarget(
            min_visible_transmittance=t.min_visible_transmittance,
            max_sheet_resistance=t.max_sheet_resistance,
            min_se_db=t.min_se_db,
            se_freq_range_ghz=(
                t.se_freq_range_ghz
                if t.se_freq_range_ghz is not None
                else DesignTarget().se_freq_range_ghz
            ),
        )

    # ---- 扫描空间（字段级缺省）----
    defaults = OmoSearchConfig()
    if req.space is None:
        config = defaults
    else:
        s = req.space
        config = OmoSearchConfig(
            outer_bounds_nm=(
                s.outer_bounds_nm
                if s.outer_bounds_nm is not None
                else defaults.outer_bounds_nm
            ),
            outer_step_nm=(
                s.outer_step_nm
                if s.outer_step_nm is not None
                else defaults.outer_step_nm
            ),
            metal_bounds_nm=(
                s.metal_bounds_nm
                if s.metal_bounds_nm is not None
                else defaults.metal_bounds_nm
            ),
            metal_step_nm=(
                s.metal_step_nm
                if s.metal_step_nm is not None
                else defaults.metal_step_nm
            ),
            outer_material=s.outer_material or defaults.outer_material,
            metal_material=s.metal_material or defaults.metal_material,
            substrate_index=(
                s.substrate_index if s.substrate_index is not None else defaults.substrate_index
            ),
            top_n=s.top_n if s.top_n is not None else defaults.top_n,
        )

    report = search_designs(target, config)
    out = report.to_dict()

    # ---- 最佳可行候选的灵敏度（可选）----
    out["sensitivity"] = None
    if req.compute_sensitivity and report.candidates:
        analysis = analyze_sensitivity(
            report.candidates[0],
            config.materials,
            target,
            substrate_index=config.substrate_index,
        )
        out["sensitivity"] = analysis.to_dict()
    return out
