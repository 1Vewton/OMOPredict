# omo.api —— FastAPI 服务（供 Go 中间层调用）

## 职责

把物理引擎封装成 HTTP 服务，供 Go 中间层调用（见 AGENTS.md 架构图）：

- 接收仿真任务（膜结构 + 参数）→ 调用物理引擎 → 返回性能结果
- **只做请求/响应封装与任务编排，不含物理逻辑**（分层纪律）

## 核心模块（计划，M3 接入）

- `main.py`：FastAPI 应用与路由
- `schemas.py`：请求/响应模型（JSON 字段 snake_case）

## 计划接口（M3 落地后生效）

```bash
uv run uvicorn omo.api.main:app --port 8000
```

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/simulate` | 提交膜结构，返回 T / Rs / SE 结果 |
| GET | `/tasks/{id}` | 查询异步任务状态与结果 |
| GET | `/health` | 健康检查 |

## 约定

- 字段命名：snake_case；单位随字段明确标注（nm、Ω/sq、dB）
- 物理逻辑一律调用 omo 其余子包，禁止在本包内复制公式
