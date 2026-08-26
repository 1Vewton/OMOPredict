# omo.electrical —— 电学仿真

## 职责

计算多层膜的电学性能：

- **方阻 Rs（Ω/sq）**：多层膜并联等效模型（金属层主导，氧化物视为绝缘）
- **超薄金属电阻率尺寸效应**：Fuchs–Sondheimer 修正（金属层 ~5–15 nm 时不可忽略）
- 输出：方阻、等效电阻率、Rs–厚度关系曲线

## 核心模块（计划，M1 实现）

- `sheet_resistance.py`：并联模型 + 尺寸效应
- 材料常数（块体电阻率、电子平均自由程等）标注文献来源

## 如何调用（计划接口，M1 落地后生效）

```python
from omo.electrical import sheet_resistance

Rs = sheet_resistance(
    layers=[
        {"material": "ito", "thickness_nm": 40.0, "resistive": False},
        {"material": "ag", "thickness_nm": 10.0, "resistive": True, "bulk_rho": 1.59e-8},
        {"material": "ito", "thickness_nm": 40.0, "resistive": False},
    ]
)  # -> float, 单位 Ω/sq
```

## 单位与约定

- 方阻：Ω/sq；电阻率：Ω·m
- 透明电极综合指标 FoM = T¹⁰/Rs，可结合 `omo.optics` 的透过率计算

## 验证

- 与文献 ITO/Ag/ITO 方阻实测数据对标（M2 基准测试）
