# External REST API (Go middleware layer)

> **English** · [中文版](rest.md)

Service entry point: `server/cmd/omopredict`, listening on `:8080` by default (changeable via `OMO_SERVER_ADDR`).

## Health check

### `GET /health`

```json
200 {"status":"ok","version":"0.1.0","time":"2026-08-28T12:07:07Z"}
```

### `GET /version`

```json
200 {"version":"0.1.0","go":"go1.25.0"}
```

### `GET /api/meta` — run mode and capability declaration (no authentication required)

```json
200 {
  "version": "0.1.0",
  "auth_mode": "jwt",          // jwt | none
  "auth_required": true,
  "engine_transport": "http"   // http | stdio
}
```

The frontend reads this endpoint at startup to decide whether to show the login flow: when `auth_required = false` (desktop local mode)
it skips the login page and the route guard, and hides the user information area.

### Run mode: `OMO_AUTH_MODE` (`jwt` is the default | `none`)

| Mode | Applicable to | Behaviour |
|---|---|---|
| `jwt` (default) | Web deployment | Existing behaviour: registration/login issues a JWT; task endpoints require `Authorization: Bearer <token>` |
| `none` | Desktop local build (single-user) | **No authentication**: the authentication middleware injects a fixed local user (`id = username = "local"`), task endpoints need no token; `/api/auth/register` and `/api/auth/login` return **401** (`auth disabled in single-user (local) mode`); `/api/auth/me` returns the local user; a task's `user_id` is always `"local"` |

> ⚠️ `none` should only be injected by the desktop Host (`docs/desktop.md` D10). Setting a web deployment to `none` by mistake amounts to disabling authentication;
> the service startup log explicitly prints the current mode.

There is also `OMO_ENGINE_TRANSPORT` (`http` is the default | `stdio`), which declares the transport of Go→engine;
at present it is only exposed through `/api/meta`, and the stdio transport is delivered in T3.

## User authentication

### `POST /api/auth/register` — registration

Request:

```json
{"username": "alice", "password": "secret123"}
```

| Status code | Meaning |
|---|---|
| `201` | success → `{"id":"<32-digit hex>","username":"alice"}` |
| `400` | invalid username (3-32 characters of `[a-zA-Z0-9_]`) / password too short (<8) / JSON parsing failed |
| `409` | username already exists |

### `POST /api/auth/login` — login (issues a JWT)

Request as above. On success it returns:

```json
200 {
  "token": "<JWT, HS256>",
  "user": {"id": "<32位hex>", "username": "alice"}
}
```

| Status code | Meaning |
|---|---|
| `200` | success (token lifetime defaults to 24h, adjustable via `OMO_JWT_TTL`) |
| `400` | JSON parsing failed |
| `401` | username does not exist or password is wrong |

### `GET /api/auth/me` — current user (authentication required)

Request header: `Authorization: Bearer <token>`

| Status code | Meaning |
|---|---|
| `200` | `{"id":"...","username":"alice"}` |
| `401` | missing / invalid / expired token |

## Simulation / inverse-design tasks (authentication required)

The task type is distinguished by `kind`: `simulate` (forward simulation, the default) | `optimize` (target-driven inverse design, M5 v2).
The state machine is the same: `pending → running → succeeded | failed`.

### `POST /api/tasks` — create a task (asynchronous execution, returns 202 immediately)

**kind=simulate** (the default; request as in M3):

```json
{
  "kind": "simulate",
  "name": "ITO-Ag-ITO",
  "layers": [
    {"material": "ITO", "thickness_nm": 40},
    {"material": "Ag",  "thickness_nm": 10},
    {"material": "ITO", "thickness_nm": 40}
  ],
  "substrate_index": 1.5
}
```

**kind=optimize** (target-driven inverse design: constraint targets → candidate thickness combinations; the parameters are optional, None = engine default):

