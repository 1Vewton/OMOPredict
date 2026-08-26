# omo.optics —— 光学仿真

## 职责

计算 OMO 多层膜系的光学性能：

- **TMM（传输矩阵法）**：基于 Fresnel 系数计算透过率 T、反射率 R、吸收率 A（支持角度与偏振）
- **Drude / Drude–Lorentz**：金属层介电函数模型
- 输出：300–2500 nm 光谱、可见光平均透过率、色度坐标

## 核心模块（计划，M1 实现）

- `transfer_matrix.py`：多层膜系 TMM 求解器
- `drude.py`：金属介电函数模型，常数须标注文献来源

## 如何调用（计划接口，M1 落地后生效）

```python
import numpy as np
from omo.optics import transfer_matrix

# 示例：ITO(40nm)/Ag(10nm)/ITO(40nm)，垂直入射，可见光波段
T, R, A = transfer_matrix(
    stack=[("ito", 40.0), ("ag", 10.0), ("ito", 40.0)],
    wavelengths_nm=np.linspace(400, 800, 401),
)
```

## 单位与约定

- 厚度：nm；波长：nm；n/k 无量纲
- 无散射假设下能量守恒：T + R + A = 1
- 材料光学常数（如 Ag 的 ωp、γ）来源统一登记于 `docs/physics/`

## 验证

- 单元测试：与单层膜解析解（Airy 公式）对照
- 基准测试（M2）：与文献实测透过率光谱对标
