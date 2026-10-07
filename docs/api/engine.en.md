# Engine contract (Go → Python `omo.api` / `omo.rpc`)

> **English** · [中文版](engine.md)

The Go middleware layer calls the Python simulation engine to perform film-stack simulation and target-driven inverse design. **Two transports, the same payload**:

| Transport | Endpoint/Method | When to use | Implementation |
|---|---|---|---|
| **HTTP** (default) | `POST /simulate`, `POST /optimize`, `GET /health` | web/development form (the engine is started with uvicorn) | `engine/src/omo/api/`; on the Go side `task.EngineClient` |
| **stdio** (desktop) | JSON-RPC `simulate` / `optimize` / `ping` | desktop form (**no listening port**, Go starts the engine as a parent process) | `engine/src/omo/rpc/`; on the Go side `task.StdioEngine` |

The transport is selected by `OMO_ENGINE_TRANSPORT` (`http` | `stdio`); at startup the Go side resolves the engine start command in the order `OMO_ENGINE_CMD` → full-package sidecar →
`uv` → `python` (docs/desktop.md D9). **The params/result of the two transports are field-for-field identical**
(the Go side shares the same set of request builders, guarded by the "payload byte-for-byte identical" test cases in `engine_stdio_test.go`),
therefore the JSON examples of the interfaces below apply to both transports.

HTTP transport: the engine is started with `uv run uvicorn omo.api.main:app --port 8000`.
stdio transport: the engine is started with `python -m omo.rpc` (protocol details see [`rpc.md`](rpc.md), likewise JSON-RPC 2.0 + JSON-Lines).

## Invocation form of the stdio transport (desktop)

One JSON-RPC 2.0 request per line, the response carries the same `id`:

```json
{"jsonrpc":"2.0","id":1,"method":"simulate","params":{ /* field-for-field identical to the POST /simulate request body */ }}
{"jsonrpc":"2.0","id":1,"result":{ /* field-for-field identical to the POST /simulate response body */ }}
```

Method mapping: `simulate` ↔ `POST /simulate`, `optimize` ↔ `POST /optimize`, `ping` ↔ `GET /health`.
Application errors use `error.code = 422` (domain validation failure, consistent with the semantics of HTTP 422),
protocol errors use JSON-RPC reserved codes (`-32700`/`-32600`/`-32601`/`-32602`).

## `POST {engine_url}/simulate`

### Request

```json
{
  "layers": [
    {"material": "ITO", "thickness_nm": 40.0},
    {"material": "Ag",  "thickness_nm": 10.0},
    {"material": "ITO", "thickness_nm": 40.0}
  ],
  "substrate_index": 1.5,
  "wavelengths_nm": [550.0],
  "freqs_ghz": [10.0]
}
```

| Field | Required | Description |
|---|---|---|
| `layers` | ✅ | film layers (incidence side → exit side), at least 1 layer; for `material` see the material registry, `thickness_nm ≥ 0` |
| `substrate_index` | no | substrate refractive index, default 1.5 |
| `wavelengths_nm` | no | optical output grid; default 380–1000 nm with a step of 10 (63 points) |
| `freqs_ghz` | no | shielding output grid; default 1–18 GHz with a step of 1 (18 points) |

### Response

```json
200 {
  "transmittance": [{"x": 550.0, "value": 0.9745}],
  "reflectance":   [{"x": 550.0, "value": 0.0162}],
  "sheet_resistance": 3.9708,
  "se_db":         [{"x": 10.0, "value": 33.70}]
}
```

| Field | Description |
|---|---|
| `transmittance` / `reflectance` | spectral points (x = wavelength in nm, value = 0–1) |
| `sheet_resistance` | sheet resistance in Ω/sq (including the Fuchs–Sondheimer size effect); `null` when there is no conductive layer |
| `se_db` | shielding effectiveness points (x = frequency in GHz, value = dB); an empty array when there is no conductive layer |

### Errors

| Status code | Meaning |
|---|---|
| `422` | unknown material, empty film stack, negative thickness, non-positive grid (detail is the error message) |

## `POST {engine_url}/optimize` —— target-driven inverse design (M5 v2, called by Go tasks with kind=optimize)

Given **target constraints**, a grid scan over the OMO three-layer thickness space inversely derives thickness combinations (evaluated by the physics engine,
returned synchronously, the default scale of ~4k combinations takes about 3 s). Implementation see `omo.optimize` (target/evaluate/search/sensitivity).

### Request (all fields optional, None = engine default)

```json
{
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
```

| Field | Description |
|---|---|
| `target` | hard constraints (AND): `min_visible_transmittance` (0–1), `max_sheet_resistance` (Ω/sq), `min_se_db` (dB, X band 8.2–12.4 GHz by default); all defaulted = unconstrained browsing scan |
| `space` | scan space: outer/metal thickness ranges and steps (nm), material names, substrate refractive index, `top_n`; default outer 20–80 step 4, metal 5–20 step 1 (4096 combinations, upper limit 2e6) |
| `compute_sensitivity` | whether to compute the per-layer sensitivity/process window for the top feasible candidates (default true) |

### Response `200`

