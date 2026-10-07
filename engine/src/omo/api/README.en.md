# omo.api —— FastAPI service (M3 implemented, called by the Go middleware layer)

> **English** · [中文版](README.md)

## Responsibility

Wrap the physics engine as an HTTP service for the Go middleware layer to call (see the architecture diagram in AGENTS.md):

- Receive a film stack (material + thickness) → call the physics engine → return T(λ) / Rs / SE(f)
- **Only request/response wrapping, no physics logic** (layering discipline, AGENTS.md §6.6)

## Implemented modules

| Module | Responsibility |
|---|---|
| `schemas.py` | Pydantic request/response models (snake_case; `SimulateRequest`/`SimulateResponse` + `OptimizeRequest`) |
| `service.py` | `run_simulation`: orchestrate optics (TMM) + electrical (sheet resistance) + shielding (SE); Rs=null when there is no conductive layer; `run_optimization`: target-driven inverse design (wrapping `omo.optimize`, including Top-candidate sensitivity) |
| `main.py` | FastAPI application: `POST /simulate`, `POST /optimize`, `GET /health` |

## Startup and endpoints

```bash
uv run uvicorn omo.api.main:app --port 8000
```

| Method | Path | Description |
|---|---|---|
| POST | `/simulate` | Submit a film stack, return T(λ) / Rs / SE(f) (synchronous) |
| POST | `/optimize` | Target-driven inverse design (M5): target constraints → candidate thickness combinations + sensitivity (synchronous, on the order of seconds) |
| GET | `/health` | Health check |

```bash
curl -X POST http://127.0.0.1:8000/simulate \
  -H "Content-Type: application/json" \
  -d '{"layers":[{"material":"ITO","thickness_nm":40},{"material":"Ag","thickness_nm":10},{"material":"ITO","thickness_nm":40}]}'
```

Default output grids: wavelengths 380–1000 nm (step 10), frequencies 1–18 GHz (step 1);
a request may pass `wavelengths_nm` / `freqs_ghz` to override them. Invalid input (unknown material, empty stack, negative thickness) → 422.

## Conventions

- Field names in snake_case; units annotated with the field (nm, Ω/sq, dB)
- Material-name resolution goes through the shared registry `omo.materials.MaterialResolver` (same source as benchmark)
- Physics logic always calls the other omo subpackages; copying formulas into this package is forbidden
- Asynchronous tasks (`GET /tasks/{id}`) will be added as needed once Go-side task orchestration lands

## Validation

- `tests/test_api.py`: /health, cross-validation of /simulate against direct engine computation (1e-9), custom grids,
  unknown material/empty layer/negative thickness 422, purely insulating layer Rs=null
