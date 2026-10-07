# OMOPredict Desktop Version Design (Design Doc)

> **English** · [中文版](desktop.md)

> Status: **pending review (3rd draft)** — settled: **Electron shell** + **single-user (no user management)** + **no network transport (IPC/stdio)** + **Go retained as the task-management layer** + **dual distribution forms**
> Target milestone: M6 extension (local distribution form)
> Related conventions: AGENTS.md §2 (three-layer architecture), §6.6 (layering discipline: physics logic only in the Python layer),
> docs/HANDOVER.md (current startup methods and environment pitfalls)

---

## 0. Review decision record

| Topic | Decision | Key implication |
|---|---|---|
| Desktop shell | **Electron** | Ships its own Chromium (no WebView2 dependency), Node toolchain already available; the cost is a shell size of ~120–180MB |
| User management | **Dropped in the desktop version** | Single-user local application: no login/registration/JWT; implemented through a run-mode switch, not by deleting code (D10) |
| Data exchange | **No network use (hard requirement)** | No more loopback HTTP/ports between components: renderer process ↔ main process go through Electron IPC, main process ↔ Go ↔ Python go through **stdio JSON-RPC** (D11) |
| Middleware-layer responsibility | **Go retained as the "task-management layer"** | Task creation/list/query/delete + result persistence (SQLite); avoids rewriting a whole set of task logic on the Python side |
| Task-management capability | **Includes delete** | Adds `DELETE /api/tasks/{id}` and the RPC `tasks.delete`; the frontend history page provides delete |
| Engine packaging (full package) | **PyInstaller onedir, excluding torch/fastapi/uvicorn** | The desktop entry no longer starts an HTTP service → fewer dependencies and faster startup (D4) |
| Distribution forms | **Full package + lightweight package (bring your own Python)** | Both share the same dist / Go binaries; only the engine source differs (D9) |
| Out of scope this cycle | Portable mode, tray residency, code signing, auto-update | Reserved in the design, see §12 |

---

## 1. Goals and non-goals

### Goals
1. **Double-click and go**: Windows first; a full-package user machine needs no pre-installed Python / Go / Node.
2. **Purely local, no network**: the application **does not listen on any port** while running; components communicate through in-process IPC and stdio pipes; usable offline.
3. **Single-user straight through**: no login page / no account concept, the design page is entered on startup; a "task" is the only data entity.
4. **Zero feature divergence**: shares the same frontend `dist`, engine and middleware-layer code with the web version; the only differences are the run mode and the transport adapter.
5. **Dual-form distribution**: full package (engine built in, ready out of the box) and lightweight package (bring your own Python, ≤150MB).

### Non-goals (out of scope this cycle)
- macOS / Linux packaging (the architecture is reserved, Windows only for now).
- Auto-update, code signing, tray residency, portable mode (§12).
- Desktop NN surrogate acceleration (torch is excluded; the web version and the "bring your own Python" lightweight package are not restricted).
- Static hosting of the web version (the `internal/web` embed approach of the 2nd draft becomes optional, see §12).

---

## 2. Current state and constraints

| Component | Current state | Desktop requirement |
|---|---|---|
| Frontend | Vue3+TS+Vite; `http.ts` uses `fetch` against relative paths `/api/...`; login guard + auth store | Add a **transport abstraction** (http / ipc, one of the two) and **capability gates** (hide login in unauthenticated mode) |
| Go middleware layer | REST `/api/*` (net/http) + GORM/SQLite + JWT + task orchestration; `EngineClient` calls the engine over HTTP | Add a **stdio RPC transport** and **single-user mode**; make the engine call a switchable stdio child process; add task deletion |
| Python engine | FastAPI `omo.api` (`/simulate`, `/optimize`); orchestration lives in `omo.api.service` | Add a **stdio RPC entry** (no HTTP); sink the orchestration into a module that does not depend on FastAPI; split optional dependencies (torch/matplotlib/fastapi/uvicorn can all be excluded) |
| Data | `server/.env` + `omopredict.db` (relative path) | Migrate to the user data directory (D6); in single-user mode uniformly `user_id = "local"` |
| Contract | `docs/api/rest.md` (external), `docs/api/engine.md` (Go→engine) | The **same JSON payload** serves both HTTP and RPC (single contract source, D11 + contract-consistency test) |

**Hard constraints**: physics logic must not be copied into the shell/Go/frontend (AGENTS §6.6); the desktop version must not change simulation numerical results.

---

