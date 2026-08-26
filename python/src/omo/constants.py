"""通用物理常数（集中管理）。

约定：
- 数值采用 CODATA 2018 推荐值，来源：Tiesinga et al.,
  Rev. Mod. Phys. 93, 025010 (2021), https://doi.org/10.1103/RevModPhys.93.025010
- 材料相关常数（如 Ag 的 Drude 参数 ωp、γ）属于具体物理模块，不放在这里，
  且同样必须标注文献来源（见 AGENTS.md 工作守则第 2 条）。
"""

from __future__ import annotations

# 真空光速 c（SI 定义精确值）—— m/s
SPEED_OF_LIGHT: float = 299_792_458.0

# 真空磁导率 μ0 —— H/m（CODATA 2018）
VACUUM_PERMEABILITY: float = 1.256_637_062_12e-6

# 真空介电常数 ε0 —— F/m（CODATA 2018）
VACUUM_PERMITTIVITY: float = 8.854_187_812_8e-12

# 真空波阻抗 Z0 = sqrt(μ0/ε0) ≈ 376.73 Ω（CODATA 2018）
# 用于薄导电膜屏蔽近似：SE ≈ 20·log10(1 + Z0/(2·Rs))
VACUUM_IMPEDANCE: float = 376.730_313_668

# 普朗克常数 h —— J·s（CODATA 2018）
PLANCK_CONSTANT: float = 6.626_070_15e-34

# 元电荷 e —— C（CODATA 2018）
ELEMENTARY_CHARGE: float = 1.602_176_634e-19

# 玻尔兹曼常数 kB —— J/K（CODATA 2018）
BOLTZMANN_CONSTANT: float = 1.380_649e-23
