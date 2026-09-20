"""stdio JSON-RPC 2.0 服务：JSON-Lines over stdin/stdout（桌面形态）。

协议与错误码与 Go 侧 `server/internal/rpc` 对齐（`docs/api/rpc.md`）：

- 每行一个 JSON-RPC 2.0 对象，UTF-8 字节流；**无 id 的行视为通知**（执行但不回复）；
- 应用错误 `code = 422`（与 HTTP `POST /simulate`、`POST /optimize` 的 422 语义一致）；
- 协议错误用 JSON-RPC 保留码：
  `-32700` 解析失败 / `-32600` 非法请求 / `-32601` 方法不存在 / `-32602` 参数非法。

方法（参数与 HTTP 请求体逐字段一致，便于契约测试互验）：

| 方法 | 等价 HTTP | 结果 |
|---|---|---|
| `ping` | `GET /health` | `{"status":"ok","version":...}` |
| `simulate` | `POST /simulate` | 同 `/simulate` 响应体 |
| `optimize` | `POST /optimize` | 同 `/optimize` 响应体（反推报告） |
"""

from __future__ import annotations

import json
import sys
from typing import Any, BinaryIO

from omo import __version__
from omo.sim import (
    LayerSpec,
    OptimizeSpaceSpec,
    OptimizeSpec,
    OptimizeTargetSpec,
    SimulateSpec,
)
from omo.sim import optimize as _optimize
from omo.sim import simulate as _simulate

# JSON-RPC 协议保留错误码
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602

# 单行上限（optimize 报告可达数百 KB，留足余量）
MAX_LINE_BYTES = 16 * 1024 * 1024


