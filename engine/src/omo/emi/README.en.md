# omo.emi —— electromagnetic shielding effectiveness simulation (M1 implemented)

> **English** · [中文版](README.md)

## Responsibility

Compute the electromagnetic shielding effectiveness (EMI SE, dB) of multilayer films:

- **Transmission-line model (exact)**: SE(f) of multilayer films, normally incident plane wave
- **Schelkunoff component decomposition**: SE = SE_R + SE_A + SE_M (single layer, exact decomposition)
- **Thin conductive film approximation**: SE ≈ 20·log₁₀(1 + Z₀/(2·Rs)), Z₀ = 376.73 Ω (d ≪ δ scenario, Rs comes from `omo.electrical`)

## Implemented modules

- `shielding.py`: `shielding_effectiveness`, `thin_film_se`, `schelkunoff_components`, `ShieldingLayer`, `ShieldingSpectrum`, `SchelkunoffResult`
- `materials.py`: `SILVER_BULK_CONDUCTIVITY`, `ITO_BULK_CONDUCTIVITY` (from the electrical single data source)

## How to call it

```python
import numpy as np
from omo.electrical import (
    ITO_BULK_RESISTIVITY,
    SILVER_BULK_RESISTIVITY,
    SILVER_MEAN_FREE_PATH_NM,
    ConductiveLayer,
    sheet_resistance,
)
from omo.emi import ShieldingLayer, shielding_effectiveness, thin_film_se

# Construct shielding layers from the electrical module's conductive layers (σ_eff includes the Fuchs–Sondheimer size effect)
ag = ConductiveLayer(10.0, SILVER_BULK_RESISTIVITY, "Ag", SILVER_MEAN_FREE_PATH_NM)
ito = ConductiveLayer(40.0, ITO_BULK_RESISTIVITY, "ITO")
stack = [ShieldingLayer.from_conductive_layer(x) for x in (ito, ag, ito)]

freqs = np.linspace(1.0, 18.0, 171)          # GHz
spec = shielding_effectiveness(stack, freqs)
spec.se_db                 # SE(f), dB
spec.x_band_average()      # X-band (8.2–12.4 GHz) average, dB

# Thin-film approximation: use the total sheet resistance directly (agrees with the transmission-line model when d ≪ δ)
rs = sheet_resistance([ito, ag, ito])
thin_film_se(rs)           # ≈ spec.x_band_average()

# Schelkunoff component decomposition (single layer)
from omo.emi import schelkunoff_components
comp = schelkunoff_components(freqs, thickness_nm=3175.0, conductivity=6.29e7)
comp.total_db              # = SE_R + SE_A + SE_M, consistent with single-layer shielding_effectiveness
```

## Physical model and formulas

See `docs/physics/emi.md` (transmission-line model, Schelkunoff decomposition, thin-film approximation, literature sources).

## Units and conventions

- Frequency: GHz; thickness: nm; conductivity: S/m; SE: dB
- The media on both sides default to free space (Z₀ = 376.73 Ω, see `omo.constants`); the SE definition requires both sides to be identical
- Thin film (d ≪ δ): SE is determined by the total sheet resistance and is flat versus frequency; thick layer: absorption-dominated, SE ∝ √f
- Total attenuation of conductive layers Σαd ≲ 100 (for millimetre-scale solid metal plates use `schelkunoff_components`)

## Validation

- `tests/test_emi.py`: analytical value of the thin-film approximation, 10nm Ag consistent with the Rs formula (±0.2 dB),
  Schelkunoff component sum strictly consistent with the transmission-line model (1e-6 dB), analytical value SE_A = 8.686·d/δ,
  frequency growth for thick layers / flatness for thin layers, ITO/Ag/ITO X-band > 25 dB, glass medium does not shield, input validation
