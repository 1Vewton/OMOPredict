# omo.api —— FastAPI 服务（M3 已实现，供 Go 中间层调用）

## 职责

把物理引擎封装成 HTTP 服务，供 Go 中间层调用（见 AGENTS.md 架构图）：

- 接收膜结构（材料 + 厚度）→ 调用物理引擎 → 返回 T(λ) / Rs / SE(f)
- **只做请求/响应封装，不含物理逻辑**（分层纪律，AGENTS.md §6.6）

## 已实现模块

| 模块 | 职责 |
|---|---|
| `schemas.py` | Pydantic 请求/响应模型（snake_case；`SimulateRequest` / `SimulateResponse`） |
| `service.py` | `run_simulation`：编排光学（TMM）+ 电学（方阻）+ 屏蔽（SE）；无导电层时 Rs=null |
| `main.py` | FastAPI 应用：`POST /simulate`、`GET /health` |

## 启动与接口

```bash
uv run uvicorn omo.api.main:app --port 8000
```

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/simulate` | 提交膜结构，返回 T(λ) / Rs / SE(f)（同步） |
| GET | `/health` | 健康检查 |

```bash
curl -X POST http://127.0.0.1:8000/simulate \
  -H "Content-Type: application/json" \
  -d '{"layers":[{"material":"ITO","thickness_nm":40},{"material":"Ag","thickness_nm":10},{"material":"ITO","thickness_nm":40}]}'
```

默认输出网格：波长 380–1000 nm（步长 10）、频率 1–18 GHz（步长 1）；
请求可传 `wavelengths_nm` / `freqs_ghz` 覆盖。非法输入（未知材料、空膜层、负厚度）→ 422。

## 约定

- 字段命名 snake_case；单位随字段标注（nm、Ω/sq、dB）
- 材料名解析走共享注册表 `omo.materials.MaterialResolver`（与 benchmark 同源）
- 物理逻辑一律调用 omo 其余子包，禁止在本包内复制公式
- 异步任务（`GET /tasks/{id}`）待 Go 侧任务编排落地后按需加入

## 验证

- `tests/test_api.py`：/health、/simulate 与引擎直算跨验（1e-9）、自定义网格、
  未知材料/空层/负厚度 422、纯绝缘层 Rs=null
