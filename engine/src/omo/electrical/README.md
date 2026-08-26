# omo.electrical —— 电学仿真（M1 已实现）

## 职责

计算多层膜的电学性能：

- **方阻 Rs（Ω/sq）**：多层膜面内并联等效模型（1/Rs = Σ dᵢ/ρ_eff,ᵢ）
- **超薄金属电阻率尺寸效应**：Fuchs–Sondheimer 模型（精确积分式），金属层 ~5–15 nm 时不可忽略
- 材料常数：Ag / ITO（`materials.py`，标注文献来源）

## 已实现模块

- `sheet_resistance.py`：`sheet_resistance`、`ConductiveLayer`、`fuchs_sondheimer_ratio`
- `materials.py`：`SILVER_BULK_RESISTIVITY`、`SILVER_MEAN_FREE_PATH_NM`、`ITO_BULK_RESISTIVITY`

## 如何调用

```python
from omo.electrical import (
    ITO_BULK_RESISTIVITY,
    SILVER_BULK_RESISTIVITY,
    SILVER_MEAN_FREE_PATH_NM,
    ConductiveLayer,
    sheet_resistance,
)

# ITO(40)/Ag(10)/ITO(40) —— Ag 启用尺寸效应，ITO 并联计入
stack = [
    ConductiveLayer(thickness_nm=40.0, bulk_resistivity=ITO_BULK_RESISTIVITY, name="ITO"),
    ConductiveLayer(
        thickness_nm=10.0,
        bulk_resistivity=SILVER_BULK_RESISTIVITY,
        name="Ag",
        mean_free_path_nm=SILVER_MEAN_FREE_PATH_NM,  # 启用 Fuchs–Sondheimer
    ),
    ConductiveLayer(thickness_nm=40.0, bulk_resistivity=ITO_BULK_RESISTIVITY, name="ITO"),
]
rs = sheet_resistance(stack)  # -> float, Ω/sq
```

单独研究尺寸效应（电阻率增强因子）：

```python
from omo.electrical import fuchs_sondheimer_ratio

ratio = fuchs_sondheimer_ratio(thickness_nm=10.0, mean_free_path_nm=52.0)  # ≈ 2.3
```

## 物理模型与公式

见 `docs/physics/electrical.md`（并联模型、Fuchs–Sondheimer、文献来源）。

## 单位与约定

- 厚度：nm；电阻率：Ω·m；方阻：Ω/sq
- 绝缘层（ρ 极大）可不传入；弱导电层（ITO）自动计入并联
- 镜面散射系数 p ∈ [0,1]（默认 0 全漫射；p=1 无尺寸效应）
- 透明电极综合指标 FoM = T¹⁰/Rs，可结合 `omo.optics` 的透过率计算

## 验证

- `tests/test_electrical.py`：单层 Rs = ρ/d、并联减半、零厚度跳过、
  FS 大厚度解析极限（1+3λ/8d）、p=1 无增强、膜厚单调性、ITO/Ag/ITO 物理范围、输入校验
