# omo.optimize —— target-driven inverse design and process guidance (M5 v1)

> **English** · [中文版](README.md)

## Responsibility

Given **performance targets** (hard constraints on average visible transmittance / sheet resistance / shielding effectiveness), perform a
**reverse grid scan** over the OMO three-layer thickness space and return the thickness combinations that satisfy the constraints (sorted by the
Haacke figure of merit FoM = T_vis¹⁰/Rs), and for the best candidate output the **per-layer sensitivity**
(the effect of each nm of thickness change) and the **process window** (the single-layer thickness tolerance that keeps the target feasible).

Layering discipline: inverse design is physics logic and is implemented only inside this Python package; the evaluation path is the same
source as the forward simulation (omo.api / omo.neural), and the physics engine remains the sole baseline for inverse-design results.

## Core modules

| Module | Responsibility |
|---|---|
| `target.py` | `DesignTarget`: hard constraints (min T_vis / max Rs / min SE) + SE frequency band |
| `evaluate.py` | `evaluate_candidate`: thickness combination → T_vis / Rs / SE_min / FoM |
| `search.py` | `OmoSearchConfig` + `search_designs`: grid scan → `OptimizeReport` |
| `sensitivity.py` | `analyze_sensitivity`: per-layer sensitivity + process window |

## How to call it (minimal example)

```python
from omo.optimize import DesignTarget, OmoSearchConfig, search_designs, analyze_sensitivity

# 1. Set targets: average visible transmittance ≥ 85% and sheet resistance ≤ 12 Ω/sq, X-band SE ≥ 25 dB
target = DesignTarget(
    min_visible_transmittance=0.85,
    max_sheet_resistance=12.0,
    min_se_db=25.0,          # frequency band defaults to X-band 8.2–12.4 GHz
)

# 2. Scan (default ITO/Ag/ITO: outer 20–80 step 4, metal 5–20 step 1 ≈ 4k combinations)
report = search_designs(target)   # or OmoSearchConfig(outer_bounds_nm=(30, 60), ...)

print(f"扫描 {report.n_scanned} 组合 · 可行 {report.n_feasible} 组 · 用时 {report.elapsed_seconds:.1f}s")
for m in report.candidates:       # feasible candidates in descending FoM order
    print(m.thicknesses_nm, f"T={m.visible_transmittance:.3f}",
          f"Rs={m.sheet_resistance:.2f} Ω/sq", f"SE={m.se_min_db:.1f} dB", f"FoM={m.fom:.4f}")

# 3. Sensitivity and process window of the best candidate
if report.candidates:
    sens = analyze_sensitivity(report.candidates[0], report.config.materials, target)
    for s in sens.layers:
        print(f"层{s.layer_index}({s.material}) {s.thickness_nm:g}nm: "
              f"ΔFoM/FoM = {s.dfom_rel_per_nm:+.4f}/nm, "
              f"ΔT = {s.dt_abs_per_nm:+.5f}/nm, "
              f"工艺窗口 ±{s.tolerance_nm:g} nm")

# 4. Report serialization (JSON)
report.to_dict()
```

## Command line

```bash
uv run omo-cli optimize \
  --min-t 0.85 --max-rs 12 --min-se 25 \
  --outer-min 20 --outer-max 80 --metal-min 5 --metal-max 20 \
  --json optimize_report.json
```

## Design notes

- **Determinism**: pure grid scan, no randomness; `OptimizeReport.pipeline_version` is attached for traceability.
- **Speed**: the default ~4k combinations take a few seconds in-process; when there is no SE constraint, shielding evaluation is skipped automatically.
- **Self-consistency acceptance**: candidates are produced by evaluation with the physics engine; the tests feed the Top candidates back into the engine for re-checking,
  with an error of 0 (without relying on the NN surrogate). The M2.5 NN surrogate can serve as a later acceleration backend with an unchanged interface.
- **Extrapolation domain**: the default scan space is the same as the NN surrogate training domain (outer 20–80, metal 5–20 nm),
  going beyond it requires your own trade-off (model boundaries such as percolation effects, see HANDOVER §6.9).
