# server — Go middleware layer (M3 complete; M5 v2 adds optimize; M6-a adds single-user mode and stdio RPC)

> **English** · [中文版](README.md)

User management (or local single-user mode) / data persistence / simulation task orchestration, exposing a REST API and stdio JSON-RPC.

## Structure (standard Go layout)

```
server/
├── cmd/omopredict/        # main entry point (HTTP service; --stdio runs stdio JSON-RPC; graceful exit)
├── .env.example           # configuration template (copy to .env; .env is gitignored)
└── internal/
    ├── api/               # REST routes and middleware (health check, auth, tasks, /api/meta)
    ├── mode/              # run-mode parsing (OMO_AUTH_MODE=jwt|none, OMO_ENGINE_TRANSPORT=http|stdio)
    ├── model/             # data models (film stack, simulation task kind=simulate|optimize, results) — snake_case JSON
    ├── rpc/               # stdio JSON-RPC dispatcher (desktop form) + http↔rpc contract-consistency test
    ├── store/             # database layer: GORM open (sqlite/mysql/postgres) + auto-migration + .env config
    ├── store/storetest/   # in-memory SQLite helper for tests (OpenMemory)
    ├── user/              # user registration/login + JWT (GORM store + bcrypt + JWT)
    └── task/              # task orchestration: lifecycle + calls to the Python engine (simulate|optimize asynchronous)
```

## API

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/version` | Service version (including the Go version) |
| GET | `/api/meta` | **Capability endpoint**: `{version, auth_mode, auth_required, engine_transport}` (the frontend decides from it whether to show login) |
| POST | `/api/auth/register` | Registration (username 3-32 characters [a-zA-Z0-9_], password ≥8 characters) |
| POST | `/api/auth/login` | Login, returns `{token, user}` (JWT HS256) |
| GET | `/api/auth/me` | Current user (requires `Authorization: Bearer <token>`) |
| POST | `/api/tasks` | Create a task (**asynchronous** execution, returns 202; `kind=simulate` (default) \| `optimize`) |
| GET | `/api/tasks` | List the current user's tasks (newest first) |
| GET | `/api/tasks/{id}` | Query task status and result (owner only, asynchronous polling) |
| DELETE | `/api/tasks/{id}` | Delete a task (including results); ownership check, with nonexistent or non-owner uniformly 404 |

> Complete request/response examples, error codes and curl demonstrations are in **`docs/api/rest.md`**;
> the Go → Python engine contract is in **`docs/api/engine.md`**;
> the stdio JSON-RPC contract of the desktop form is in **`docs/api/rpc.md`**.
>
> With `OMO_AUTH_MODE=none` the auth middleware injects a fixed user directly (`user_id="local"`) and does not read `Authorization`;
> the `auth.*` endpoints return 401 in that mode (the stdio transport is fixed to single-user mode).

## Configuration (.env or environment variables)

Configuration is written in `server/.env` (template in `.env.example`, gitignored) or in environment variables;
precedence: real environment variables > .env > defaults.

| Variable | Default | Description |
|---|---|---|
| `OMO_DB_DRIVER` | `sqlite` | Database driver: `sqlite` \| `mysql` \| `postgres` |
| `OMO_DB_DSN` | `omopredict.db` | Connection string (per-driver formats in `.env.example`) |
| `OMO_SERVER_ADDR` | `:8080` | Listen address |
| `OMO_JWT_SECRET` | Development default (**must be set in production**) | JWT signing secret |
| `OMO_JWT_TTL` | `24h` | Token validity period (Go duration format) |
| `OMO_ENGINE_URL` | `http://127.0.0.1:8000` | Python engine address (task orchestration calls `/simulate`, `/optimize`) |
| `OMO_AUTH_MODE` | `jwt` | Auth mode: `jwt` (Web, multi-user) \| `none` (desktop, single-user `user_id="local"`) |
| `OMO_ENGINE_TRANSPORT` | `http` | Engine transport: `http` (Web, together with `OMO_ENGINE_URL`) \| `stdio` (desktop, together with `OMO_ENGINE_CMD`, **no listening port**) |
| `OMO_ENGINE_CMD` | — | Engine launch command for the desktop form (supports paths containing spaces wrapped in quotes); when absent, discovered automatically in the D9 order |
| `OMO_ENGINE_PROJECT` | — | Engine project directory (containing `pyproject.toml`), used for `uv`/`python` launching and as the child-process working directory; when absent, inferred as `resources/engine` |
| `OMO_ENGINE_TIMEOUT` | `60s` | Timeout of a single engine call (Go duration); large-scale grid inverse design needs a larger value (such as `10m`) |
| `OMO_LOG_DIR` | — | Log directory (if unset, output goes to stderr, preserving existing behaviour) |

> **Engine transport (`OMO_ENGINE_TRANSPORT`)**:
> - `http` (default): Go calls `OMO_ENGINE_URL` (the engine is started with `uvicorn omo.api`) — web/development form.
> - `stdio`: Go starts the engine as a parent process (`python -m omo.rpc` or the full-package sidecar), using stdio JSON-RPC 2.0,
>   **with no listening port at any point** — desktop form (docs/desktop.md D11/§10.6, measured to be satisfied).
>   The launch command is resolved in the order `OMO_ENGINE_CMD` → `resources/engine/omo-rpc[.exe]` → `uv run --frozen --project <engine>` →
>   PATH `python`/`python3`/`py` (`internal/task/engine_resolve.go`);
>   **if resolution fails it exits at startup and prints guidance**, and does not silently fall back to HTTP.
>   The request/response payloads of the two transports are **field-for-field identical** (`Engine` interface + shared `simulateParams`),
>   and a test guards that the "stdio↔HTTP payloads are byte-for-byte identical".
>
> When started with `--stdio`, `OMO_AUTH_MODE=none` is **mandatory**, otherwise the process errors out immediately (no silent downgrade);
> in that mode stdout may contain only JSON-RPC lines, and both GORM logs and engine logs go to stderr (guarded by a regression test).

