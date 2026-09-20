"""omo.rpc（stdio JSON-RPC）测试：协议、错误码、与 HTTP 的载荷一致性、import 图。

契约要点（docs/api/engine.md 与 docs/api/rpc.md）：
- 应用错误 code=422（与 HTTP /simulate、/optimize 的 422 一致）；
- 协议错误用保留码（-32700/-32600/-32601/-32602）；
- 同一请求经 RPC 与 HTTP（omo.api.service）结果逐字段相同。
"""

from __future__ import annotations

import io
import json
import subprocess
import sys

import pytest

from omo.api.schemas import OptimizeRequest, SimulateRequest
from omo.api.service import run_optimization, run_simulation
from omo.rpc import (
    INVALID_PARAMS,
    INVALID_REQUEST,
    METHOD_NOT_FOUND,
    PARSE_ERROR,
    RpcError,
    dispatch,
    handle_line,
    serve,
)

ITO_AG_ITO = [
    {"material": "ITO", "thickness_nm": 40.0},
    {"material": "Ag", "thickness_nm": 10.0},
    {"material": "ITO", "thickness_nm": 40.0},
]

SMALL_SPACE = {
    "outer_bounds_nm": [40.0, 60.0],
    "outer_step_nm": 10.0,
    "metal_bounds_nm": [8.0, 12.0],
    "metal_step_nm": 2.0,
}


def call(method: str, params: dict | None = None, req_id: int = 1) -> dict:
    """执行一次 RPC 调用并返回响应 dict。"""
    request = {"jsonrpc": "2.0", "id": req_id, "method": method}
    if params is not None:
        request["params"] = params
    response = handle_line(json.dumps(request).encode("utf-8"))
    assert response is not None
    return response


def call_error(method: str, params: dict | None = None) -> tuple[int, str]:
    """执行一次预期失败的调用，返回 (code, message)。"""
    response = call(method, params)
    assert "error" in response, f"期望错误，得到 {response}"
    return response["error"]["code"], response["error"]["message"]


# ---------------------------------------------------------------- 基本方法


def test_ping() -> None:
    response = call("ping")
    assert response["result"]["status"] == "ok"
    assert response["result"]["version"]


def test_unknown_method() -> None:
    assert call_error("nope")[0] == METHOD_NOT_FOUND


# ---------------------------------------------------------------- 与 HTTP 一致性


def test_simulate_parity_with_http_adapter() -> None:
    """同一请求：RPC simulate 结果 == HTTP /simulate 响应体。"""
    params = {"layers": ITO_AG_ITO}
    rpc_result = call("simulate", params)["result"]
    http_result = run_simulation(SimulateRequest(**params)).model_dump()
    assert rpc_result == http_result


def test_simulate_parity_with_custom_grids() -> None:
    params = {
        "layers": ITO_AG_ITO,
        "substrate_index": 1.7,
        "wavelengths_nm": [550.0],
        "freqs_ghz": [10.0],
    }
    rpc_result = call("simulate", params)["result"]
    http_result = run_simulation(SimulateRequest(**params)).model_dump()
    assert rpc_result == http_result
    assert len(rpc_result["transmittance"]) == 1


def _without_timing(report: dict) -> dict:
    """剔除非确定字段（反推报告含墙钟计时，两次运行必然不同）。"""
    out = dict(report)
    out.pop("elapsed_seconds", None)
    return out


def test_optimize_parity_with_http_adapter() -> None:
    """同一请求：RPC optimize 结果 == HTTP /optimize 响应体（含灵敏度）。"""
    params = {
        "target": {"min_visible_transmittance": 0.85, "max_sheet_resistance": 12.0},
        "space": SMALL_SPACE,
        "compute_sensitivity": True,
    }
    rpc_result = call("optimize", params)["result"]
    http_result = run_optimization(OptimizeRequest(**params))
    assert _without_timing(rpc_result) == _without_timing(http_result)
    assert rpc_result["n_scanned"] == 27
    assert rpc_result["sensitivity"] is not None


def test_simulate_insulator_parity() -> None:
    """纯玻璃：两侧都返回 sheet_resistance=null、se_db=[]。"""
    params = {"layers": [{"material": "glass", "thickness_nm": 1e6}]}
    rpc_result = call("simulate", params)["result"]
    assert rpc_result["sheet_resistance"] is None
    assert rpc_result["se_db"] == []
    assert rpc_result == run_simulation(SimulateRequest(**params)).model_dump()


# ---------------------------------------------------------------- 错误码


@pytest.mark.parametrize(
    "params, message_part",
    [
        ({"layers": []}, "layers 至少需要一层"),
        ({"layers": [{"material": "ZnO", "thickness_nm": 40.0}]}, "ZnO"),
        ({"layers": [{"material": "ITO", "thickness_nm": -5.0}]}, "厚度必须为 ≥ 0"),
        ({"layers": ITO_AG_ITO, "substrate_index": 0.0}, "substrate_index 必须 > 0"),
    ],
)
def test_domain_errors_are_422(params: dict, message_part: str) -> None:
    code, message = call_error("simulate", params)
    assert code == 422
    assert message_part in message


