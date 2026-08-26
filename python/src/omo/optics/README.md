# omo.optics —— 光学仿真（M1 已实现）

## 职责

计算 OMO 多层膜系的光学性能：

- **TMM（传输矩阵法）**：特征矩阵法实现，计算透过率 T、反射率 R、吸收率 A（支持入射角与 s/p/非偏振）
- **Drude 金属介电函数**：ε(ω) = ε∞ − ωp²/(ω²+iγω)，内置 Ag 常用参数（`SILVER`）
- 输出：300–2500 nm 光谱曲线、可见光平均透过率

## 已实现模块

- `transfer_matrix.py`：TMM 求解器（`transfer_matrix`、`Layer`、`OpticalSpectrum`）
- `drude.py`：`DrudeMaterial`（可作色散材料的层折射率来源）

## 如何调用

```python
import numpy as np
from omo.optics import Layer, SILVER, transfer_matrix

# ITO(40nm)/Ag(10nm)/ITO(40nm)，玻璃衬底，垂直入射，非偏振（默认）
stack = [
    Layer(index=1.8 + 0j, thickness_nm=40.0),   # ITO（可见光近似无损）
    Layer(index=SILVER, thickness_nm=10.0),     # Ag（Drude 色散材料，可调用对象）
    Layer(index=1.8 + 0j, thickness_nm=40.0),   # ITO
]
wl = np.linspace(400.0, 1000.0, 601)
spec = transfer_matrix(stack, wl)

spec.transmittance   # T(λ)
spec.reflectance     # R(λ)
spec.absorptance     # A(λ) = 1 − T − R
spec.visible_average_transmittance()   # 可见光平均透过率（默认 400–800 nm）
```

带入射角与偏振的用法：

```python
spec_s = transfer_matrix(stack, wl, angle_deg=45.0, polarization="s")
spec_p = transfer_matrix(stack, wl, angle_deg=45.0, polarization="p")
spec_u = transfer_matrix(stack, wl, angle_deg=45.0)  # 非偏振 = (s+p)/2
```

## 物理模型与公式

见 `docs/physics/tmm.md`（特征矩阵法、Drude 模型、约定与文献来源）。

## 单位与约定

- 厚度：nm；波长：nm；n/k 无量纲
- 无散射假设：T + R + A = 1
- 入射/出射介质须无吸收（默认空气 1.0 / 玻璃 1.5）；入射角 [0, 90)°
- 复折射率分支约定 Re(ñ) ≥ 0

## 验证

- `tests/test_transfer_matrix.py`：裸界面 Fresnel、单层 Airy 解析解、四分之一波增透（R→0）、
  半波膜回归裸界面、薄层极限、能量守恒（吸收层）、偏振分裂与非偏振平均、输入校验
- `tests/test_drude.py`：Drude 解析性质（ω=ωp 处 ε 值、金属性、高频极限）、标量/数组返回、输入校验
