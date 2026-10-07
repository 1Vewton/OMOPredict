# omo.electrical —— electrical simulation (M1 implemented)

> **English** · [中文版](README.md)

## Responsibility

Compute the electrical performance of multilayer films:

- **Sheet resistance Rs (Ω/sq)**: in-plane parallel equivalent model of the multilayer film (1/Rs = Σ dᵢ/ρ_eff,ᵢ)
- **Resistivity size effect of ultrathin metals**: Fuchs–Sondheimer model (exact integral form), non-negligible for metal layers at ~5–15 nm
- Material constants: Ag / ITO (`materials.py`, annotated with literature sources)

## Implemented modules

- `sheet_resistance.py`: `sheet_resistance`, `ConductiveLayer`, `fuchs_sondheimer_ratio`
- `materials.py`: `SILVER_BULK_RESISTIVITY`, `SILVER_MEAN_FREE_PATH_NM`, `ITO_BULK_RESISTIVITY`

## How to call it

```python
from omo.electrical import (
    ITO_BULK_RESISTIVITY,
    SILVER_BULK_RESISTIVITY,
    SILVER_MEAN_FREE_PATH_NM,
    ConductiveLayer,
    sheet_resistance,
)

# ITO(40)/Ag(10)/ITO(40) —— Ag enables the size effect, ITO is counted in parallel
stack = [
    ConductiveLayer(thickness_nm=40.0, bulk_resistivity=ITO_BULK_RESISTIVITY, name="ITO"),
    ConductiveLayer(
        thickness_nm=10.0,
        bulk_resistivity=SILVER_BULK_RESISTIVITY,
        name="Ag",
        mean_free_path_nm=SILVER_MEAN_FREE_PATH_NM,  # enable Fuchs–Sondheimer
    ),
    ConductiveLayer(thickness_nm=40.0, bulk_resistivity=ITO_BULK_RESISTIVITY, name="ITO"),
]
rs = sheet_resistance(stack)  # -> float, Ω/sq
```

Studying the size effect on its own (resistivity enhancement factor):

```python
from omo.electrical import fuchs_sondheimer_ratio

ratio = fuchs_sondheimer_ratio(thickness_nm=10.0, mean_free_path_nm=52.0)  # ≈ 2.3
```

## Physical model and formulas

See `docs/physics/electrical.md` (parallel model, Fuchs–Sondheimer, literature sources).

## Units and conventions

- Thickness: nm; resistivity: Ω·m; sheet resistance: Ω/sq
- Insulating layers (ρ extremely large) may be omitted; weakly conductive layers (ITO) are automatically counted in parallel
- Specular scattering coefficient p ∈ [0,1] (default 0 fully diffuse; p=1 no size effect)
- Transparent-electrode figure of merit FoM = T¹⁰/Rs, which can be computed together with the transmittance from `omo.optics`

## Validation

- `tests/test_electrical.py`: single-layer Rs = ρ/d, parallel halving, zero thickness skipped,
  FS analytical limit for large thickness (1+3λ/8d), no enhancement at p=1, thickness monotonicity, ITO/Ag/ITO physical range, input validation
