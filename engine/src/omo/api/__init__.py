"""FastAPI 服务包（M3 已实现：/simulate + /health，供 Go 中间层调用）。

- schemas.py：请求/响应模型（snake_case）
- service.py：仿真编排（调引擎，无物理逻辑）
- main.py：FastAPI 应用（uvicorn 启动）

约定：物理逻辑一律调用 omo 其余子包（分层纪律，见 AGENTS.md 第 6 条）。
"""

from __future__ import annotations

from omo.api.main import app
from omo.api.schemas import LayerIn, SimulateRequest, SimulateResponse, SpectrumPoint
from omo.api.service import DEFAULT_FREQS_GHZ, DEFAULT_WAVELENGTHS_NM, run_simulation

__all__ = [
    "app",
    "LayerIn",
    "SimulateRequest",
    "SimulateResponse",
    "SpectrumPoint",
    "DEFAULT_FREQS_GHZ",
    "DEFAULT_WAVELENGTHS_NM",
    "run_simulation",
]
