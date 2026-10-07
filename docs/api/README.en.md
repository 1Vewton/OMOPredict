# API design and data contracts (docs/api)

> **English** · [中文版](README.md)

Interface contract documents of the OMOPredict three-layer architecture:

```
┌────────────┐  REST/JSON   ┌─────────────────┐   HTTP   ┌──────────────────┐
│  Vue3+TS   │ ───────────▶ │       Go        │ ───────▶ │ Python (FastAPI) │
│Frontend UI │ ◀─────────── │ user/store/task │ ◀─────── │  physics engine  │
└────────────┘              └─────────────────┘          └──────────────────┘
```

| Document | Contents |
|---|---|
| [`rest.md`](rest.md) | **External REST API** (Go middleware layer, web form): authentication endpoints, run mode (`/api/meta`), request/response examples, error codes, curl demonstration |
| [`engine.md`](engine.md) | **Engine contract** (Go → Python `omo.api /simulate`, `/optimize`): request/response, material registry, default grids |
| [`rpc.md`](rpc.md) | **stdio JSON-RPC contract** (desktop form: Electron ↔ Go): protocol, mapping between methods and HTTP endpoints, error codes, single-user mode |

## Common conventions (all interfaces)

- **JSON fields in snake_case** (such as `thickness_nm`, `sheet_resistance`), consistent with the Python engine contract
- **Units are stated next to the field**: nm, Ω/sq, dB, GHz
- **Error responses** are uniformly `{"error": "<message>"}`; the semantics of the status codes are given per interface
- **Timestamps**: unix seconds (tasks) / RFC3339 UTC (health check)
- **Authentication**: after login a JWT (HS256) is obtained; subsequent requests carry `Authorization: Bearer <token>`
- **Layering discipline**: the Go layer only performs orchestration and persistence, it contains no physics formulas (AGENTS.md §6.6)

## Configuration (server/.env, template .env.example)

| Variable | Default | Description |
|---|---|---|
| `OMO_SERVER_ADDR` | `:8080` | Go service listen address (HTTP form) |
| `OMO_DB_DRIVER` | `sqlite` | `sqlite` \| `mysql` \| `postgres` |
| `OMO_DB_DSN` | `omopredict.db` | Database connection string |
| `OMO_JWT_SECRET` | development default (must be set in production) | JWT signing secret (`jwt` mode) |
| `OMO_JWT_TTL` | `24h` | Token lifetime |
| `OMO_ENGINE_URL` | `http://127.0.0.1:8000` | Python engine address (HTTP engine transport) |
| `OMO_AUTH_MODE` | `jwt` | `jwt` (web) \| `none` (desktop single-user, ownership fixed to `local`) |
| `OMO_ENGINE_TRANSPORT` | `http` | `http` (current implementation) \| `stdio` (desktop, delivered in T4) |

Command line: `omopredict --stdio` runs in the stdio JSON-RPC form (requires `OMO_AUTH_MODE=none`, contract see [`rpc.md`](rpc.md)).
