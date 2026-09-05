"""FastAPI 请求/响应模型（snake_case，与 Go 中间层契约一致，AGENTS.md §6.7）。"""

from __future__ import annotations

from pydantic import BaseModel, Field


class LayerIn(BaseModel):
    """请求中的膜层。"""

    material: str = Field(min_length=1, description="材料名（ITO/Ag/...，见 omo.materials 注册表）")
    thickness_nm: float = Field(ge=0.0, description="层厚（nm）")


class SimulateRequest(BaseModel):
    """仿真请求：膜结构 + 可选输出网格。"""

    layers: list[LayerIn] = Field(min_length=1, description="膜层（入射侧 → 出射侧）")
    substrate_index: float = Field(default=1.5, gt=0.0, description="衬底折射率")
    wavelengths_nm: list[float] | None = Field(
        default=None, description="光学输出网格（nm）；缺省 380–1000 步长 10"
    )
    freqs_ghz: list[float] | None = Field(
        default=None, description="屏蔽输出网格（GHz）；缺省 1–18 步长 1"
    )


class SpectrumPoint(BaseModel):
    """光谱/频谱点（x 为波长 nm 或频率 GHz，由所属字段决定）。"""

    x: float
    value: float


class SimulateResponse(BaseModel):
    """仿真结果（对齐引擎输出）。"""

    transmittance: list[SpectrumPoint]
    reflectance: list[SpectrumPoint]
    sheet_resistance: float | None = None  # Ω/sq；无导电层时为 null
    se_db: list[SpectrumPoint]


# ---------------------------------------------------------------- 目标反推（/optimize）
# 字段可选（None = 用引擎默认），与 omo.optimize 的 DesignTarget / OmoSearchConfig 对应。

class OptimizeTarget(BaseModel):
    """目标约束（硬约束，可任选；全缺省 = 无约束浏览扫描）。"""

    min_visible_transmittance: float | None = Field(default=None, gt=0.0, le=1.0)
    max_sheet_resistance: float | None = Field(default=None, gt=0.0)
    min_se_db: float | None = Field(default=None, gt=0.0)
    se_freq_range_ghz: tuple[float, float] | None = Field(
        default=None, description="SE 评估频带 (lo, hi) GHz；缺省 X 波段 8.2–12.4"
    )


class OptimizeSpace(BaseModel):
    """OMO 三层厚度扫描空间（缺省外层 20–80 步长 4、金属 5–20 步长 1）。"""

    outer_bounds_nm: tuple[float, float] | None = None
    outer_step_nm: float | None = Field(default=None, gt=0.0)
    metal_bounds_nm: tuple[float, float] | None = None
    metal_step_nm: float | None = Field(default=None, gt=0.0)
    outer_material: str | None = Field(default=None, min_length=1)
    metal_material: str | None = Field(default=None, min_length=1)
    substrate_index: float | None = Field(default=None, gt=0.0)
    top_n: int | None = Field(default=None, gt=0)


class OptimizeRequest(BaseModel):
    """目标反推请求：目标约束 + 扫描空间 + 是否计算灵敏度。"""

    target: OptimizeTarget | None = None
    space: OptimizeSpace | None = None
    compute_sensitivity: bool = True