```json
{
  "kind": "optimize",
  "name": "透明导电设计",
  "optimize": {
    "target": {
      "min_visible_transmittance": 0.85,
      "max_sheet_resistance": 12.0,
      "min_se_db": 25.0,
      "se_freq_range_ghz": [8.2, 12.4]
    },
    "space": {
      "outer_bounds_nm": [20.0, 80.0],
      "outer_step_nm": 4.0,
      "metal_bounds_nm": [5.0, 20.0],
      "metal_step_nm": 1.0,
      "outer_material": "ITO",
      "metal_material": "Ag",
      "substrate_index": 1.5,
      "top_n": 10
    },
    "compute_sensitivity": true
  }
}
```

| Status code | Meaning |
|---|---|
| `202` | accepted: the task is created (pending) and is executing asynchronously → `{"id":"<32-digit hex>","kind":"optimize","status":"pending",...}` |
| `400` | invalid `kind`; simulate is missing `layers` / it is empty; optimize is missing the `optimize` parameters; invalid JSON |
| `401` | not authenticated |

### `GET /api/tasks/{id}` — query task status and result (own tasks only)

| Status code | Meaning |
|---|---|
| `200` | the task; when `succeeded` it contains a result depending on the kind: simulate → `result` (`transmittance` / `reflectance` / `sheet_resistance` / `se_db`); optimize → `optimize_result` (the engine's inverse-design report verbatim: `n_scanned` / `n_feasible` / `candidates` / `sensitivity` and so on, including the top-level `task_id`) |
| `404` | the task does not exist or is not the caller's (uniform 404, does not leak existence) |
| `401` | not authenticated |

### `GET /api/tasks` — list the current user's tasks (newest first)

```json
200 {"tasks": [{"id":"...","kind":"optimize","status":"succeeded",...}, ...]}
```

### `DELETE /api/tasks/{id}` — delete a task (own tasks only)

The task and its result are deleted together (simulate's `result` and optimize's `optimize_result` belong to the same row).

```json
200 {"id": "<32位hex>", "deleted": true}
```

| Status code | Meaning |
|---|---|
| `200` | deleted successfully |
| `404` | the task does not exist or is not the caller's (uniform 404, does not leak existence) |
| `401` | not authenticated (`jwt` mode) |

### Task curl demonstration

```bash
# Create a simulation task (asynchronous, kind defaults to simulate)
CREATE=$(curl -s -X POST http://127.0.0.1:8080/api/tasks \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"layers":[{"material":"ITO","thickness_nm":40},{"material":"Ag","thickness_nm":10},{"material":"ITO","thickness_nm":40}]}')
TASK_ID=$(echo "$CREATE" | jq -r .id)

# Create an inverse-design task (kind=optimize)
CREATE=$(curl -s -X POST http://127.0.0.1:8080/api/tasks \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"kind":"optimize","optimize":{"target":{"min_visible_transmittance":0.85,"max_sheet_resistance":12.0}}}')
TASK_ID=$(echo "$CREATE" | jq -r .id)

# Poll for the result
curl -s http://127.0.0.1:8080/api/tasks/$TASK_ID -H "Authorization: Bearer $TOKEN" | jq
```

> Task execution is carried out by the Go service asynchronously calling the Python engine: simulate → `omo.api /simulate`,
> optimize → `omo.api /optimize` (contract see [`engine.md`](engine.md));
> the engine address is configured through `OMO_ENGINE_URL`.

## curl demonstration

```bash
# Register
curl -X POST http://127.0.0.1:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"secret123"}'

# Log in to get a token
TOKEN=$(curl -s -X POST http://127.0.0.1:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"secret123"}' | jq -r .token)

# Access a protected endpoint with the token
curl http://127.0.0.1:8080/api/auth/me -H "Authorization: Bearer $TOKEN"
```

## Error conventions

- Error body: `{"error": "<message>"}`
- 4xx: client-side problems (parameters/authentication/conflict); 5xx: server-side problems (a panic is caught by middleware and turned into 500)

## Implementation locations

- Routes and middleware: `server/internal/api/` (`router.go`, `auth.go`, `middleware.go`)
- Business logic: `server/internal/user/` (`service.go`: bcrypt + JWT; `store.go`: GORM storage)
- Tests: `server/internal/api/*_test.go`, `server/internal/user/*_test.go`
