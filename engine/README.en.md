# omo — data-science layer

> **English** · [中文版](README.md)

The data-science layer of the lightweight simulation and design software for OMO nanolaminate thin films: physics simulation engine + NN surrogate model.

## Package structure (Go-style package partitioning)

| Package | Responsibility | Milestone |
|---|---|---|
| `omo.optics` | optics simulation: TMM, Drude–Lorentz | M1 |
| `omo.electrical` | electrical simulation: sheet resistance, size effect | M1 |
| `omo.emi` | electromagnetic shielding effectiveness | M1 |
| `omo.sim` | **simulation/inverse-design orchestration (neutral layer)**: shared by web and desktop, no framework dependencies | M6-a T4 |
| `omo.benchmark` | literature benchmarking and error evaluation | M2 |
| `omo.neural` | NN surrogate model (simulation acceleration) | M2.5 |
| `omo.api` | FastAPI service (HTTP transport adapter, called by the Go middleware layer) | M3 |
| `omo.rpc` | **stdio JSON-RPC entry point** (desktop transport adapter, `python -m omo.rpc`) | M6-a T4 |
| `omo.optimize` | parameter optimisation and process guidance | M5 |
| `omo.cli` | command-line entry point (omo-cli) | available |

Every subpackage directory contains a `README.md`: description of responsibilities + usage example (mandatory requirement of AGENTS.md §6 rule 10).

## Dependency layering (extras)

The base dependencies are only **numpy / scipy** (`omo.sim` + the physics subpackages are usable with just those; the desktop engine needs only these);
the rest are installed as optional dependencies depending on the form:

| extra | Contents | Purpose |
|---|---|---|
| `api` | fastapi / pydantic / uvicorn | HTTP service form (web, development) |
| `neural` | torch | NN surrogate model (excluded from the desktop full package) |
| `plot` | matplotlib | benchmarking report plotting |

```bash
uv sync --all-extras    # development/CI: install all extras
uv sync                 # minimal: base dependencies only (desktop engine form)
```

> ⚠️ `uv run` **synchronises the environment exactly** according to the extras (without an explicit
> `--extra`/`--all-extras` it removes installed fastapi/torch and the like) — before running tests or
> frontend integration, run `uv sync --all-extras` first, or use
> `uv run --all-extras pytest`.

## Common commands

```bash
uv sync --all-extras         # install all dependencies (required for tests and integration)
uv run pytest                # run tests (including literature benchmarks)
uv run ruff check src tests  # code checking
uv run omo-cli --info        # CLI entry point
uv run python -m omo.rpc     # stdio JSON-RPC entry point (desktop form; for the protocol see docs/api/rpc.md)
```

## Environment notes

- Python version pinned to 3.12 (see `.python-version`)
- dependency management with uv: add a dependency with `uv add <pkg>`, a development dependency with `uv add --dev <pkg>`
- the sandbox environment of this repository points the uv cache into the workspace (`.uv-cache/`, `.uv-python/`, already gitignored); local development does not need this configuration
