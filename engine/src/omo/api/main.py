"""FastAPI 服务（M3）：供 Go 中间层调用仿真引擎。

约定（分层纪律，AGENTS.md §6.6）：只做请求/响应封装，物理逻辑一律在 omo 其余子包。

启动：uv run uvicorn omo.api.main:app --port 8000
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException

from omo.api.schemas import OptimizeRequest, SimulateRequest, SimulateResponse
from omo.api.service import run_optimization, run_simulation

app = FastAPI(title="omo engine", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    """健康检查。"""
    return {"status": "ok", "version": "0.1.0"}


@app.post("/simulate", response_model=SimulateResponse)
def simulate(req: SimulateRequest) -> SimulateResponse:
    """同步仿真：膜结构 → T(λ) / Rs / SE(f)。

    异常:
        HTTPException 422: 输入非法（未知材料、网格非正等）
    """
    try:
        return run_simulation(req)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


@app.post("/optimize")
def optimize(req: OptimizeRequest) -> dict:
    """目标反推（M5）：约束目标 → 候选膜厚组合 + 灵敏度（同步，数秒级）。

    异常:
        HTTPException 422: 配置非法（范围/步长/未知材料/组合超限等）
    """
    try:
        return run_optimization(req)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
