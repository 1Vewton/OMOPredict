# API 设计与数据契约（docs/api）

OMOPredict 三层架构的接口契约文档：

```
┌────────────┐  REST/JSON   ┌──────────────┐   HTTP   ┌──────────────────┐
│  Vue3+TS   │ ────────────▶ │     Go       │ ───────▶ │  Python (FastAPI)│
│  前端 UI   │ ◀──────────── │ 用户/存储/任务│ ◀─────── │  物理仿真引擎     │
└────────────┘               └──────────────┘          └──────────────────┘
```

| 文档 | 内容 |
|---|---|
| [`rest.md`](rest.md) | **对外 REST API**（Go 中间层）：认证接口、请求/响应示例、错误码、curl 演示 |
| [`engine.md`](engine.md) | **引擎契约**（Go → Python `omo.api /simulate`）：请求/响应、材料注册表、默认网格 |

## 通用约定（所有接口）

- **JSON 字段 snake_case**（如 `thickness_nm`、`sheet_resistance`），与 Python 引擎契约一致
- **单位随字段标注**：nm、Ω/sq、dB、GHz
- **错误响应**统一为 `{"error": "<消息>"}`；状态码语义见各接口
- **时间戳**：unix 秒（任务）/ RFC3339 UTC（健康检查）
- **认证**：登录后获得 JWT（HS256），后续请求带 `Authorization: Bearer <token>`
- **分层纪律**：Go 层只做编排与存储，不含物理公式（AGENTS.md §6.6）

## 配置（server/.env，模板 .env.example）

| 变量 | 默认 | 说明 |
|---|---|---|
| `OMO_SERVER_ADDR` | `:8080` | Go 服务监听地址 |
| `OMO_DB_DRIVER` | `sqlite` | `sqlite` \| `mysql` \| `postgres` |
| `OMO_DB_DSN` | `omopredict.db` | 数据库连接串 |
| `OMO_JWT_SECRET` | 开发默认（生产必须设置） | JWT 签名密钥 |
| `OMO_JWT_TTL` | `24h` | 令牌有效期 |
| `OMO_ENGINE_URL` | `http://127.0.0.1:8000` | Python 引擎地址（任务编排用，规划中） |
