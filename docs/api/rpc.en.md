# stdio JSON-RPC contract (desktop build: Electron ↔ Go middleware layer)

> **English** · [中文版](rpc.md)

> Applicable form: the desktop build (docs/desktop.md D11). Web deployments still use HTTP (see [`rest.md`](rest.md)).
> Implementation: `server/internal/rpc/`; startup: `omopredict --stdio` (requires `OMO_AUTH_MODE=none`).

## 1. Protocol

- **JSON-RPC 2.0**, **newline-delimited (JSON-Lines)**: one JSON object per line, UTF-8 byte stream.
- **stdout carries the protocol only**; logs always go to stderr (including GORM/SQL logs — see the notes in §5).
- the per-line limit is 16 MiB (an `optimize` report can reach several hundred KB).
- **a line without an id is treated as a notification**: executed but not answered.

```
request: {"jsonrpc":"2.0","id":1,"method":"tasks.create","params":{...}}
success: {"jsonrpc":"2.0","id":1,"result":{...}}
failure: {"jsonrpc":"2.0","id":1,"error":{"code":400,"message":"layers 至少需要一层"}}
```

## 2. Methods ↔ HTTP endpoints (payload field-for-field identical)

| RPC method | HTTP equivalent | Parameters | Result |
|---|---|---|---|
| `ping` | `GET /health` | none | `{"status":"ok","version":"0.1.0"}` |
| `meta` | `GET /api/meta` | none | `{version, auth_mode, auth_required, engine_transport}` |
| `tasks.create` | `POST /api/tasks` | same as the HTTP request body | the newly created task object (`status=pending`) |
| `tasks.list` | `GET /api/tasks` | none | `{"tasks":[...]}` |
| `tasks.get` | `GET /api/tasks/{id}` | `{"id":"<32hex>"}` | task object (including the result) |
| `tasks.delete` | `DELETE /api/tasks/{id}` | `{"id":"<32hex>"}` | `{"id":"...","deleted":true}` |
| `auth.register` / `auth.login` / `auth.me` | `/api/auth/*` | — | **web (jwt) mode only**; stdio is fixed to single-user and returns 401 `auth disabled in single-user (local) mode` |

**Payload consistency** is guaranteed by tests: `server/internal/rpc/contract_test.go` executes the same request through HTTP and through RPC respectively, and
asserts that `meta`, `tasks.create` (simulate and optimize), the validation error messages, the 404 message and the delete response structure are completely identical.

### Request/response examples

```json
{"jsonrpc":"2.0","id":1,"method":"tasks.create","params":{
  "kind":"simulate","name":"ITO-Ag-ITO",
  "layers":[{"material":"ITO","thickness_nm":40},
            {"material":"Ag","thickness_nm":10},
            {"material":"ITO","thickness_nm":40}]}}
```

```json
{"jsonrpc":"2.0","id":1,"result":{"id":"9c1f...","kind":"simulate","user_id":"local",
  "stack":{"name":"ITO-Ag-ITO","layers":[...]},"status":"pending","created_at":1757600000}}
```

For a task with `kind=optimize`: `optimize_result` is the engine's inverse-design report verbatim (`n_scanned`/`n_feasible`/`candidates`/`sensitivity`).

## 3. Error codes

**Application errors follow the semantics of HTTP status codes** (so that the frontend can reuse the error handling of HTTP mode):

| code | Meaning | Typical scenario |
|---|---|---|
| `400` | invalid request | invalid `kind`, simulate missing `layers`, optimize missing parameters, missing `id` |
| `401` | not authenticated | `auth.*` methods (stdio is fixed to single-user, authentication is off) |
| `404` | not found | the task does not exist or is not the caller's (uniform 404, does not leak existence) |
| `500` | server error | storage layer failure |

**Protocol errors use JSON-RPC reserved codes**:

| code | Meaning |
|---|---|
| `-32700` | JSON parse failure |
| `-32600` | invalid request (missing `method`) |
| `-32601` | method not found |
| `-32602` | invalid params (including unknown fields — strict parsing, so that typos are not silently ignored) |

## 4. Authentication and single-user mode

The stdio transport has **no HTTP headers** and cannot carry a Bearer token, so it is fixed to single-user local mode:

- it requires `OMO_AUTH_MODE=none`; if it is started with `--stdio` while the mode is `jwt`, **the process errors out and exits** (no silent degradation).
- all tasks belong to a fixed user (`user_id = "local"`) and need no credentials whatsoever.
- `auth.*` methods always return 401 (consistent with the behaviour of HTTP none mode).

## 5. Notes (implementation constraints)

1. **stdout may contain protocol data only**: any library printing to stdout (such as the default GORM logging) would break JSON-Lines.
   This project has already routed the GORM logs to stderr (`store.Config.LogWriter`, default `os.Stderr`),
   guarded by the regression test `TestGORMLoggerUsesConfiguredWriter`.
2. **After the parent process closes stdin**, a task that is executing loses its host process and stays in `pending`/`running`
   (the desktop Host keeps the pipe open; for the cleanup strategy in abnormal-exit scenarios see docs/desktop.md §12).
3. the per-line limit is 16 MiB; the read buffers on both sides need to be enlarged (handled likewise on the Host side).
4. the protocol and HTTP share the same service layer and request DTOs (`task.CreateRequest`, `task.Service.GetOwned/DeleteOwned`);
   when adding methods, this document and `contract_test.go` should be updated in step.
