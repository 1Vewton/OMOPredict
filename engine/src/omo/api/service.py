"""仿真编排：SimulateRequest → 引擎调用（只做翻译，不含物理逻辑）。"""

from __future__ import annotations

import numpy as np

from omo.api.schemas import SimulateRequest, SimulateResponse, SpectrumPoint
from omo.electrical import ConductiveLayer, sheet_resistance
from omo.emi import ShieldingLayer, shielding_effectiveness
from omo.materials import MaterialResolver
from omo.optics import Layer, transfer_matrix

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