Storage is based on **GORM** (`gorm.io/gorm`): SQLite uses a pure-Go driver (`glebarez/sqlite`, compatible with
CGO_ENABLED=0 environments); to switch to MySQL / PostgreSQL it is enough to change `OMO_DB_DRIVER` + DSN,
and the table schema is migrated automatically by `store.Migrate`.

## Common commands

```bash
cd server
go build ./...     # build
go test ./...      # test
go vet ./...       # static analysis
go run ./cmd/omopredict   # start (defaults to :8080, reads .env)
```

> Network note for mainland China: the default Go module proxy proxy.golang.org may be unreachable;
> it is recommended to set `$env:GOPROXY = "https://goproxy.cn,direct"` before pulling dependencies.

### Test-speed conventions (please follow these for new tests)

- **In-memory SQLite**: tests uniformly use `storetest.OpenMemory(t, models...)` (`internal/store/storetest`) —
  an in-process private in-memory database with no disk writes and no file locks, about 24% faster than a temporary-file database (api package 2.10s → 1.59s).
  The production behaviour of the file DSN is guaranteed by `internal/store`'s own tests (`TestOpenSQLiteAndMigrate`, `TestOpenMemorySQLite`).
- **`t.Parallel()`**: added to every case that shares no state (59 places in this project). Note that
  `t.Setenv` and `t.Parallel()` are mutually exclusive (it panics) — the `store` package's configuration-parsing cases therefore stay serial.
- **bcrypt cost**: tests use `user.WithBcryptCost(bcrypt.MinCost)` (still going through the full hash/verify path,
  but cutting each call from ~60ms to ~1ms); production keeps `bcrypt.DefaultCost`.
- **Asynchronous task polling**: `waitForTask` / `waitSucceeded` check immediately first, then poll at a 5ms interval (do not use a fixed `sleep`).
- **Measurement caveat**: in this sandbox, capturing the output of `go test -v` through a PowerShell pipeline significantly inflates the measured time
  (the api package was once mis-measured at 9.6s against an actual 1.9s); to measure speed use `go test ./... -count=1` and time the wall clock.
  Also note that starting each test binary costs about 0.2–0.3s in this sandbox (this does not exist on CI), so a single-package result includes this fixed overhead.

**Reference results** (this machine, warm cache): the full `go test ./... -count=1` ≈ 1.9–2.6s;
`go test ./internal/api ./internal/rpc -count=3` (really executing 6 rounds) takes only 0.26s / 0.19s
— that is, test execution itself is already close to zero cost, and the wall clock consists mainly of compilation and process startup.

## Layering discipline (AGENTS.md §6.6)

- This layer **contains no physics formulas**: physics logic lives only in the Python engine (`engine/`). This layer calls the engine through the `Engine` interface,
  and the two transports implement the same contract: HTTP → `omo.api` (FastAPI), stdio → `omo.rpc` (desktop, no listening port);
- the frontend communicates only with this service; JSON fields are snake_case, consistent with the Python engine contract;
- the HTTP handlers and the RPC dispatcher **share the same service layer** (`task.CreateRequest`, `task.Service.GetOwned/DeleteOwned`),
  so when adding a method, `docs/api/` and `internal/rpc/contract_test.go` must be updated in step.

## Current status

- ✅ **M3**: health check `/health`, `/version`, middleware (logging + panic fallback); data models
  (FilmStack / SimulationTask / TaskResult); user system (register / login / JWT, GORM-compatible with
  sqlite/mysql/postgres); task orchestration (`POST /api/tasks` asynchronously → calls the engine `/simulate` → persistence),
  end-to-end smoke test passed (Go → uvicorn engine → T/Rs/SE returned)
- ✅ **M5 v2**: task model generalised to `kind=simulate|optimize` + `OptimizeSpec` parameter column +
  `optimize_result` (the engine report is persisted as-is, with `task_id` injected at the top level); `EngineClient.Optimize`
- ✅ **M6-a T1–T3**: single-user mode (`OMO_AUTH_MODE=none` + `GET /api/meta`),
  `DELETE /api/tasks/{id}`, the stdio JSON-RPC dispatcher (`internal/rpc` + `omopredict --stdio`,
  error codes following HTTP semantics, 12 rpc cases + 5 contract-consistency cases)
- ✅ **M6-a T4.5**: Go→engine **stdio transport** (`internal/task/engine_stdio.go` + `engine_resolve.go`):
  the `Engine` interface unifying HTTP/stdio, `StdioEngine` lazy child process + id correlation + timeout + graceful shutdown,
  D9 levels 1–4 engine discovery, `OMO_ENGINE_TRANSPORT/OMO_ENGINE_CMD/OMO_ENGINE_PROJECT/OMO_ENGINE_TIMEOUT`;
  12 new cases (including a fake engine as a real child process and payload consistency) + an end-to-end smoke test confirming **no listening port**
- ⏳ **To do**: `omo-cli simulate`; the Host layer's D9 level-5 friendly error dialog and D5 health check / rate-limited restart (T6)
