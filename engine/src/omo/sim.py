"""仿真/反推编排（中立层）：只依赖物理子包与 numpy，不含任何 Web/框架依赖。

分层约定（docs/desktop.md D4）：

- **本模块 + 物理子包**（optics / electrical / emi / optimize / materials）＝ 引擎核心，
  Web 与桌面两种形态共用；
- `omo.api`（FastAPI + pydantic）与 `omo.rpc`（stdio JSON-RPC）都只是**传输适配层**：
  把线格式翻译成本模块的输入，再把结果翻译回线格式；
- **校验分工**：本模块做**领域校验**（层数、材料、厚度、网格、组合上限等），
  传输层做**形状/类型校验**。两种传输对同一非法输入都返回 **422**（HTTP）/ `code=422`（RPC）。

线格式（`SimulationResult.to_dict()`）与 HTTP `POST /simulate` 响应、
RPC `simulate` 结果**逐字段一致**，便于契约测试互相验证。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

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
from omo.optimize.evaluate import DEFAULT_FREQS_GHZ, DEFAULT_WAVELENGTHS_NM

__all__ = [
    "DEFAULT_FREQS_GHZ",
    "DEFAULT_WAVELENGTHS_NM",
    "LayerSpec",
    "OptimizeSpaceSpec",
    "OptimizeSpec",
    "OptimizeTargetSpec",
    "Series",
    "SimulateSpec",
    "SimulationResult",
    "optimize",
    "simulate",
]


# ---------------------------------------------------------------- 输入规格


@dataclass(frozen=True)
class LayerSpec:
    """一层膜（材料名 + 厚度 nm）。"""

    material: str
    thickness_nm: float


@dataclass(frozen=True)
class SimulateSpec:
    """正向仿真输入。

    参数:
        layers: 膜层（入射侧 → 出射侧），至少一层
        substrate_index: 出射衬底折射率（默认 1.5 玻璃）
        wavelengths_nm: 光学输出网格（缺省 380–1000 nm 步长 10）
        freqs_ghz: 屏蔽输出网格（缺省 1–18 GHz 步长 1）
    """

    layers: tuple[LayerSpec, ...]
    substrate_index: float = 1.5
    wavelengths_nm: tuple[float, ...] | None = None
    freqs_ghz: tuple[float, ...] | None = None


@dataclass(frozen=True)
class OptimizeTargetSpec:
    """目标反推的硬约束（均可缺省，缺省 = 不限）。"""

    min_visible_transmittance: float | None = None
    max_sheet_resistance: float | None = None
    min_se_db: float | None = None
    se_freq_range_ghz: tuple[float, float] | None = None


@dataclass(frozen=True)
class OptimizeSpaceSpec:
    """目标反推的扫描空间（字段级缺省 = 引擎默认）。"""

    outer_bounds_nm: tuple[float, float] | None = None
    outer_step_nm: float | None = None
    metal_bounds_nm: tuple[float, float] | None = None
    metal_step_nm: float | None = None
    outer_material: str | None = None
    metal_material: str | None = None
    substrate_index: float | None = None
    top_n: int | None = None


@dataclass(frozen=True)
class OptimizeSpec:
    """目标反推输入。"""

    target: OptimizeTargetSpec | None = None
    space: OptimizeSpaceSpec | None = None
    compute_sensitivity: bool = True


# ---------------------------------------------------------------- 输出结果


@dataclass(frozen=True)
class Series:
    """x/value 序列（x 为波长 nm 或频率 GHz，由所属字段决定）。"""

    x: tuple[float, ...]
    value: tuple[float, ...]

    def to_points(self) -> list[dict[str, float]]:
        """转为线格式点列表（与 REST 的 SpectrumPoint 结构一致）。"""
        return [
            {"x": float(x), "value": float(v)}
            for x, v in zip(self.x, self.value, strict=True)
        ]


@dataclass(frozen=True)
class SimulationResult:
    """正向仿真结果。"""

    transmittance: Series
    reflectance: Series
    sheet_resistance: float | None  # Ω/sq；无导电层时为 None
    se_db: Series  # dB；无导电层时为空序列

    def to_dict(self) -> dict[str, Any]:
        """线格式（HTTP /simulate 响应 = RPC simulate 结果）。"""
        return {
            "transmittance": self.transmittance.to_points(),
            "reflectance": self.reflectance.to_points(),
            "sheet_resistance": self.sheet_resistance,
            "se_db": self.se_db.to_points(),
        }


# ---------------------------------------------------------------- 编排实现


def _validate_simulate(spec: SimulateSpec) -> None:
    """领域校验（两种传输共用，错误消息面向用户）。"""
    if not spec.layers:
        raise ValueError("layers 至少需要一层")
    if not float(spec.substrate_index) > 0.0:
        raise ValueError(f"substrate_index 必须 > 0，收到 {spec.substrate_index!r}")
    for i, layer in enumerate(spec.layers):
        if not str(layer.material).strip():
            raise ValueError(f"第 {i + 1} 层：材料名不能为空")
        t = float(layer.thickness_nm)
        if not np.isfinite(t) or t < 0.0:
            raise ValueError(
                f"第 {i + 1} 层：厚度必须为 ≥ 0 的有限数值，收到 {layer.thickness_nm!r}"
            )


def simulate(spec: SimulateSpec) -> SimulationResult:
    """执行正向仿真：光学（TMM）+ 电学（并联方阻）+ 屏蔽（传输线）。

    材料解析走共享注册表（omo.materials.MaterialResolver）；
    无导电层的 stack（如纯玻璃）返回 sheet_resistance=None、se_db 为空。

    参数:
        spec: 仿真输入

    返回:
        SimulationResult

    异常:
        ValueError: 领域校验失败（层数/材料/厚度/网格）；未知材料由 MaterialResolver 抛出
    """
    _validate_simulate(spec)

    wl = np.array(spec.wavelengths_nm or DEFAULT_WAVELENGTHS_NM, dtype=float)
    if wl.ndim != 1 or wl.size == 0 or np.any(wl <= 0):
        raise ValueError("wavelengths_nm 必须是一维且全为正")
    freqs = np.array(spec.freqs_ghz or DEFAULT_FREQS_GHZ, dtype=float)
    if freqs.ndim != 1 or freqs.size == 0 or np.any(freqs <= 0):
        raise ValueError("freqs_ghz 必须是一维且全为正")

    resolver = MaterialResolver()

    # ---- 光学：TMM（衬底折射率可配）----
    optical_layers = [
        Layer(index=resolver.optics_index(layer.material), thickness_nm=float(layer.thickness_nm))
        for layer in spec.layers
    ]
    tmm = transfer_matrix(optical_layers, wl, substrate_index=float(spec.substrate_index))

    # ---- 电学：并联方阻（含 Fuchs–Sondheimer 尺寸效应）----
    conductive: list[ConductiveLayer] = []
    for layer in spec.layers:
        ed = resolver.electrical(layer.material)
        if ed is None:
            continue  # 绝缘层（如 glass）不参与方阻/屏蔽
        conductive.append(
            ConductiveLayer(
                thickness_nm=float(layer.thickness_nm),
                bulk_resistivity=ed.bulk_resistivity,
                name=layer.material,
                mean_free_path_nm=ed.mean_free_path_nm,
                specularity=ed.specularity,
            )
        )

    # ---- 屏蔽：传输线模型（仅导电层参与）----
    se = Series(x=(), value=())
    if conductive:
        se_spec = shielding_effectiveness(
            [ShieldingLayer.from_conductive_layer(c) for c in conductive], freqs
        )
        se = Series(
            x=tuple(float(f) for f in freqs),
            value=tuple(float(v) for v in se_spec.se_db),
        )

    return SimulationResult(
        transmittance=Series(
            x=tuple(float(w) for w in wl),
            value=tuple(float(v) for v in tmm.transmittance),
        ),
        reflectance=Series(
            x=tuple(float(w) for w in wl),
            value=tuple(float(v) for v in tmm.reflectance),
        ),
        sheet_resistance=float(sheet_resistance(conductive)) if conductive else None,
        se_db=se,
    )


def optimize(spec: OptimizeSpec) -> dict[str, Any]:
    """执行目标反推：约束目标 → 网格扫描 → 候选 + 最佳候选灵敏度。

    None 字段落到 omo.optimize 的默认值；物理逻辑全部在 omo.optimize。

    参数:
        spec: 反推输入（target/space 均可缺省）

    返回:
        报告 dict（OptimizeReport.to_dict() + 顶层 "sensitivity"）

    异常:
        ValueError: 配置非法（范围/步长/未知材料/组合超限等）
    """
    # ---- 目标（缺省 = 无约束浏览扫描）----
    if spec.target is None:
        target = DesignTarget()
    else:
        t = spec.target
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
    s = spec.space
    if s is None:
        config = defaults
    else:
        config = OmoSearchConfig(
            outer_bounds_nm=s.outer_bounds_nm or defaults.outer_bounds_nm,
            outer_step_nm=(
                s.outer_step_nm if s.outer_step_nm is not None else defaults.outer_step_nm
            ),
            metal_bounds_nm=s.metal_bounds_nm or defaults.metal_bounds_nm,
            metal_step_nm=(
                s.metal_step_nm if s.metal_step_nm is not None else defaults.metal_step_nm
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
    if spec.compute_sensitivity and report.candidates:
        analysis = analyze_sensitivity(
            report.candidates[0],
            config.materials,
            target,
            substrate_index=config.substrate_index,
        )
        out["sensitivity"] = analysis.to_dict()
    return out
