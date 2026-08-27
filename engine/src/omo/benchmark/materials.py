"""材料解析：material 名 → 引擎输入（光学 + 电学），支持数据集覆盖。

默认光学模型：
- ITO / 玻璃：常数复折射率（omo.optics.materials）
- Ag：Drude（omo.optics.drude.SILVER）
默认电学模型：omo.electrical.materials（ρ_bulk、λ、p）
覆盖（M2.3 校准产物）：dataset 的 simulation.materials 段，见 schema.py。

约定：无电学模型的材料（如玻璃）在电学解析中返回 None（不参与方阻/屏蔽）。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from omo.benchmark.schema import MaterialOverrides
from omo.electrical.materials import (
    ITO_BULK_RESISTIVITY,
    SILVER_BULK_RESISTIVITY,
    SILVER_MEAN_FREE_PATH_NM,
)
from omo.optics import DrudeMaterial
from omo.optics.drude import SILVER
from omo.optics.materials import GLASS, ITO


@dataclass(frozen=True)
class ElectricalDefaults:
    """材料的默认电学参数（bulk 电阻率必填；λ/p 用于尺寸效应）。"""

    bulk_resistivity: float
    mean_free_path_nm: float = 0.0
    specularity: float = 0.0


# 默认光学注册表：material -> 常数折射率 或 Drude 材料
_DEFAULT_OPTICS: dict[str, complex | DrudeMaterial] = {
    "ITO": ITO,
    "Ag": SILVER,
    "glass": GLASS,
}

# 默认电学注册表：material -> 参数；None = 绝缘体
_DEFAULT_ELECTRICAL: dict[str, ElectricalDefaults | None] = {
    "ITO": ElectricalDefaults(bulk_resistivity=ITO_BULK_RESISTIVITY),
    "Ag": ElectricalDefaults(
        bulk_resistivity=SILVER_BULK_RESISTIVITY,
        mean_free_path_nm=SILVER_MEAN_FREE_PATH_NM,
    ),
    "glass": None,
}


class MaterialResolver:
    """材料名 → 引擎输入；支持 dataset 的 simulation 覆盖（校准产物）。"""

    def __init__(self, overrides: Mapping[str, MaterialOverrides] | None = None) -> None:
        self._overrides = dict(overrides or {})

    def optics_index(self, material: str) -> complex | DrudeMaterial:
        """返回光学折射率源（常数 或 DrudeMaterial，可作 Layer.index）。

        异常:
            ValueError: 材料未收录且无覆盖
        """
        ov = self._overrides.get(material)
        if ov is not None and not ov.optics.is_empty:
            if ov.optics.drude is not None:
                return ov.optics.drude
            if ov.optics.constant_index is not None:
                return ov.optics.constant_index
        try:
            return _DEFAULT_OPTICS[material]
        except KeyError:
            raise ValueError(
                f"未收录材料 {material!r} 的光学模型（可在 simulation.materials 中提供）"
            ) from None

    def electrical(self, material: str) -> ElectricalDefaults | None:
        """返回电学参数；None 表示绝缘体（不参与方阻/屏蔽）。"""
        base = _DEFAULT_ELECTRICAL.get(material)
        ov = self._overrides.get(material)
        if ov is None or ov.electrical.is_empty:
            return base
        e = ov.electrical
        if base is None:
            if e.bulk_resistivity is None:
                return None
            return ElectricalDefaults(
                bulk_resistivity=e.bulk_resistivity,
                mean_free_path_nm=e.mean_free_path_nm or 0.0,
                specularity=e.specularity or 0.0,
            )
        return ElectricalDefaults(
            bulk_resistivity=(
                e.bulk_resistivity if e.bulk_resistivity is not None else base.bulk_resistivity
            ),
            mean_free_path_nm=(
                e.mean_free_path_nm if e.mean_free_path_nm is not None else base.mean_free_path_nm
            ),
            specularity=e.specularity if e.specularity is not None else base.specularity,
        )
