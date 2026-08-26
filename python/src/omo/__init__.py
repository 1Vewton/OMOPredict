"""omo —— OMO 纳米多层薄膜轻量化仿真与设计软件（数据科学层）。

包划分遵循 Go 的包模式：每个子包一个职责目录。

- omo.optics：光学仿真（TMM、Drude–Lorentz）
- omo.electrical：电学仿真（方阻、尺寸效应）
- omo.emi：电磁屏蔽效能
- omo.optimize：参数优化与工艺指导
- omo.neural：NN 代理模型（M2.5）
- omo.benchmark：文献对标与误差评估
- omo.api：FastAPI 服务（供 Go 中间层调用）
- omo.cli：命令行入口
"""

from __future__ import annotations

__version__ = "0.1.0"