def test_optimize_domain_errors_are_422() -> None:
    code, _ = call_error("optimize", {"space": {**SMALL_SPACE, "outer_bounds_nm": [80.0, 20.0]}})
    assert code == 422
    code, _ = call_error("optimize", {"space": {**SMALL_SPACE, "top_n": 0}})
    assert code == 422
    code, _ = call_error("optimize", {"space": {"outer_step_nm": 0.0}})
    assert code == 422


@pytest.mark.parametrize(
    "line, expected_code",
    [
        (b"{not json", PARSE_ERROR),
        (b"[1,2,3]", INVALID_REQUEST),
        (b'{"jsonrpc":"2.0","id":1}', INVALID_REQUEST),
        (b'{"jsonrpc":"2.0","id":1,"method":"nope"}', METHOD_NOT_FOUND),
        (b'{"jsonrpc":"2.0","id":1,"method":"ping","params":[]}', INVALID_PARAMS),
        (b'{"jsonrpc":"2.0","id":1,"method":"simulate","params":{"layer":[]}}', INVALID_PARAMS),
        (
            b'{"jsonrpc":"2.0","id":1,"method":"simulate","params":{"layers":[{"material":"ITO","thickness_nm":"40"}]}}',
            INVALID_PARAMS,
        ),
        (
            b'{"jsonrpc":"2.0","id":1,"method":"optimize","params":{"space":{"top_n":1.5}}}',
            INVALID_PARAMS,
        ),
    ],
)
def test_protocol_errors(line: bytes, expected_code: int) -> None:
    response = handle_line(line)
    assert response is not None
    assert response["error"]["code"] == expected_code, response


def test_non_utf8_line_is_parse_error() -> None:
    response = handle_line(b"\xff\xfe{}")
    assert response is not None
    assert response["error"]["code"] == PARSE_ERROR


# ---------------------------------------------------------------- 传输行为


def test_notification_gets_no_response() -> None:
    request = {"jsonrpc": "2.0", "method": "ping"}
    assert handle_line(json.dumps(request).encode("utf-8")) is None


def test_serve_multiple_lines_and_blank_lines() -> None:
    """一次喂多行（含空行）：按行返回、空行忽略。"""
    simulate_req = {
        "jsonrpc": "2.0",
        "id": 2,
        "method": "simulate",
        "params": {"layers": ITO_AG_ITO},
    }
    payload = (
        json.dumps({"jsonrpc": "2.0", "id": 1, "method": "ping"}).encode()
        + b"\n\n"
        + json.dumps(simulate_req).encode()
        + b"\n"
        + json.dumps({"jsonrpc": "2.0", "method": "ping"}).encode()
        + b"\n"
    )
    out = io.BytesIO()
    serve(io.BytesIO(payload), out)
    lines = [json.loads(line) for line in out.getvalue().decode("utf-8").strip().split("\n")]
    assert len(lines) == 2  # 通知不回复
    assert lines[0]["id"] == 1 and lines[0]["result"]["status"] == "ok"
    assert lines[1]["id"] == 2 and len(lines[1]["result"]["transmittance"]) == 63


def test_oversized_line_rejected() -> None:
    """超长行直接拒绝（不解析），避免异常内存占用。"""
    from omo.rpc import server as rpc_server

    original = rpc_server.MAX_LINE_BYTES
    rpc_server.MAX_LINE_BYTES = 1024
    try:
        huge = b'{"jsonrpc":"2.0","id":1,"method":"ping","params":{"x":"' + b"a" * 2000 + b'"}}\n'
        out = io.BytesIO()
        serve(io.BytesIO(huge), out)
        response = json.loads(out.getvalue().decode("utf-8"))
        assert response["error"]["code"] == INVALID_REQUEST
    finally:
        rpc_server.MAX_LINE_BYTES = original


def test_dispatch_raises_rpc_error() -> None:
    with pytest.raises(RpcError):
        dispatch("nope", {})


# ---------------------------------------------------------------- import 图


def test_rpc_entry_does_not_import_heavy_dependencies() -> None:
    """桌面入口（omo.rpc）不得拉入重依赖：torch/matplotlib/fastapi/uvicorn/pydantic。

    在**子进程**中检查，避免同进程内其它测试（如 test_api）已经导入这些模块造成误判。
    """
    heavies = ("torch", "matplotlib", "fastapi", "uvicorn", "pydantic", "starlette")
    code = (
        "import json, sys, omo.rpc; "
        f"print(json.dumps(sorted(m for m in {heavies!r} if m in sys.modules)))"
    )
    proc = subprocess.run(
        [sys.executable, "-c", code], capture_output=True, text=True, timeout=120
    )
    assert proc.returncode == 0, proc.stderr
    assert json.loads(proc.stdout.strip()) == [], f"重依赖被导入: {proc.stdout}"
