# omo.benchmark —— literature benchmarking and error evaluation (M2 complete)

> **English** · [中文版](README.md)

## Responsibility

Validate simulation results against measured data from high-quality papers (the core of this project's differentiating goal):

- Load the literature datasets under `docs/benchmarks/` (including source, DOI, extraction conditions)
- Automatically run simulation vs. measurement, output MAE / RMSE / relative-error reports and visual comparison plots
- Model-constant calibration loop: simulation — measurement — calibration (sensitivity analysis → fitting → hold-out validation)

## Implemented modules

| Module | Responsibility |
|---|---|
| `schema.py` | Dataset data model + JSON loading/validation (`load_dataset` / `parse_dataset`, a format error raises `SchemaError`) |
| `materials.py` | Material name → engine input (optical + electrical); `MaterialResolver` supports dataset overrides (calibration output) |
| `runner.py` | `simulate_record`: dispatch to optics/electrical/emi according to the quantities declared by measured |
| `metrics.py` | `compute_metrics`: MAE / RMSE / maximum absolute error / relative MAE |
| `report.py` | `run_benchmark`: aggregation by quantity + per-record detail + record-subset filtering (hold-out); JSON + scatter plot |
| `calibrate.py` | `sensitivity_analysis` / `calibrate`: sensitivity screening → L-BFGS-B fitting → training/validation error comparison |

## How to call it

```python
from omo.benchmark import load_dataset, run_benchmark

dataset = load_dataset("docs/benchmarks/synthetic_ito_ag_ito.json")
report = run_benchmark(dataset)

report.quantities            # {"transmittance": QuantityMetrics, "sheet_resistance_log10": ...}
report.quantities["transmittance"].mae
report.to_dict()             # JSON conversion (metrics + per-record error)
report.save_json("report.json")
report.plot("report.png")    # measured vs. simulated scatter plot
```

### Model calibration (M2.3)

```python
from omo.benchmark import CalibrationConstant, calibrate, sensitivity_analysis

sens = sensitivity_analysis(datasets, candidates)   # sensitivity ranking, select 1–3
result = calibrate(datasets, top_constants,
                   train_record_ids=train, val_record_ids=val)  # hold-out
result.fitted          # {"Ag_bulk_resistivity": 2.6e-08, ...}
result.before_val      # validation-set error before calibration
result.after_val       # validation-set error after calibration
result.save_json("calibration_report.json")
```

For calibration discipline and how to read the results, see `docs/benchmarks/calibration.md`.

Sheet resistance is evaluated in **log₁₀ space** (across orders of magnitude); transmittance/reflectance/SE use absolute values.
Missing entries in a record are supported: a record that only has Rs will not trigger optical/shielding simulation.
`run_benchmark(..., record_ids=...)` can restrict to a subset of records (used by calibration hold-out).

## Dataset format

See `docs/benchmarks/README.md` (the full JSON schema) and `docs/benchmarks/synthetic_ito_ag_ito.json` (example).

Key points:
- Each record: layer stack (material + thickness_nm) + measured (T/R wavelength points, Rs, SE frequency points/X-band average, any subset)
- Must carry paper metadata (title/authors/year/**DOI**) and extraction conditions (extraction)
- Transmittance/reflectance are fractions (0–1); Rs in Ω/sq; SE in dB
- The `simulation.materials` section can override material constants (M2.3 calibration output)

## Validation

- `tests/test_benchmark.py`: schema validation (missing fields/invalid values/empty records),
  synthetic-data round trip (the framework reproduces the engine output, MAE < 1e-9), material overrides, records with missing entries, report JSON/PNG output