```json
{
  "pipeline_version": "omo.optimize.search-v1",
  "target": { "...": "回显请求目标" },
  "config": { "...": "实际生效的扫描配置" },
  "n_scanned": 4096,
  "n_feasible": 1565,
  "elapsed_seconds": 3.02,
  "candidates": [
    {
      "thicknesses_nm": [52.0, 8.0, 56.0],
      "visible_transmittance": 0.9643,
      "sheet_resistance": 4.75,
      "se_min_db": 32.19,
      "se_band_ghz": [8.2, 12.4],
      "fom": 0.14656
    }
  ],
  "best_effort": { "...": "全体 FoM 最高（可能不满足约束）" },
  "sensitivity": {
    "nominal": { "...": "Top 候选指标" },
    "layers": [
      {
        "layer_index": 1,
        "material": "Ag",
        "thickness_nm": 8.0,
        "dfom_rel_per_nm": -0.0091,
        "dt_abs_per_nm": -0.01371,
        "dlog10_rs_per_nm": -0.0579,
        "tolerance_nm": 4.5
      }
    ]
  }
}
```

| Field | Description |
|---|---|
| `candidates` | feasible candidates satisfying all constraints, sorted by FoM = T_vis¹⁰/Rs in descending order and truncated to the top_n; an empty array when there is no feasible candidate |
| `sensitivity` | the per-layer sensitivity of the top candidate (per nm: ΔFoM/FoM, ΔT_vis, Δlog₁₀Rs) and the process window `tolerance_nm`; `null` when there is no feasible candidate or `compute_sensitivity=false` |
| `fom`/`sensitivity` | Haacke FoM, source G. Haacke, J. Appl. Phys. 47, 4086 (1976) |

### Errors

| Status code | Meaning |
|---|---|
| `422` | invalid configuration: range/step/material out of bounds, unknown material, number of combinations over the limit (detail is the error message) |

## Material registry (`omo.materials`)

| Material | Optical model | Electrical model |
|---|---|---|
| `ITO` | constant refractive index n=1.8 (overridable by the M2.3 calibration artefact) | ρ=1.5e-6 Ω·m |
| `Ag` | Drude (ε∞=3.7, ħωp=9.1eV, ħγ=0.02eV) | ρ=1.59e-8 Ω·m, λ=52nm (size effect) |
| `glass` | constant refractive index n=1.5 | insulator (does not participate in sheet resistance/shielding) |

New materials are introduced through the `omo.materials` registry or a request-side material override.

## Physical models

- Optics: transfer-matrix method TMM (`omo.optics`, document `docs/physics/tmm.md`)
- Electrical: parallel sheet resistance + Fuchs–Sondheimer (`omo.electrical`, document `docs/physics/electrical.md`)
- Shielding: transmission-line model (`omo.emi`, document `docs/physics/emi.md`)

## stdio JSON-RPC transport (desktop form, M6-a T4)

In the desktop form Go does not call the engine over HTTP, but communicates through a **child process + stdio JSON-RPC**
(docs/desktop.md D11; on the Go side it is enabled by `OMO_ENGINE_TRANSPORT=stdio` + `OMO_ENGINE_CMD`):

```bash
python -m omo.rpc      # the protocol goes over stdout, logs go to stderr (UTF-8 byte stream, JSON-Lines)
```

- **Protocol**: JSON-RPC 2.0 + newline-delimited; a line without `id` is treated as a notification (executed but not answered); the per-line limit is 16 MiB.
- **Methods** (the parameters are **field-for-field identical** to the HTTP request bodies):

| Method | Equivalent HTTP | Result |
|---|---|---|
| `ping` | `GET /health` | `{"status":"ok","version":"0.1.0"}` |
| `simulate` | `POST /simulate` | the same response body as `/simulate` |
| `optimize` | `POST /optimize` | the same response body as `/optimize` (the inverse-design report) |

- **Error codes**: application errors `code = 422` (consistent with the semantics of HTTP 422); protocol errors use reserved codes
  `-32700` parse error / `-32600` invalid request / `-32601` method not found / `-32602` invalid params.
- **Implementation**: `omo/rpc/` depends only on `omo.sim` + the physics subpackages, and **does not import**
  fastapi / uvicorn / pydantic / torch / matplotlib (guarded by the import-graph test in `tests/test_rpc.py`);
  the base dependencies are only numpy / scipy, the rest are extras (`api` / `neural` / `plot`, see `engine/README.md`).
- **Consistency**: `tests/test_rpc.py` executes the same request through RPC and through HTTP respectively, and asserts that the resulting JSON is identical.

```json
{"jsonrpc":"2.0","id":1,"method":"simulate","params":{"layers":[{"material":"ITO","thickness_nm":40},{"material":"Ag","thickness_nm":10},{"material":"ITO","thickness_nm":40}]}}
```

## Implementation locations

- Engine side: `engine/src/omo/`
  - `sim.py`: simulation/inverse-design orchestration (**neutral layer**, shared by the two transports; includes domain validation)
  - `api/`: HTTP transport adapter (`main.py` / `service.py` / `schemas.py`)
  - `rpc/`: stdio JSON-RPC transport adapter (`server.py` / `__main__.py`)
- Go-side caller: `server/internal/task/` (HTTP client; for the desktop stdio client see docs/desktop.md T6)
