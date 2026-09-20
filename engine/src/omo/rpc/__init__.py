"""stdio JSON-RPC 2.0 服务（桌面形态）—— 见 `omo.rpc.server`。

入口：`python -m omo.rpc`（PyInstaller 打包后为 `omo-rpc` 可执行文件）。
本包**不导入** FastAPI / uvicorn / pydantic / torch / matplotlib，
以保证桌面引擎包精简（docs/desktop.md D4；由 import 图测试守护）。
"""

from __future__ import annotations

from omo.rpc.server import (
    INVALID_PARAMS,
    INVALID_REQUEST,
    METHOD_NOT_FOUND,
    PARSE_ERROR,
    RpcError,
    dispatch,
    handle_line,
    serve,
)

__all__ = [
    "INVALID_PARAMS",
    "INVALID_REQUEST",
    "METHOD_NOT_FOUND",
    "PARSE_ERROR",
    "RpcError",
    "dispatch",
    "handle_line",
    "serve",
]
