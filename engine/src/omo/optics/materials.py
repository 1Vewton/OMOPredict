"""常用透明薄膜材料光学常数（常数折射率近似）。

约定：所有常数标注文献来源；色散金属（Ag）见 drude.py（SILVER）。
M2.3 模型校准产物以数据集 simulation 覆盖段引入（见 omo.benchmark），
本注册表保持"默认值"语义，不被校准改写。
"""

from __future__ import annotations

# ITO（可见光波段常数近似，无损）—— n ≈ 1.8–1.95，取 1.8
# 来源：溅射 ITO 薄膜可见光折射率常见文献值；M2.3 对标阶段校准。
ITO: complex = 1.8 + 0j

# 玻璃衬底（BK7 类）—— 来源：常见文献值
GLASS: complex = 1.5 + 0j
