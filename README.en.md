# OMOPredict

> **English** · [中文版](README.md)

A lightweight simulation and design tool focused on **OMO (oxide-metal-oxide) nanolaminate thin-film systems**,
aimed at undergraduate research and course design: input the thickness / refractive index / resistivity of each layer,
output **optical transmittance, sheet resistance and electromagnetic shielding effectiveness**, and **benchmark against
measured data from high-level papers**, for performance prediction and process-optimization guidance.

> ⚠️ This project has explicit **model boundaries and scope of applicability**; see [Limitations and scope of applicability](#limitations-and-scope-of-applicability-limitations) for details.

## Three-layer architecture

```
┌──────────────────┐  REST/JSON  ┌──────────────────┐  HTTP/stdio  ┌──────────────────┐
│  Vue 3 + TS      │ ──────────▶ │  Go              │ ───────────▶ │ Python (engine)  │
│  Frontend UI     │ ◀────────── │  Tasks/storage   │ ◀─────────── │ TMM/Rs/shielding │
│                  │             │  /orchestration  │              │                  │
└──────────────────┘             └──────────────────┘              └──────────────────┘
```

| Layer | Technology | Directory | Responsibility |
|---|---|---|---|
| Data-science layer | Python (numpy/scipy/torch) | `engine/` | TMM optics, sheet resistance, shielding, literature benchmarking, NN surrogate, inverse design |
| Middleware layer | Go (GORM) | `server/` | users/JWT, SQLite/MySQL/PostgreSQL, task orchestration (including single-user mode and stdio JSON-RPC) |
| Frontend | Vue 3 + TypeScript | `frontend/` | parameter design, inverse design, result charts, task history |
| Desktop shell | Electron + TypeScript | `desktop/` | local single-user form: launch/guard the Go middleware and the engine (Host layer done, Electron shell still to do) |

## Feature status (milestones)

- ✅ M0 scaffolding + CI (Python ruff/pytest + Go fmt/vet/build/test + frontend lint/build)
- ✅ M1 physics engine: TMM + Drude, parallel sheet resistance + Fuchs–Sondheimer, transmission-line shielding
- ✅ M2 literature benchmarking: 3 real datasets + calibration loop (sensitivity analysis → fitting → held-out validation)
- ✅ M2.5 NN surrogate model: 20k training, T/Rs/SE accuracy <0.1% (relative to the physics engine)
- ✅ M3 Go middleware: JWT authentication + GORM multiple databases + task orchestration (Go→Python end-to-end working)
- ✅ M4 Vue frontend: login/registration, layer parameter design, ECharts result charts, task history
- ✅ M5 v1 inverse design (engine layer): constraints → grid scan → candidates + FoM ranking + sensitivity/process window (`omo-cli optimize`)
- ✅ M5 v2 inverse design end-to-end: engine `POST /optimize` + Go `kind=optimize` task + frontend "Inverse design" page
- ✅ M6-a T1–T4 (desktop foundation, see `docs/desktop.md`): single-user mode + `/api/meta`, task deletion,
  Go-side stdio JSON-RPC transport, engine-side neutral orchestration layer `omo.sim` + `omo.rpc` entry point
- ✅ T4.5 **Go→engine stdio transport**: Go launches the engine as a child process (engine discovery levels 1–4);
  the desktop form **listens on no port at all** (measured), and the HTTP/stdio payloads are field-for-field identical
- ✅ T5 **frontend transport abstraction + capability gate**: if `window.omo` exists, Electron IPC is used, otherwise HTTP (identical payloads);
  after fetching `meta` at startup it decides from `auth_required` whether to require login (in single-user mode the top bar shows "local mode" (本地模式)); the history page supports deletion
- ✅ T6 **desktop Host layer** (`desktop/`): data directory/log rotation/single-instance lock/engine source discovery/Go child-process guard
  (in-flight requests fail on a crash, rate-limited restart, process-tree reclamation on timeout) + stdio JSON-RPC client
- ✅ T7 **Electron shell**: main process (`app://` protocol, menu, IPC) + preload allowlist; shell logic decoupled from Electron,
  150 unit tests (including app:// directory-traversal protection, CSP with no network, IPC envelope); **the shell's startup and rendering have not yet been run for real** (belongs to T11 clean-machine acceptance)
- ✅ T8 **lightweight package** (`scripts/`): `setup-engine.ps1` (the user installs the engine on their own Python and verifies it with a ping; on failure it gives actionable guidance)
  + `build-lite.ps1` (render artefacts + Go backend + engine source → size gate → zip)
- ✅ T9 mostly **full package and debugging tools**: `build-desktop.ps1` (+ **PyInstaller engine sidecar**, measured to compute correct results with no
  torch/fastapi leakage) + `rpc-cli.ps1` (stdio protocol debugging) + shell TS compilation (main=ESM / preload=CJS) + size gate
- ⏳ M5 remaining (report export, advanced optimization, NN surrogate acceleration) / M6 remaining (T9 tail items `start-local.ps1`/Release, T11 clean-machine acceptance)

## Quick start

```bash
# Data-science layer (physics engine API, default :8000)
cd engine && uv sync --all-extras        # first time: install all dependencies (base is only numpy/scipy, the rest are extras)
cd engine && uv run uvicorn omo.api.main:app --port 8000

# Inverse design (engine-layer CLI, try out M5 v1)
cd engine && uv run omo-cli optimize --min-t 0.85 --max-rs 12 --min-se 25

# Middleware (default :8080, reads server/.env; OMO_ENGINE_URL points at the engine)
cd server && go run ./cmd/omopredict

# Desktop form (portless, experimental): Go-side stdio JSON-RPC + Go launches the engine over stdio, no port is listened on at all
#   OMO_ENGINE_CMD can also be a quoted path containing spaces; if unset, it auto-discovers via resources/engine → uv → python
cd server && OMO_AUTH_MODE=none OMO_ENGINE_TRANSPORT=stdio OMO_ENGINE_CMD='python -m omo.rpc' go run ./cmd/omopredict --stdio

# Frontend (default :5173, /api proxied to Go :8080)
cd frontend && pnpm install && pnpm dev

# Tests
cd engine && uv run pytest                        # full Python test suite
cd server && go test ./...                        # full Go test suite
cd frontend && pnpm lint && pnpm test && pnpm build   # frontend lint + unit tests + build
cd desktop && pnpm type-check && pnpm test        # desktop Host layer and shell logic (including real child-process cases)

# Packaging (lightweight package: user supplies Python; full package: engine bundled)
powershell -ExecutionPolicy Bypass -File scripts\setup-engine.ps1   # prepare/verify the engine
powershell -ExecutionPolicy Bypass -File scripts\build-lite.ps1     # produce the lightweight package
powershell -ExecutionPolicy Bypass -File scripts\build-desktop.ps1  # produce the full package (with PyInstaller engine)
powershell -ExecutionPolicy Bypass -File scripts\rpc-cli.ps1 -Method ping   # protocol debugging
```

For detailed startup/configuration/interfaces see the document index. The desktop version is complete through T8 and mostly through T9 (the scripts and the bundled engine have been run for real);
**the shell's startup and rendering, and electron-builder packaging, have not yet been run for real**, which belongs to T11; see `docs/desktop.md` §13 for details.

## Limitations and scope of applicability (Limitations)

> The limitations below are all **known and deliberately retained** (most are physics-model boundaries, not bugs to be fixed). Please read this section before use.

### 1. Physics model and domain of applicability

| Limitation | Description |
|---|---|
| **Ultra-thin metal ignores percolation** | Ag films < ~10 nm show island growth/percolation, and the Fuchs–Sondheimer **continuous-film assumption breaks down**; the held-out validation set has significant error in that range (marked as a model boundary, not force-fitted) |
| **The calibrated parameters are "effective parameters"** | M2.3 fits Ag ρ = 2.6e-8 Ω·m (hits the upper bound), λ = 95 nm, ITO n = 2.1, reflecting **unmodelled interface/grain-boundary scattering**; they are effective values for simulation, **not material properties**, and should not be cited as physical constants |
| **No dispersion, no roughness, no interface diffusion** | Oxides use a constant refractive index (ITO n≈1.8); TMM assumes ideally flat interfaces with no scattering (hence T + R + A = 1); processing factors such as roughness, interface interdiffusion, crystallinity and annealing are not modelled |
| **Material allowlist** | The engine defaults to only `ITO / Ag / glass` (`engine/src/omo/materials.py`); other materials require extending the registry, and freely entered material names are rejected by the engine |
| **The shielding model only includes conductive layers** | The transmission-line model is solved only for conductive layers (dielectric-layer capacitance/interface effects are not counted); under the thin-film approximation SE is nearly independent of frequency — **a flat SE curve is a physical result, not a bug** (see `docs/physics/emi.md` §4.1) |
| **No temperature/magnetic field/anisotropy** | Relative permeability defaults to 1, there are no magnetic materials and no temperature-dependent model, and flexibility effects such as stress/bending are not considered |
| **Angle and polarization are not exposed** | The Python library supports the angle of incidence and s/p polarization, but the HTTP API and the frontend are fixed to **normal incidence + unpolarized** |
| **Fixed output grid** | The API can take `wavelengths_nm` / `freqs_ghz`, but the frontend always uses the default grid (380–1000 nm in steps of 10, 1–18 GHz in steps of 1) |

### 2. Accuracy: what can and cannot be claimed

- **The benchmarking dataset is small**: currently only **3 papers, about 9 measured points**, and each corresponds to a **single deposition process**
  → these numbers represent only the benchmarked systems and processes, and **cannot be extrapolated into a "global accuracy"**.
- **Order of magnitude of the validated range** (after calibration): for systems of the WO₃₋ₓ/Ag/WO₃₋ₓ kind the transmittance deviation is about a few percentage points and the sheet resistance about 7%;
  **no accuracy is promised for the thin-Ag range or for unbenchmarked systems** (that is extrapolation).
- **No uncertainty is provided**: only point predictions are output, with no error bars/confidence intervals; the inverse-design "process window" is a **deterministic tolerance**,
  not a statistical distribution of process fluctuations.
- **Tuning constants without justification is forbidden**: physical constants and formulas must have a literature source, and constants may not be changed in order to "make the results look better" (AGENTS.md §6.2).

### 3. Inverse design and the NN surrogate

- **Only a fixed three-layer OMO is supported** (default ITO/Ag/ITO; the materials can be swapped in the engine configuration for other materials in the registry, which the frontend does not expose),
  and searching over an arbitrary number of layers/layer order is not supported.
- **Objective forms are limited**: the hard constraints are only `T_vis ≥ x`, `Rs ≤ y` and the in-band minimum `SE ≥ z`; feasible candidates are always ranked by
  **Haacke FoM = T¹⁰/Rs**, and custom objective functions or Pareto-front display are not supported.
- **Deterministic grid scan**: the cost grows exponentially with the dimension (engine hard cap 2×10⁶ combinations, frontend advisory cap 10⁵ combinations);
  the default ~4k combinations takes about 3 seconds (including SE). Gradient/genetic/Bayesian optimization is not yet integrated, and **neither is NN surrogate acceleration** (the scan evaluates serially).
- **The process window uses a "single-layer independent" definition**: fix the other layers and perturb one layer by ± to find the tolerance (probe step 0.5 nm, cap ±5 nm);
  it is not equal to a joint tolerance over multiple layers.
- **The NN surrogate domain is very narrow**: v1 takes only the three ITO/Ag/ITO thicknesses as input (outer layers 20–80 nm, metal 5–20 nm), with fixed materials and substrate,
  so anything outside the domain is extrapolation; its accuracy is measured against the **physics engine** (not the measured literature), and the model artefacts must be regenerated by retraining (already gitignored).

### 4. Software engineering and deployment

- **The desktop version has no authentication**: `OMO_AUTH_MODE=none` fixes a single user (`user_id=local`), **for local/offline use only,
  and it must never be exposed to a network**; networked deployments must use the default `jwt` mode.
- **Tasks are in-process asynchronous**: no persistent queue, no retries, no cancel interface; when the process exits abnormally, unfinished tasks remain in
  `pending`/`running` and are not recovered automatically.
- **Single-machine single-instance assumption**: SQLite by default (concurrent writes are limited), with no multi-instance/distributed deployment capability;
  MySQL/PostgreSQL are already supported but CI only covers SQLite.
- **No rate limiting and no quotas**, and task results are written once (no versioning/recomputation).
- **Uneven test coverage**: Python/Go have fairly complete unit tests and benchmarking tests; the frontend already has vitest unit tests
  (transport abstraction/endpoint mapping/capability gate/route guard/history-page deletion, 5 files 60 cases), but there are **still no browser end-to-end tests,
  and the real Electron shell has not been smoke-tested either**.
- **The desktop version has not yet been delivered** (design see `docs/desktop.md`): it is still the three-process web form; the planned desktop package will
  **exclude torch (no NN acceleration)**, have no code signing and no auto-update, be Windows-first, and the lightweight package requires the user to supply Python.
- **Not implemented**: report export, **general** inverse design (arbitrary number of layers/layer order, custom objective functions — the existing inverse design already covers
  hard-constrained thickness inverse design for a fixed three layers, see §3), more material systems, the `omo-cli simulate` subcommand, etc. (see the ⏳ milestones).

### 5. Unsuitable scenarios

- **Process freeze / device delivery decisions**: this tool is for screening and mechanism explanation, and its conclusions need experimental verification;
- situations that require **uncertainty quantification** or **statistical process tolerances**;
- systems beyond the material allowlist, beyond the validated thickness domain (especially thin Ag), or requiring dispersion/roughness/annealing effects;
- **multi-user networked services**: the desktop version has no authentication; the web version also lacks production-grade capabilities such as rate limiting, auditing and password recovery.

> Details and evidence for each limitation: `docs/physics/` (model assumptions), `docs/benchmarks/calibration.md` (calibration and model boundaries),
> `engine/src/omo/optimize/README.md` (inverse-design design), `docs/desktop.md` (desktop form), `docs/HANDOVER.md` §6 (known pitfalls).

## Document index

- **Project constitution (agent entry point)**: `AGENTS.md`
- **Handover report (required reading for continuing the work)**: `docs/HANDOVER.md`
- **Physics models**: `docs/physics/{tmm,electrical,emi}.md`
- **Literature benchmarking and calibration**: `docs/benchmarks/` (README + calibration)
- **API contracts**: `docs/api/` (rest = external REST, engine = Go→Python contract, rpc = desktop stdio JSON-RPC)
- **Desktop version design**: `docs/desktop.md`
- **Each layer**: `engine/README.md`, `server/README.md`, `frontend/README.md`, `desktop/README.md`
- **Scripts**: `scripts/README.md` (usage, exit codes and pitfalls of the packaging/engine-preparation scripts)
