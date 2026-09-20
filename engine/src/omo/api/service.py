"""HTTP 传输适配：pydantic 模型 ↔ omo.sim（本层不含任何物理逻辑）。

编排与领域校验已下沉到 `omo.sim`（中立层），本模块只做：
pydantic 请求模型 → sim 输入规格 → sim 结果 → pydantic 响应模型。
这样 Web（本模块 + FastAPI）与桌面（`omo.rpc` + stdio）共用同一套编排与校验语义。
"""

from __future__ import annotations

from omo.api.schemas import (
    OptimizeRequest,
    SimulateRequest,
    SimulateResponse,
    SpectrumPoint,
)
from omo.sim import (
    DEFAULT_FREQS_GHZ,  # 兼容旧引用（原定义于此）
    DEFAULT_WAVELENGTHS_NM,
    LayerSpec,
    OptimizeSpaceSpec,
    OptimizeSpec,
    OptimizeTargetSpec,
    SimulateSpec,
)
from omo.sim import optimize as _optimize
from omo.sim import simulate as _simulate

__all__ = [
    "DEFAULT_FREQS_GHZ",
    "DEFAULT_WAVELENGTHS_NM",
    "run_optimization",
    "run_simulation",
]


def run_simulation(req: SimulateRequest) -> SimulateResponse:
    """执行同步仿真（HTTP `POST /simulate`）。

    参数:
        req: pydantic 请求模型

    返回:
        SimulateResponse

    异常:
        ValueError: 领域校验失败（未知材料、空层、网格非正等），由 main.py 转 422
    """
    result = _simulate(
        SimulateSpec(
            layers=tuple(
                LayerSpec(material=layer.material, thickness_nm=layer.thickness_nm)
                for layer in req.layers
            ),
            substrate_index=req.substrate_index,
            wavelengths_nm=tuple(req.wavelengths_nm) if req.wavelengths_nm else None,
            freqs_ghz=tuple(req.freqs_ghz) if req.freqs_ghz else None,
        )
    )
    return SimulateResponse(
        transmittance=[SpectrumPoint(**point) for point in result.transmittance.to_points()],
        reflectance=[SpectrumPoint(**point) for point in result.reflectance.to_points()],
        sheet_resistance=result.sheet_resistance,
        se_db=[SpectrumPoint(**point) for point in result.se_db.to_points()],
    )


def run_optimization(req: OptimizeRequest) -> dict:
    """执行目标反推（HTTP `POST /optimize`）。

    参数:
        req: pydantic 反推请求

    返回:
        报告 dict（同 `omo.sim.optimize`）

    异常:
        ValueError: 配置非法（由 main.py 转 422）
    """
    target: OptimizeTargetSpec | None = None
    if req.target is not None:
        target = OptimizeTargetSpec(
            min_visible_transmittance=req.target.min_visible_transmittance,
            max_sheet_resistance=req.target.max_sheet_resistance,
            min_se_db=req.target.min_se_db,
            se_freq_range_ghz=(
                tuple(req.target.se_freq_range_ghz) if req.target.se_freq_range_ghz else None
            ),
        )

    space: OptimizeSpaceSpec | None = None
    if req.space is not None:
        space = OptimizeSpaceSpec(
            outer_bounds_nm=tuple(req.space.outer_bounds_nm) if req.space.outer_bounds_nm else None,
            outer_step_nm=req.space.outer_step_nm,
            metal_bounds_nm=tuple(req.space.metal_bounds_nm) if req.space.metal_bounds_nm else None,
            metal_step_nm=req.space.metal_step_nm,
            outer_material=req.space.outer_material,
            metal_material=req.space.metal_material,
            substrate_index=req.space.substrate_index,
            top_n=req.space.top_n,
        )

    return _optimize(
        OptimizeSpec(
            target=target,
            space=space,
            compute_sensitivity=req.compute_sensitivity,
        )
    )