## 3. Overall architecture (no network)

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Electron                                                                                                       │
│  ├─ Renderer process: existing Vue frontend (dist, loaded via the custom protocol app://)                      │
│  │     Transport: window.omo.rpc(method, params)   ← no fetch / no HTTP                                        │
│  ├─ preload (contextIsolation, minimal exposure)                                                               │
│  └─ Main-process Host layer (desktop/src/host/) + shell logic (desktop/src/shell/)                             │
│        First run initialization → data directory/secrets → spawn the Go child process → single-instance lock   │
│        → menu (About / Data directory / Logs / Diagnostics) → on exit reclaim the process tree (Job Object)    │
│            ⇅ stdio JSON-RPC 2.0 (newline-delimited)                                                            │
├────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Go task-management layer (omopredict-server.exe --stdio)                                                       │
│ · Single-user mode: OMO_AUTH_MODE=none → fixed local user (user_id="local")                                    │
│ · RPC methods: meta / ping / tasks.create|list|get|delete                                                      │
│ · SQLite (user data directory); no port, no HTTP (desktop mode)                                                │
│            ⇅ stdio JSON-RPC 2.0 (Go is the parent process, spawning and supervising the engine)                │
├────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Python engine (omo-rpc: a JSON-Lines loop reading stdin)                                                       │
│ · Methods: ping / simulate / optimize (payloads identical to /simulate, /optimize)                             │
│ · No FastAPI/uvicorn (the desktop entry does not import them; packaging excludes them accordingly)             │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Web / development mode** (unchanged): browser → Vite proxy → Go (HTTP + JWT multi-user) → engine (HTTP `omo.api`).
The two modes **share** the same frontend source, Go service layer, engine physics code and JSON payloads; only the transport and authentication modes differ.

---

## 4. Key design decisions

### D1 Desktop shell: **Electron** (decided)

| Dimension | Electron (selected) | Tauri 2 (alternative) |
|---|---|---|
| Shell size | ~120–180MB | ~8–15MB |
| Runtime dependency | Ships its own Chromium, best environment consistency | Depends on WebView2 (old Win10 needs a bootstrapper) |
| Toolchain | Node only (nothing new) | Needs Rust + cargo (CI +5–10min) |
| IPC/child process | Native `ipcMain`/`child_process` | `externalBin` + shell plugin |
| Conclusion | Lowest risk, consistent with the existing toolchain | Switch only if "package under 150MB" becomes a hard requirement |

The shell's capabilities are converged in the Host layer, which exposes only: `spawnBackend()` / `invokeRpc(method, params)` /
`openWindow()` / `shutdown()`; business logic and scripts depend only on this layer's interface.

### D10 Single-user mode (user management dropped)

- **Run mode**: `OMO_AUTH_MODE = none | jwt` (desktop `none`, web `jwt`; the default `jwt` keeps backward compatibility).
- **Middleware behaviour**: in `none` mode the authentication middleware directly injects the fixed user `{ID: "local", Username: "local"}`,
  does not read `Authorization` and does not query the users table; all task endpoints work as usual.
- **Capability endpoint**: adds `meta` (HTTP `GET /api/meta` / RPC `meta`) returning
  `{auth_required: false, mode: "desktop", version, engine_transport}`, for the frontend to decide with.
- **Frontend gates**: `meta` is read at startup:
  - `auth_required === false` → the route guard lets all pages through, `/login` redirects to `/design`,
    the "username/logout" items and the login-page entry are hidden; the top bar shows a "local mode" marker
  - `auth_required === true` (web) → the existing login flow is kept
  - the `meta` request fails (network/transport error) → by default treat it as "authentication required", to avoid letting requests through by mistake
- **auth store**: adds the `authRequired` state; in unauthenticated mode `isAuthenticated` is always true (the token does not take part).
- **Data consistency**: `SimulationTask.UserID = "local"`, the table schema is unchanged (the same table keeps working for the web version).

### D11 Network-free data exchange: Electron IPC + stdio JSON-RPC (decided)

**Protocol**: JSON-RPC 2.0, **newline-delimited (JSON-Lines)**, UTF-8 byte stream (not going through console encoding, avoiding the GBK pitfall).

- Request: `{"jsonrpc":"2.0","id":1,"method":"tasks.create","params":{...}}`
- Success: `{"jsonrpc":"2.0","id":1,"result":{...}}`
- Failure: `{"jsonrpc":"2.0","id":1,"error":{"code":401,"message":"invalid username or password"}}`
  —— `code` **reuses HTTP status-code semantics**, so frontend error handling (401 logout, 409 conflict prompt, etc.) needs no rewrite
- Notification (optional): `{"jsonrpc":"2.0","method":"progress","params":{"req_id":1,"done":500,"total":4096}}`

**Three link segments**:
1. Renderer process → main process: `ipcRenderer.invoke('omo:rpc', method, params)` (exposed by the preload whitelist)
2. Main process → Go: `child_process.spawn` + a stdin/stdout line protocol (the Host layer maintains the `id ↔ Promise` mapping)
3. Go → Python: Go spawns the engine as the parent process (`OMO_ENGINE_CMD` or auto-discovery), same line protocol

**Payload consistency**: the RPC `params`/`result` are **field-for-field identical** to the existing REST request/response bodies
(e.g. the `tasks.create` params are the `POST /api/tasks` request body; the `simulate` params are the `/simulate` request body).
Therefore `docs/api/rest.md` and `docs/api/engine.md` are the RPC contract documents; the "method ↔ endpoint" mapping table is added in §5.

**Why not let Go keep using HTTP and only switch the frontend to IPC**: that would still require a locally listening port and an HTTP surface;
the hard requirement is "no network", so all three link segments drop HTTP.

**CSP (renderer process)**: `default-src 'self' app:; connect-src 'none'; script-src 'self'`
—— the renderer process is allowed no network connection at all, only IPC.

### D2 How frontend assets are loaded: **the custom protocol `app://` + dist bundled into Electron**

- `dist` is bundled into the application resources by electron-builder; the main process uses `protocol.handle('app', …)` to serve
  `app://omo/index.html` and static assets, and falls back to `index.html` for unknown paths (keeping `createWebHistory` routing unchanged).
- `file://` is not used (it would require switching to hash routing, and relative paths and the SPA fallback are both awkward).
- The Go side **does not need** to embed dist any more (the `internal/web` of the 2nd draft becomes an optional item for web deployment, see §12).

### D3 Middleware-layer responsibility: **Go is retained as the task-management layer** (decided)

Task creation → engine call → result persistence → list/query/delete all stay in Go; in single-user mode the only difference is that there is "no user dimension".
Dropping Go would mean rewriting the task lifecycle and storage on the Python side (two implementations), which conflicts with the single-implementation discipline.

### D4 Full-package engine packaging: **PyInstaller onedir, excluding torch/fastapi/uvicorn**

- **Orchestration sinking (required prerequisite)**: move `run_simulation` / `run_optimization` from `omo.api.service`
  into the neutral `omo.sim` (or `omo.core`), leaving `omo.api.service` as a thin forwarder.
  That way the desktop entry `omo.rpc` depends only on `omo.sim` + the physics subpackages and **does not import FastAPI/uvicorn/pydantic at all**.
- Entry: `engine/src/omo/rpc/__main__.py` (a stdin line loop, methods `ping`/`simulate`/`optimize`).
- PyInstaller points:
  - `--onedir` (not onefile: slow startup and more false positives)
  - `--exclude-module torch --exclude-module matplotlib --exclude-module fastapi
    --exclude-module uvicorn --exclude-module tkinter --exclude-module IPython --exclude-module pytest`
  - `--collect-submodules omo` (src layout)
- Expected size: **numpy + scipy + pydantic ≈ 50–90MB** (fewer than the 2nd draft's FastAPI/uvicorn)
  - ⚠️ **Measured deviation (2026-09)**: PyInstaller onedir is actually **165.6MB**. All exclusions took effect
    (0 entries for torch/fastapi/uvicorn/matplotlib), i.e. this is the inherent cost of numpy/scipy; the gate has accordingly been set to 250MB (see §7).
- Optional dependencies: `pyproject.toml` gains the extras `neural = ["torch"]`, `plot = ["matplotlib"]`,
  `api = ["fastapi", "uvicorn"]`; an **import-graph test** pins down "after importing `omo.rpc`, sys.modules contains no torch/matplotlib/fastapi/uvicorn".

### D5 Process lifecycle (no port)

- **Startup order**: Host → initialize the data directory/secrets → spawn Go (`--stdio`) → Host sends `ping`
  → Go spawns the engine itself and sends `ping` → open the window once ready (overall target ≤5s).
- **Health check**: the Host `ping`s every 5s (2s timeout); Go `ping`s the engine every 5s;
  3 consecutive failures → each restarts its downstream (rate-limited to 3 times/10min, beyond which a dialog is shown and retries stop).
- **Exit**: window close / menu exit → reverse graceful shutdown (`shutdown` notification → engine flush → Go closes the database)
  → force-kill after a 3s timeout; on Windows a **Job Object** binds the process tree, guaranteeing no leftovers.
- **No port**: no probing, no retrying, no firewall trigger; the health check is the RPC `ping` itself.

### D6 Data directory and secrets

| Platform | Path |
|---|---|
| Windows | `%LOCALAPPDATA%\OMOPredict\` |
| macOS | `~/Library/Application Support/OMOPredict/` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/omopredict/` |

Contents: `omopredict.db`, `logs/backend.log`, `logs/engine.log`, `logs/host.log`.
**Note**: unauthenticated mode **does not need** `jwt.secret`; `OMO_JWT_SECRET` is required only in web mode (current behaviour kept).
Injected: `OMO_DB_DRIVER=sqlite`, `OMO_DB_DSN=<dataDir>/omopredict.db`,
`OMO_AUTH_MODE=none`, `OMO_LOG_DIR=<dataDir>/logs` (new), `OMO_ENGINE_CMD=<engine startup command>`.

### D7 Single instance, logging and diagnostics

- **Single instance**: `app.requestSingleInstanceLock()`; a second launch focuses the existing window and then exits.
- **Logging**: all three log streams are written to `logs/` (daily rotation, kept for 7 days); the Host captures child-process stderr to disk as well;
  the menu offers "Open log directory / Export diagnostic information (logs + a db copy + versions)".

### D8 Version and update (manual this cycle)

Version sources: `engine/pyproject.toml`, Go `-ldflags -X main.version`, `frontend/package.json`
→ all injected at build time into the shell `version`, the "About" page and the `meta` response. This cycle they are overwritten manually via GitHub Release;
`electron-updater` is reserved (requires signing).

### D9 Lightweight package (bring your own Python) design and engine discovery

**Artefact**: `OMOPredict-lite-<ver>-win-x64.zip` (target ≤150MB; of which the **app payload is ≤50MB**, see §7)
= Electron shell + Go sidecar + **engine source** (`engine/`, ~1MB) + `setup-engine.ps1` + `README.txt`.

**Engine resolution order (shared by Host/Go as `resolveEngine()`)**:

| Order | Condition | Launch method |
|---|---|---|
| 1 | Environment variable `OMO_ENGINE_CMD` | Execute directly (uniform lab configuration / advanced users) |
| 2 | Sibling `resources/engine/omo-rpc.exe` (full-package layout) | Run the sidecar directly |
| 3 | `uv` on PATH | `uv run --frozen --project <bundled engine> python -m omo.rpc` |
| 4 | `python`/`py` on PATH | `python -m omo.rpc` |
| 5 | All fail | **Friendly error dialog**: what is missing, what to install (Python ≥3.12 or uv), "Open log directory" |

> **Implementation status (T4.5 ✅, Go side)**: resolution already lives in `ResolveEngineCommand()` in
> `server/internal/task/engine_resolve.go`; levels 1–4 are all implemented and covered by unit tests (injected environment, never touching the real machine); on the
> Go side level 5 is **fail at startup and print actionable guidance** (`OMO_ENGINE_CMD` / install uv / use the full package),
> and **the friendly error dialog belongs to the Host layer (T6/T7)**.
> The engine project directory is taken from `OMO_ENGINE_PROJECT`, otherwise inferred as `resources/engine` (which must contain `pyproject.toml`),
> and is used as the child process's working directory (so that `python -m omo.rpc` can import `omo` directly under the src layout).
> Level 4 does not do an `import omo` pre-check; instead it **pings immediately after startup** to verify — a failure shows the engine's real error
> (such as `ModuleNotFoundError: No module named 'omo'`) rather than a silent timeout.

`setup-engine.ps1`: with uv → `uv sync --frozen`; otherwise `python -m pip install -e engine` (with a mirror hint).

---

## 5. Interface contracts

### 5.1 RPC method ↔ REST endpoint mapping (payloads field-for-field identical)

| RPC method | HTTP equivalent | Description |
|---|---|---|
| `ping` | `GET /health` | Readiness/health probe |
| `meta` | `GET /api/meta` (new) | `{auth_required, mode, version, engine_transport}` |
| `tasks.create` | `POST /api/tasks` | kind=simulate / optimize (with 202 semantics: returns a pending task immediately) |
| `tasks.list` | `GET /api/tasks` | Newest first |
| `tasks.get` | `GET /api/tasks/{id}` | Status and result |
| `tasks.delete` | `DELETE /api/tasks/{id}` (new) | Delete the task (including its result); returns `{deleted: true}` |
| `auth.register` / `auth.login` / `auth.me` | `/api/auth/*` | Web (jwt) mode only; in desktop `none` mode returns `error.code = 401` |

### 5.2 Environment variables

| Variable | Consumer | Meaning |
|---|---|---|
| `OMO_AUTH_MODE` | Go | **New**: `none` (desktop, fixed local user) / `jwt` (web, default) |
| `OMO_ENGINE_TRANSPORT` | Go | **New**: `http` (web, default, used with `OMO_ENGINE_URL`) / `stdio` (desktop, used with `OMO_ENGINE_CMD`) |
| `OMO_ENGINE_CMD` | Go/Host | **New**: engine startup command (stdio mode; supports quoted paths containing spaces; defaults to auto-discovery in the D9 order) |
| `OMO_ENGINE_PROJECT` | Go/Host | **New**: engine project directory (containing `pyproject.toml`), used for D9 levels 3/4 and as the child process working directory; defaults to inferring `resources/engine` |
| `OMO_ENGINE_TIMEOUT` | Go | **New**: timeout for a single engine call (Go duration, default `60s`); large grid inverse design needs a larger value (e.g. `10m`) |
| `OMO_LOG_DIR` | Go | **New**: log directory (if unset, output goes to stderr, keeping the current behaviour) |
| `OMO_DB_DRIVER` / `OMO_DB_DSN` / `OMO_SERVER_ADDR` / `OMO_ENGINE_URL` / `OMO_JWT_SECRET` | Go | Reused from the existing set (the desktop uses only the first two) |

---

## 6. Directory and artefact layout

```
OMOPredict/
├── desktop/                     # Electron shell (standalone pnpm project)
│   ├── src/main.ts              # Main process: window (app:// protocol), menu, IPC, lifecycle (T7)
│   ├── src/preload.ts           # contextBridge exposes window.omo.{rpc,openLogDir,openDataDir} (T7)
│   ├── src/host/                # Host layer (T6, **contains no Electron**, so it can be unit-tested in pure Node):
│   │                            #   paths / logger / lines / rpc / backend / engine / singleton / host
│   ├── src/shell/               # Shell logic (T7, likewise decoupled from Electron for unit testing):
│   │                            #   appProtocol (app:// resolution + CSP) · channels (IPC channels and envelope)
│   │                            #   preloadBridge · menu · windowOptions · backendCommand · diagnostics
│   ├── test/fixtures/           # Fake backend (a real child process over real pipes)
│   └── package.json             # electron-builder configuration (nsis + zip); packaging scripts belong to T8/T9
├── frontend/src/api/            # transport.ts (http | ipc) + client.ts (401 cross-cutting) + token.ts + meta.ts;
│                                # auth.ts/tasks.ts now call through client (T5 done, see §13)
├── server/internal/rpc/         # New: stdio JSON-RPC dispatcher (reuses the task/user services)
├── engine/src/omo/rpc/          # New: stdio entry; omo/sim.py carries the orchestration (sunk down from api.service)
└── scripts/
    ├── build-desktop.ps1        # pnpm build → go build → pyinstaller → electron-builder
    ├── build-lite.ps1           # pnpm build → go build → assemble the lightweight package
    ├── rpc-cli.ps1              # Manual debugging: send one line of JSON to stdio and read the response
    └── start-local.ps1          # Shell-less debugging: spawn Go(--stdio)+engine + open a browser (http mode)
```

---

## 7. Build and CI pipeline

```
[1] frontend : pnpm install --frozen-lockfile → lint → build                            → dist
[2] server   : go vet/test (incl. RPC dispatcher and single-user mode tests) → go build → omopredict-server.exe
[3] engine   : uv sync --frozen → pytest (incl. import-graph test) → pyinstaller        → engine/ onedir
[4] desktop  : dist + [2] + [3] → electron-builder (nsis + zip)                         → full package
[5] lite     : dist + [2] + engine source + setup script → zip                          → lightweight package
[6] release  : triggered by tag; upload artefacts + SHA256 manifest
```

- Caches: pnpm store, Go build cache, uv cache, Electron binaries (`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`).
- **Size gates**: full package ≤300MB, **engine directory ≤250MB** (was 90MB, relaxed in 2026-09 according to measurements), **lightweight package ≤150MB**
  (was 50MB, relaxed in 2026-09), plus a tight **app payload ≤50MB** gate spanning both, responsible for preventing optional dependency leakage.
  - ✅ **Engine directory: measured 165.6MB** (PyInstaller onedir, numpy + scipy), so the cap was
    **relaxed from the first draft's 90MB (then estimated at "50–90MB") to 250MB**. It has been verified that `torch`/`fastapi`/`uvicorn`/`matplotlib` are **all 0 entries**
    in the artefact, and that the sidecar really computes correct results (Rs≈3.9708) — i.e. the size is the inherent cost of numpy/scipy, not optional dependency leakage.
  - ✅ **Lightweight package: the embedded Electron runtime is kept → the cap is relaxed from 50MB to 150MB** (Electron is about 110MB compressed).
    So as not to lose its regression-prevention value, a tight **app payload ≤50MB** gate was added to watch the part we can actually break.
    Measured application-side payload: Go backend 26.4MB + render output 0.61MB + engine source 0.48MB ≈ **27.5MB staged / 13.9MB compressed**.
- **Contract-consistency test** (mandatory): the same set of cases is executed over HTTP and over RPC, asserting the response JSON is deeply equal;
  the frontend `client.ts` is unit-tested with the same set of fake transports.
  - ✅ **Backend part landed**: `internal/rpc/contract_test.go` (field-for-field HTTP↔RPC payload comparison);
    T4.5 additionally adds a "stdio↔HTTP inverse-design payload byte-for-byte identical" case.
  - ✅ **Frontend part landed (part of T9)**: `src/api/transport.test.ts` asserts that when the same set of cases goes over HTTP (a fake fetch capturing requests)
    and over IPC (a fake bridge capturing calls), **the parameter encoding and returned results are identical**.
  - ⏳ The remaining T9 items (`rpc-cli.ps1` / `build-desktop.ps1` / the six CI jobs / Release) are still to do.

---

## 8. Development mode and debugging

| Scenario | Approach |
|---|---|
| Frontend only (web) | `pnpm dev` (Vite proxy → Go :8080, jwt mode); the frontend automatically uses the http transport |
| Shell development | Go/engine started the usual way; shell dev mode loads `http://localhost:5173`, and the Host skips spawning child processes (`OMO_DESKTOP_DEV=1`) |
| Shell-less local debugging | `scripts/start-local.ps1` (Go `--stdio` + engine `omo.rpc` + manual joint debugging with `rpc-cli.ps1`) |
| Full/lightweight package | `build-desktop.ps1` / `build-lite.ps1` (T8/T9); artefacts are in `desktop/release/` |
| Manual RPC verification | `rpc-cli.ps1 '{"jsonrpc":"2.0","id":1,"method":"tasks.list","params":{}}'` |

---

## 9. Risks and mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| **Dual-transport drift** (HTTP and RPC behaving differently) | Two different results for the same feature | A single payload contract + the **contract-consistency test** (§7) + the RPC dispatcher and the HTTP handler sharing the service layer |
| Large response bodies over the line protocol | An `optimize` report can reach hundreds of KB; an over-long line may exceed the buffer | Explicitly enlarge the read buffers on both sides (≥8MB); switch to chunked framing (length prefix) if necessary; for now keep the line protocol and add a "large response" test |
| stdio encoding | Inconsistent Windows console/pipe encoding causes garbled Chinese text or parse failures | Force a UTF-8 byte stream (not going through the console code page); set it explicitly on both sides; tests include Chinese task names |
| PyInstaller packing scipy with missing DLLs | The engine fails to start | `--onedir` + explicit hiddenimports; smoke-test the sidecar alone on a clean machine first, then put it into the shell |
| torch/fastapi pulled in implicitly | Package size explodes / the gate fails | Orchestration sinking + optional extras + import-graph test + size gate |
| Antivirus false positives (common with PyInstaller) | Users dare not run it | Prefer onedir; explain in the README; sign later once a certificate is available |
| Electron package rather large / slow binary download | Inconvenient distribution / CI timeout | The lightweight package complements it; `ELECTRON_MIRROR` + CI cache; NSIS compression |
| Lightweight-package user environment mismatched | Unusable | D9 five-level discovery + clear error guidance + `setup-engine.ps1` |
| Single-user mode letting requests through by mistake (web misconfigured as none) | Security risk | `OMO_AUTH_MODE` is injected only by the desktop Host; `meta` exposes the mode; the startup log explicitly prints the current mode; the web deployment documentation stresses the default `jwt` |
| Data directory containing Chinese characters / a long path | SQLite/extraction errors | ASCII subdirectory name `OMOPredict`; clean-machine verification on a machine with a Chinese username |
| The "cannot curl" debugging inconvenience of no port | Troubleshooting cost | Keep http mode + `rpc-cli.ps1` + the three log streams + diagnostic export |

---

## 10. Acceptance criteria (clean-machine checklist)

### Full package (a Windows machine without Python / Go / Node installed)
1. Unzip the portable package and double-click → the main window appears within **≤5s** (≤8s on first run including initialization).
2. **No login page**: the parameter design page is entered on startup; the top bar shows "local mode".
3. Simulation (ITO/Ag/ITO 40-10-40) → the result charts are normal; inverse design (T≥85%, Rs≤12, SE≥25) → the candidate table + sensitivity are normal;
   **the numbers match the web version** (same inputs compared for Rs / T@550nm / SE@10GHz).
4. Task history: list/view/**delete** all work; after deletion and restarting the application the task does not reappear.
5. Closing the application → the task history is retained; the whole flow is usable offline.
6. **No listening port while the application runs**: `netstat -ano | findstr <PID>` shows no LISTENING record.
7. After exit there are no leftover `OMOPredict.exe` / `omopredict-server.exe` / `omo-rpc.exe` processes.
8. Installer ≤300MB, engine directory ≤250MB (originally 90MB, relaxed in 2026-09 according to measurements, see §7); the data directory is `%LOCALAPPDATA%\OMOPredict\`, and the menu can open the logs.

### Lightweight package
9. On a machine **without Python** installed: startup gives clear guidance (missing Python/uv + installation instructions + open logs); it does not crash or show a blank window.
10. With Python ≥3.12 installed and `setup-engine.ps1` run → a restart makes it fully usable (same as items 3–4).
11. Size ≤150MB (of which the app payload is ≤50MB); results consistent with the full package.

---

## 11. Task breakdown (implementation phase)

| # | Task | Content | Dependency |
|---|---|---|---|
| T1 | Single-user mode + meta | `OMO_AUTH_MODE`, fixed local user injection, `GET /api/meta`, startup log printing the mode; Go tests | — |
| T2 | Task deletion | `DELETE /api/tasks/{id}` + store.Delete + ownership check; Go tests | T1 |
| T3 | Go RPC dispatcher | `internal/rpc`: JSON-Lines read/write, method routing (reusing the service layer), error codes = HTTP semantics, `--stdio` startup switch; tests | T1, T2 |
| T4 | Engine orchestration sinking + RPC entry | `omo.sim` (orchestration), `omo/rpc` (stdio loop), optional extras, import-graph test; pytest | — |
| **T4.5** | **Go-side stdio engine transport + engine discovery** | `internal/task`: the `Engine` interface (same contract for HTTP/stdio), `StdioEngine` (lazy child process, id↔response, timeout, in-flight requests fail as soon as the process exits, graceful shutdown), `ResolveEngineCommand` (D9 levels 1–4); `OMO_ENGINE_TRANSPORT/OMO_ENGINE_CMD/OMO_ENGINE_PROJECT/OMO_ENGINE_TIMEOUT`; Go tests | T4 |
| T5 | Frontend transport abstraction + gates | `transport.ts` (http/ipc), `client.ts`, startup `meta` fetch, guard/UI adjustments for unauthenticated mode, delete button on the history page | T1, T2 |
| T6 | Host layer | Go child-process stdio client (id↔Promise/timeout/restart), engine discovery (D9), Job Object reclamation, single instance, log capture | T3, T4, T4.5 |
| T7 | Electron shell | Main-process window + `app://` protocol + menu (About/Data directory/Logs/Diagnostics) + preload + electron-builder configuration | T6 |
| T8 | Lightweight package | `build-lite.ps1`, `setup-engine.ps1`, README template, verification of the no-Python error path | T3, T6 |
| T9 | Contract consistency + scripts + CI | HTTP/RPC consistency tests, `rpc-cli.ps1`, `build-desktop.ps1`, six CI jobs, size gates, Release | T1–T8 |
| T10 | Documentation | `desktop/README.md`, the "desktop version" section of the root README, HANDOVER (artefacts/pitfalls/mode description), `docs/api/rpc.md` | T9 |
| T11 | Clean-machine acceptance | Verify item by item against the two checklists in §10 (including a machine with a Chinese username and the no-port check) | T9 |

**Milestones**: M6-a (T1–T4.5: single-user + the three RPC link segments can be jointly debugged by hand + **Go→engine stdio with no port**) → M6-b (T5–T7: the desktop window works, no port)
→ M6-c (T8–T9: lightweight package + CI artefacts + contract tests) → M6-d (T10–T11: documentation and clean-machine acceptance, ready for external distribution).

> **About T4.5 (a gap in the original design)**: the 3rd draft left the "Go-side stdio engine client" implicit in T6, so while T4 had completed only the engine half the engine was
> still called over HTTP — **"no port" could not be achieved**. T4.5 has filled that gap (see §13), so T6 only needs to implement the Host layer.

---

## 12. Follow-up options (out of scope this cycle, already reserved in the design)

1. **Auto-update**: `electron-updater` + a code-signing certificate.
2. **Portable mode**: the data directory can be configured to sit next to the program (carried on a USB stick).
3. **Tray residency**: closing the window does not exit, the engine stays resident in the background.
4. **Tauri alternative**: switch the shell against the Host layer interface (no changes needed to Go/Python/frontend).
5. **Single-process web deployment**: add `internal/web` to Go (embed dist, same-origin HTTP) — unrelated to the desktop, it is a web deployment optimization.
6. **Cross-platform**: macOS/Linux packaging and signing (the main cost is verification and documentation).

---

## 13. Implementation progress

| Task | Status | Description / verification |
|---|---|---|
| T1 Single-user mode + meta | ✅ Done | `OMO_AUTH_MODE=jwt\|none`, fixed local user injection, `GET /api/meta`; 7 new Go cases all green; local-mode end-to-end smoke test (create a task with no token → `user_id=local`, Rs=3.9708 consistent with the web version; auth endpoints 401); the jwt-mode regression passes |
| T2 Task deletion | ✅ Done | `DELETE /api/tasks/{id}` (ownership check unified as 404) + `Store.Delete`; 6 new api cases (success/inverse-design task/nonexistent/cross-user/unauthenticated/local mode) + 1 store case (second delete gives ErrNotFound) |
| T3 Go RPC dispatcher | ✅ Done | `internal/rpc`: JSON-Lines + JSON-RPC 2.0, method routing (ping/meta/tasks.*, reusing the service layer), error codes = HTTP semantics (reserved codes for protocol errors), the `--stdio` switch; extracted `internal/mode`, `task.CreateRequest`, `GetOwned/DeleteOwned` as the single source for HTTP/RPC; 12 new rpc cases + 5 contract-consistency cases; **a real stdio session smoke test** (real engine Rs=3.9708, 404 after deletion, all four lines valid JSON) |
| T4 Engine orchestration sinking + RPC entry | ✅ Done | Added the neutral layer `omo.sim` (spec/result dataclasses + domain validation, shared by web/desktop); `omo/api/service.py` becomes a thin adapter; added `omo/rpc` (stdio JSON-RPC: ping/simulate/optimize, application errors 422, protocol reserved codes); **optional dependency split** (base is numpy/scipy only, with `api`/`neural`/`plot` as extras) + import-graph test (a subprocess asserts that torch/matplotlib/fastapi/uvicorn/pydantic are not imported); 35 new tests (including RPC↔HTTP payload consistency) |
| T4.5 Go stdio engine transport | ✅ Done | `internal/task/engine_stdio.go`: `StdioEngine` (lazily spawns the engine child process, JSON-Lines send/receive, correlating out-of-order responses by id, per-call timeout, in-flight requests fail immediately when the engine exits, Close finishes gracefully with a 3s force-kill timeout; stdout carries the protocol only, the engine's stderr is merged into this process) + `engine_resolve.go`: `ResolveEngineCommand` (D9 levels 1–4, including quoted-path splitting) + the `Engine` interface makes HTTP/stdio **share the same payload construction** (`simulateParams`); `main.go` selects the transport by `OMO_ENGINE_TRANSPORT` and **exits at startup** when stdio resolution fails (no silent fallback to HTTP) |
| T5 Frontend transport abstraction + gates | ✅ Done | `api/transport.ts` (the `Transport` interface + method→endpoint mapping + `ipcTransport`/`httpTransport` + `activeTransport()`: detects `window.omo` and picks IPC, otherwise HTTP, overridable with `setTransport()`) + `api/client.ts` (unified entry, 401 → clear credentials + broadcast `omo:unauthorized`) + `api/token.ts` (credentials, not involved in single-user mode) + `api/meta.ts`; **capability gates**: `main.ts` calls `bootstrap()` before mounting to fetch `meta`, the auth store gains `authRequired`/`isLocalMode`/`isAuthenticated`, the route guard lets all pages through in unauthenticated mode and redirects `/login` to `/design`, the top bar shows a "local mode" marker and hides the username/logout, and a failing `meta` falls back to "authentication required"; the history page gains delete (two-step inline confirmation) |
| T6 Host layer | ✅ Done | `desktop/src/host/` (**pure Node modules, Electron-independent**): `paths` (D6 data/log directories, picking path semantics by target platform) + `logger` (D7 daily logs, kept 7 days, degrading to echo-only when the directory is unusable) + `lines` (JSON-Lines framing: half-lines spanning chunks, over-long lines discarded) + `rpc` (id↔Promise, per-call timeout, error codes = HTTP semantics, illegal lines/unknown ids only report protocol errors) + `backend` (spawn, ping health check, stderr to disk, **in-flight requests invalidated immediately on exit**, rate-limited restart, graceful shutdown + force-killing the process tree on timeout, tolerance of stdout pollution) + `engine` (only the engine-source probing that Go cannot see + the D9 level 5 guidance) + `singleton` (file lock) + `host` (assembles and injects the D6 environment variables, defaulting to `OMO_ENGINE_TRANSPORT=stdio`) |
| T7 Electron shell | ✅ Done (**no runtime startup verification done**, see below) | `src/main.ts` (main-process wiring: single-instance lock + focusing the existing window, the `app://` protocol, menu, IPC, graceful exit reclaiming the backend), `src/preload.ts` (a contextBridge whitelist exposing only `rpc`/`openLogDir`/`openDataDir`), `src/shell/` (shell logic decoupled from Electron: `appProtocol` app:// resolution + directory-traversal protection + CSP/security headers, `channels` IPC channels and the **result envelope** (so Electron does not squash the Error's `code`), `preloadBridge`, `menu`, `windowOptions` security baseline, `backendCommand` packaging/development-time location, `diagnostics` redacted diagnostics), the electron-builder configuration in `package.json` (nsis + zip, extraResources: `dist/` + `omopredict-server.exe`) | `tsc --noEmit` is clean **against the real Electron types** (validating every use of app/BrowserWindow/protocol/Menu/ipcMain); **150 unit tests** (12 files; including 5 encoding variants of app:// directory traversal, CSP with no network, IPC envelopes across the process boundary, menu/window security baseline, diagnostic redaction); the integration tests add the **renderer-process-visible link** (`window.omo.rpc` → IPC envelope → real Go → real engine, including a cross-boundary 404) |
| T8 Lightweight package | ✅ Done | `scripts/setup-engine.ps1` (two installation paths, uv → pip, + a ping verification; failures always give actionable guidance), `scripts/build-lite.ps1` (render output + Go backend + **engine source** + setup script + README → **three size gates** → zip; `-AllowMissingShell` supports staging only when there is no shell), the `desktop/lite/README.txt` template, `scripts/README.md` | Both scripts **have actually been run**: setup-engine's four paths — success/failure/auto-discovery/uv; build-lite's staging (exit 2)/full packaging (exit 0)/each of the two gates blocking (exit 1); the `desktop/` integration tests add an **engine unavailable** case (a real Go backend + a nonexistent interpreter → the task lands in `failed` with the error `engine: 启动 [...]: fork/exec ... cannot find the path specified`); CI gains a `packaging` job. The size gates were relaxed by the 2026-09 decision to payload 50MB + whole package 150MB (see §7) |
| T9 Contract consistency + scripts + CI | 🔶 Partly done | ✅ Landed: backend `internal/rpc/contract_test.go` (field-for-field HTTP↔RPC), frontend vitest (5 files, 60 cases, including **two-transport payload consistency**), desktop vitest (150 cases + 3 gated integration cases), **`rpc-cli.ps1`** (a stdio debugging client, actually run for ping/`tasks.list`/unknown method `-32601`/direct engine connection/bad JSON caught by local validation), **`build-desktop.ps1`** (full package: render + Go + **PyInstaller sidecar** + shell TS (main ESM / preload CJS) → electron-builder → three gates; actually run up to `-SkipPackaging`, and the produced sidecar was used to pass numerical consistency), **size gates** (both scripts + CI reverse-verifying that "the gate really does block"); ⏳ still to do: `start-local.ps1`, Release upload and the SHA256 manifest, completing the six CI jobs |
| T10 Documentation | ⏳ | To do (the T1/T3 contracts have already been written ahead into `docs/api/rest.md` and `docs/api/rpc.md`; the T4.5 stdio variant is in `docs/api/engine.md`) |
| T11 Clean-machine acceptance | ⏳ | To do |

> ✅ **T4.5 verification (2026-09, measured)**: 12 new Go tests (a fake engine child process over real pipes: simulation/inverse-design round trips, `code=422` pass-through,
> timeout, mid-flight process exit, idempotent Close, startup failure, D9 four-level resolution, command-line quote splitting, out-of-order responses correlated by id,
> **stdio and HTTP inverse-design payloads byte-for-byte identical**); the full Go test suite passes, `gofmt`/`vet` clean.
> Real end-to-end smoke test (Go `--stdio` + stdio engine, ITO/Ag/ITO 40-10-40):
> **Rs=3.970819, T@550nm=0.974497, SE@10GHz=33.7036**, matching the REST contract example values (transport-independent);
> **the process tree has no LISTENING port at all**, and **no listening endpoint was added globally** while running (item 6 of §10 is satisfiable for the first time);
> after stdin EOF the service exits normally, with no leftover processes.

> ✅ **T5 verification (2026-09, measured)**: `pnpm lint` 0 warnings, `pnpm build` (`vue-tsc -b` + `vite build`) passes;
> **contract-layer measurement** (a real Go service, started once per mode):
> jwt mode `meta = {auth_mode:jwt, auth_required:true, engine_transport:http}`, accessing `/api/tasks` without a token → **401**
> (so web mode still forces login); none mode `auth_required:false`, **creating a task without a token succeeds with `user_id=local`**,
> `DELETE /api/tasks/{id}` → `{id, deleted:true}`, and `GET` after deletion → **404** —— i.e. the four paths newly mapped by the frontend,
> `meta` / `tasks.create` / `tasks.list` / `tasks.delete`, line up one by one with the backend.
> ✅ **Frontend unit tests (part of T9, completed)**: vitest + jsdom + @vue/test-utils introduced, **5 files, 60 cases all green**
> (transport selection/all endpoint mappings/error normalisation/401 cross-cutting/**two-transport payload consistency**/three states of the capability gates/route-guard matrix/history-page delete state machine);
> configuration in `frontend/vitest.config.ts`, and the CI frontend job has gained a `pnpm test` step.
> ⚠️ Still missing: **browser end-to-end / real Electron shell smoke tests** (T7/T11): the behaviour of the gates in a real shell and the cross-process IPC link have not been measured yet.

> ✅ **T6 verification (2026-09, measured)**: 9 test files under `desktop/` (**91 passed + 1 skipped**) + `tsc --noEmit` clean.
> The cases really spawn child processes (the fake backend fixture goes over real pipes) and cover: framing across chunks/over-long lines, out-of-order responses correlated by id, timeouts and
> HTTP-semantic error codes, **in-flight requests failing immediately on a crash**, automatic restart after a crash once ready, **stopping and setting failed after the restart rate limit is exceeded**,
> **no automatic restart for startup-phase failures** (avoiding spinning against a configuration error), fast failure when the executable is missing, graceful exit and force-kill on timeout,
> the single-instance lock (including stale-lock reclamation and blocking a repeated acquisition within the same process), cross-day log rotation and retention cleanup, and the D6 environment-variable shape.
> **Real end-to-end (`OMO_BACKEND_EXE`-gated integration test, actually run and passing)**: Host → Go `--stdio`
> (the log shows `engine transport: stdio → …python.exe -m omo.rpc（来源 OMO_ENGINE_CMD）`, `auth mode: none`)
> → real Python engine → `tasks.create` → poll `succeeded` → **Rs≈3.9708 / T@550nm≈0.9745 / SE@10GHz≈33.70**
> → `tasks.delete` → **the backend process has no LISTENING port** (§10.6) → exits with `code=0 expected=true`, no leftovers.
> ⚠️ Still not done: the Host's lint/format configuration and CI job (T9); the Electron shell itself (T7).
> ✅ **T7 verification (2026-09, measured)**: `tsc --noEmit` is clean against the **real Electron types** (electron 44.4.5) —
> this statically validated every use of `app`/`BrowserWindow`/`protocol.handle`/`Menu`/`ipcMain`/`dialog`
> in the main process/preload; the `desktop/` tests grew to **12 files, 150 cases** (+1 integration case skipped by default):
> - `app://` resolution: file hits / root path / deep-link SPA fallback / directory-request fallback / percent decoding,
>   and **5 variants of directory traversal** (plain `..`, `%2e%2e%2f`, `..%5c`, an absolute drive-letter path, a NUL byte) are all blocked;
> - CSP asserts `connect-src 'none'` (the renderer process in desktop form should have no network capability at all);
> - **IPC contract closed loop**: main-process handler → envelope → preload restoration → the `{code,message}` usable by the frontend `toApiError`,
>   covering the four semantics 404/422/code 0/-32601;
> - the menu contains the troubleshooting entries D7 requires and no business actions; the window options assert context isolation + sandbox + no Node + webview disabled;
> - backend location (three sources: env/packaged/repository build output + an actionable error when missing); diagnostics are **redacted** (secrets must not get into a diagnostic bundle).
> **The real renderer-process-visible link has actually been run and passes** (integration test): `window.omo.rpc('meta')` → IPC envelope → **real Go backend**
> → **real Python engine** → `tasks.create` → poll `succeeded` → Rs≈3.9708 / T@550nm≈0.9745 →
> `tasks.delete` → a nonexistent task returns a **cross-process 404**.
>
> ⚠️ **No runtime startup verification done (recorded faithfully)**: this machine cannot download the Electron binaries (about 100MB+, and the package pull rate in this environment is extremely low),
> so whether `main.ts`'s **window really opens, whether the `app://` page really renders, and whether the CSP does collateral damage** **has never actually been run** —
> according to the checklist in §10 these belong to **T11 clean-machine acceptance**. Likewise, electron-builder's `build` configuration is only a **layout contract**.

> ✅ **T8 verification (2026-09, measured)**: both scripts were **actually run**, not "written and considered done":
> - `setup-engine.ps1` passed all four paths: a specified interpreter succeeds (`engine ready: ping ok`, exit 0),
>   the **`uv` branch** succeeds (`uv run --frozen --project … python -m omo.rpc` answers ping),
>   an invalid engine directory (exit 1, reporting `Not an engine project (pyproject.toml missing)`),
>   a nonexistent interpreter (exit 1, and printing the `What to check` guidance instead of a PowerShell stack trace);
>   auto-discovery (without giving `-EngineDir`) also finds `engine/` under the repository layout.
> - `build-lite.ps1`: with no shell, staging succeeds and **exits 2** as designed ("no runnable package produced", not pretending success);
>   the full path was run through with a stub shell directory (staging → gates → zip, exit 0, producing `OMOPredict-lite-0.1.0-win-x64.zip` at 13.9MB);
>   when the cap was squeezed to 5MB the gate **did indeed block** (exit 1).
> - **The T8 acceptance item "no-Python error path" (application layer)**: the integration tests add a case — a real Go backend + a nonexistent interpreter,
>   the backend still starts (the engine is spawned lazily), the task lands in `failed` with the error
>   `engine: 启动 [C:\nope\python.exe -m omo.rpc]: fork/exec … The system cannot find the path specified.`
>   —— **actionable** (it names the failing command), and the Host can further turn it into dialog text with `describeEngineFailure`.
> - CI gains a `packaging` job (ubuntu + `pwsh`): a stub shell runs the full packaging path, verifies that the gate blocks, and verifies the guidance text when there is no engine.
> - ⚠️ **Not done**: the real electron-builder artefact (no Electron binaries) and the **full package**'s PyInstaller engine (T9);
>   the user-side clean-machine flow for the lightweight package (T11). The size gates have been relaxed per the 2026-09 decision (see the ✅ notes in §7).

> ✅ **T9 partial verification (2026-09, measured)**: this round moved "packaging" from paper to a **real run**:
> - **`rpc-cli.ps1` (new)**: passed all four situations I measured — `ping` → `{"status":"ok"}`,
>   `tasks.list` → `{"tasks":[]}`, an unknown method → reserved code **-32601**, `-Target engine` connecting directly to the engine,
>   and bad JSON being stopped locally by `ConvertFrom-Json` (it does not masquerade as a backend fault).
>   The implementation deliberately avoids two PowerShell 5.1 traps: `ProcessStartInfo.ArgumentList` does not exist on .NET Framework
>   (switched to an `Arguments` string with manual quoting), and event-style asynchronous reading was changed to `ReadLineAsync()`/`ReadToEndAsync()`.
> - **`build-desktop.ps1` (new)**: the whole `-SkipPackaging` flow was run and passes — Go backend →
>   **PyInstaller onedir (~40s)** → shell TS (`dist/main` = ESM, `dist/preload` = CJS,
>   plus writing `{"type":"commonjs"}` to pin the type) → gates (engine dir 165.64MB / 250MB, payload 27.09MB / 50MB) → exit 2.
> - **The packaged sidecar really computes**: pointing `OMO_ENGINE_CMD` at `release-bin/omo-rpc/omo-rpc.exe` (**no Python anywhere in the flow**)
>   and then running the integration tests gave **3/3 passing** — the task `succeeded` with Rs≈3.9708 / T@550nm≈0.9745, including the cross-process 404 and the "no listening port" check.
>   It was also confirmed that the artefact has **0 entries** for `torch`/`fastapi`/`uvicorn`/`matplotlib`.
> - **Layout alignment**: PyInstaller `--distpath release-bin` produces `release-bin/omo-rpc/`, which electron-builder maps to
>   `resources/engine`, so the exe lands at `resources/engine/omo-rpc.exe` — exactly where Go's `findSidecar` expects it.
> - ⚠️ **Still not done**: electron-builder itself (needs the Electron binaries), `start-local.ps1`, and the Release upload with the SHA256 manifest.

---

*This design is the 3rd draft review copy; it has been implemented according to the §11 breakdown (T1–T8 ✅, T9 partly, progress in §13), with AGENTS.md milestones and HANDOVER to be updated in step.*