class RpcError(Exception):
    """JSON-RPC 错误（code 沿用 HTTP 状态码语义或 JSON-RPC 保留码）。"""

    def __init__(self, code: int, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# ---------------------------------------------------------------- 参数校验


def _as_object(params: Any, ctx: str) -> dict[str, Any]:
    """params 必须为对象（缺省视为空对象）。"""
    if params is None:
        return {}
    if not isinstance(params, dict):
        raise RpcError(INVALID_PARAMS, f"{ctx}: params 需为对象")
    return params


def _check_keys(obj: dict[str, Any], allowed: set[str], ctx: str) -> None:
    """拒绝未知字段（避免拼写错误被静默忽略）。"""
    unknown = sorted(set(obj) - allowed)
    if unknown:
        raise RpcError(INVALID_PARAMS, f"{ctx}: 未知字段 {', '.join(unknown)}")


def _num(value: Any, field: str, *, integer: bool = False, allow_zero: bool = True) -> Any:
    """数值校验；None 原样返回（表示未提供）。"""
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise RpcError(INVALID_PARAMS, f"{field} 需为数值")
    if integer:
        if int(value) != value:
            raise RpcError(INVALID_PARAMS, f"{field} 需为整数")
        return int(value)
    return float(value)


def _num_required(value: Any, field: str) -> float:
    """必填数值。"""
    if value is None:
        raise RpcError(INVALID_PARAMS, f"{field} 缺失")
    out = _num(value, field)
    return float(out)


def _num_list(value: Any, field: str) -> tuple[float, ...] | None:
    """数值数组（None → None）。"""
    if value is None:
        return None
    if not isinstance(value, list) or not value:
        raise RpcError(INVALID_PARAMS, f"{field} 需为非空数组")
    return tuple(float(_num_required(v, f"{field}[{i}]")) for i, v in enumerate(value))


def _num_pair(value: Any, field: str) -> tuple[float, float] | None:
    """二元数值数组（None → None）。"""
    if value is None:
        return None
    seq = _num_list(value, field)
    if seq is None or len(seq) != 2:
        raise RpcError(INVALID_PARAMS, f"{field} 需为两个数值的数组")
    return (seq[0], seq[1])


def _layers(value: Any) -> tuple[LayerSpec, ...]:
    """膜层数组（入射侧 → 出射侧）。"""
    if value is None:
        raise RpcError(INVALID_PARAMS, "layers 缺失")
    if not isinstance(value, list):
        raise RpcError(INVALID_PARAMS, "layers 需为数组")
    out: list[LayerSpec] = []
    for i, item in enumerate(value):
        if not isinstance(item, dict):
            raise RpcError(INVALID_PARAMS, f"layers[{i}] 需为对象")
        _check_keys(item, {"material", "thickness_nm"}, f"layers[{i}]")
        material = item.get("material")
        if not isinstance(material, str) or not material.strip():
            raise RpcError(INVALID_PARAMS, f"layers[{i}].material 需为非空字符串")
        thickness = _num_required(item.get("thickness_nm"), f"layers[{i}].thickness_nm")
        out.append(LayerSpec(material=material.strip(), thickness_nm=thickness))
    return tuple(out)


# ---------------------------------------------------------------- 方法实现


def _method_ping(_: dict[str, Any]) -> dict[str, str]:
    """健康检查（与 HTTP GET /health 同结构）。"""
    return {"status": "ok", "version": __version__}


def _method_simulate(params: dict[str, Any]) -> dict[str, Any]:
    """正向仿真（与 HTTP POST /simulate 同请求/响应体）。"""
    _check_keys(params, {"layers", "substrate_index", "wavelengths_nm", "freqs_ghz"}, "simulate")
    substrate = _num(params.get("substrate_index"), "substrate_index")
    spec = SimulateSpec(
        layers=_layers(params.get("layers")),
        substrate_index=1.5 if substrate is None else float(substrate),
        wavelengths_nm=_num_list(params.get("wavelengths_nm"), "wavelengths_nm"),
        freqs_ghz=_num_list(params.get("freqs_ghz"), "freqs_ghz"),
    )
    return _simulate(spec).to_dict()


def _method_optimize(params: dict[str, Any]) -> dict[str, Any]:
    """目标反推（与 HTTP POST /optimize 同请求/响应体）。"""
    _check_keys(params, {"target", "space", "compute_sensitivity"}, "optimize")

    target: OptimizeTargetSpec | None = None
    raw_target = params.get("target")
    if raw_target is not None:
        t = _as_object(raw_target, "target")
        _check_keys(
            t,
            {"min_visible_transmittance", "max_sheet_resistance", "min_se_db", "se_freq_range_ghz"},
            "target",
        )
        target = OptimizeTargetSpec(
            min_visible_transmittance=_num(
                t.get("min_visible_transmittance"), "target.min_visible_transmittance"
            ),
            max_sheet_resistance=_num(t.get("max_sheet_resistance"), "target.max_sheet_resistance"),
            min_se_db=_num(t.get("min_se_db"), "target.min_se_db"),
            se_freq_range_ghz=_num_pair(t.get("se_freq_range_ghz"), "target.se_freq_range_ghz"),
        )

    space: OptimizeSpaceSpec | None = None
    raw_space = params.get("space")
    if raw_space is not None:
        s = _as_object(raw_space, "space")
        _check_keys(
            s,
            {
                "outer_bounds_nm",
                "outer_step_nm",
                "metal_bounds_nm",
                "metal_step_nm",
                "outer_material",
                "metal_material",
                "substrate_index",
                "top_n",
            },
            "space",
        )
        material_o = s.get("outer_material")
        material_m = s.get("metal_material")
        if material_o is not None and not isinstance(material_o, str):
            raise RpcError(INVALID_PARAMS, "space.outer_material 需为字符串")
        if material_m is not None and not isinstance(material_m, str):
            raise RpcError(INVALID_PARAMS, "space.metal_material 需为字符串")
        space = OptimizeSpaceSpec(
            outer_bounds_nm=_num_pair(s.get("outer_bounds_nm"), "space.outer_bounds_nm"),
            outer_step_nm=_num(s.get("outer_step_nm"), "space.outer_step_nm"),
            metal_bounds_nm=_num_pair(s.get("metal_bounds_nm"), "space.metal_bounds_nm"),
            metal_step_nm=_num(s.get("metal_step_nm"), "space.metal_step_nm"),
            outer_material=material_o,
            metal_material=material_m,
            substrate_index=_num(s.get("substrate_index"), "space.substrate_index"),
            top_n=_num(s.get("top_n"), "space.top_n", integer=True),
        )

    raw_sens = params.get("compute_sensitivity")
    if raw_sens is not None and not isinstance(raw_sens, bool):
        raise RpcError(INVALID_PARAMS, "compute_sensitivity 需为布尔值")

    return _optimize(
        OptimizeSpec(
            target=target,
            space=space,
            compute_sensitivity=True if raw_sens is None else raw_sens,
        )
    )


_METHODS = {
    "ping": _method_ping,
    "simulate": _method_simulate,
    "optimize": _method_optimize,
}


def dispatch(method: str, params: Any) -> Any:
    """执行一个 RPC 方法（供 serve 与测试使用）。

    异常:
        RpcError: 协议/参数错误；领域校验失败由 omo.sim 抛 ValueError（由 handle_line 转 422）
    """
    handler = _METHODS.get(method)
    if handler is None:
        raise RpcError(METHOD_NOT_FOUND, f"方法不存在: {method}")
    return handler(_as_object(params, method))


# ---------------------------------------------------------------- 行处理


def handle_line(line: bytes) -> dict[str, Any] | None:
    """处理一行请求，返回响应 dict；通知（无 id）返回 None。"""
    try:
        request = json.loads(line.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        return _error_response(None, PARSE_ERROR, f"解析失败: {exc}")

    if not isinstance(request, dict):
        return _error_response(None, INVALID_REQUEST, "请求需为 JSON 对象")
    req_id = request.get("id")
    method = request.get("method")
    if not isinstance(method, str) or not method:
        return _error_response(req_id, INVALID_REQUEST, "缺少 method")

    if req_id is None:  # 通知：执行但不回复
        try:
            dispatch(method, request.get("params"))
        except (RpcError, ValueError):
            pass
        return None

    try:
        result = dispatch(method, request.get("params"))
    except RpcError as exc:
        return _error_response(req_id, exc.code, exc.message)
    except ValueError as exc:  # 领域校验失败 → 与 HTTP 422 语义一致
        return _error_response(req_id, 422, str(exc))
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _error_response(req_id: Any, code: int, message: str) -> dict[str, Any]:
    """构造错误响应。"""
    resp: dict[str, Any] = {"jsonrpc": "2.0", "error": {"code": code, "message": message}}
    if req_id is not None:
        resp["id"] = req_id
    return resp


def serve(src: BinaryIO, dst: BinaryIO) -> None:
    """逐行读取请求、逐行写回响应，直到 src 结束（EOF）。"""
    for raw in src:
        line = raw.strip()
        if not line:
            continue
        if len(line) > MAX_LINE_BYTES:
            response: dict[str, Any] | None = _error_response(None, INVALID_REQUEST, "请求过大")
        else:
            response = handle_line(line)
        if response is None:
            continue
        dst.write((json.dumps(response, ensure_ascii=False) + "\n").encode("utf-8"))
        dst.flush()


def main() -> None:
    """`python -m omo.rpc` 入口：协议走 stdout，日志走 stderr。"""
    print(f"omo rpc: stdio JSON-RPC 就绪（omo {__version__}；日志见 stderr）", file=sys.stderr)
    serve(sys.stdin.buffer, sys.stdout.buffer)
    print("omo rpc: stdin 已结束，退出", file=sys.stderr)
