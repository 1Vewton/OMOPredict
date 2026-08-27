# omo.emi —— 电磁屏蔽效能仿真（M1 已实现）

## 职责

计算多层膜的电磁屏蔽效能（EMI SE，dB）：

- **传输线模型（精确）**：多层膜 SE(f)，垂直入射平面波
- **Schelkunoff 组分分解**：SE = SE_R + SE_A + SE_M（单层，精确分解）
- **薄导电膜近似**：SE ≈ 20·log₁₀(1 + Z₀/(2·Rs))，Z₀ = 376.73 Ω（d ≪ δ 场景，Rs 来自 `omo.electrical`）

## 已实现模块

- `shielding.py`：`shielding_effectiveness`、`thin_film_se`、`schelkunoff_components`、`ShieldingLayer`、`ShieldingSpectrum`、`SchelkunoffResult`
- `materials.py`：`SILVER_BULK_CONDUCTIVITY`、`ITO_BULK_CONDUCTIVITY`（源自 electrical 单一数据源）

## 如何调用

```python
import numpy as np
from omo.electrical import (
    ITO_BULK_RESISTIVITY,
    SILVER_BULK_RESISTIVITY,
    SILVER_MEAN_FREE_PATH_NM,
    ConductiveLayer,
    sheet_resistance,
)
from omo.emi import ShieldingLayer, shielding_effectiveness, thin_film_se

# 由电学模块的导电层构造屏蔽层（σ_eff 含 Fuchs–Sondheimer 尺寸效应）
ag = ConductiveLayer(10.0, SILVER_BULK_RESISTIVITY, "Ag", SILVER_MEAN_FREE_PATH_NM)
ito = ConductiveLayer(40.0, ITO_BULK_RESISTIVITY, "ITO")
stack = [ShieldingLayer.from_conductive_layer(x) for x in (ito, ag, ito)]

freqs = np.linspace(1.0, 18.0, 171)          # GHz
spec = shielding_effectiveness(stack, freqs)
spec.se_db                 # SE(f)，dB
spec.x_band_average()      # X 波段（8.2–12.4 GHz）平均，dB

# 薄膜近似：直接用总方阻（与传输线模型在 d ≪ δ 时一致）
rs = sheet_resistance([ito, ag, ito])
thin_film_se(rs)           # ≈ spec.x_band_average()

# Schelkunoff 组分分解（单层）
from omo.emi import schelkunoff_components
comp = schelkunoff_components(freqs, thickness_nm=3175.0, conductivity=6.29e7)
comp.total_db              # = SE_R + SE_A + SE_M，与 shielding_effectiveness 单层一致
```

## 物理模型与公式

见 `docs/physics/emi.md`（传输线模型、Schelkunoff 分解、薄膜近似、文献来源）。

## 单位与约定

- 频率：GHz；厚度：nm；电导率：S/m；SE：dB
- 两侧介质默认自由空间（Z₀ = 376.73 Ω，见 `omo.constants`）；SE 定义要求两侧相同
- 薄膜（d ≪ δ）：SE 由总方阻决定，频率平坦；厚层：吸收主导，SE ∝ √f
- 导电层总衰减 Σαd ≲ 100（毫米级实心金属板请用 `schelkunoff_components`）

## 验证

- `tests/test_emi.py`：薄膜近似解析值、10nm Ag 与 Rs 公式一致（±0.2 dB）、
  Schelkunoff 组分和与传输线模型严格一致（1e-6 dB）、SE_A = 8.686·d/δ 解析值、
  厚层频率增长/薄层平坦、ITO/Ag/ITO X 波段 > 25 dB、玻璃介质不屏蔽、输入校验
