# omo.emi —— 电磁屏蔽效能仿真

## 职责

计算多层膜的电磁屏蔽效能（EMI SE，dB）：

- **Schelkunoff / 传输线模型**：SE_total = SE_R + SE_A + SE_M（反射、吸收、多次反射损耗）
- **薄导电膜近似**：SE ≈ 20·log₁₀(1 + Z₀/(2·Rs))，Z₀ = 376.73 Ω（见 `omo.constants`）
- 多层结构用多层传输线矩阵；输出 1–18 GHz 频段 SE 曲线

## 核心模块（计划，M1 实现）

- `shielding.py`：传输线 / Schelkunoff 模型
- `materials.py`：各层电导率/介电常数参数（标注来源）

## 如何调用（计划接口，M1 落地后生效）

```python
import numpy as np
from omo.emi import shielding_effectiveness

SE_db = shielding_effectiveness(
    stack=[("ito", 40.0), ("ag", 10.0), ("ito", 40.0)],
    freqs_ghz=np.linspace(1, 18, 171),
)  # -> np.ndarray, 单位 dB
```

## 单位与约定

- 频率：GHz；SE：dB
- 薄导电膜近似中的 Rs 与 `omo.electrical` 输出一致

## 验证

- 与文献 X 波段（8.2–12.4 GHz）屏蔽实测数据对标（M2 基准测试）
