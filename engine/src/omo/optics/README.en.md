# omo.optics —— optical simulation (M1 implemented)

> **English** · [中文版](README.md)

## Responsibility

Compute the optical performance of OMO multilayer stacks:

- **TMM (transfer-matrix method)**: implemented with the characteristic-matrix method, computing transmittance T, reflectance R, absorptance A (supporting incidence angle and s/p/unpolarized)
- **Drude metal dielectric function**: ε(ω) = ε∞ − ωp²/(ω²+iγω), with built-in common Ag parameters (`SILVER`)
- Output: 300–2500 nm spectral curves, average visible transmittance

## Implemented modules

- `transfer_matrix.py`: TMM solver (`transfer_matrix`, `Layer`, `OpticalSpectrum`)
- `drude.py`: `DrudeMaterial` (can serve as the layer refractive-index source for dispersive materials)

## How to call it

```python
import numpy as np
from omo.optics import Layer, SILVER, transfer_matrix

# ITO(40nm)/Ag(10nm)/ITO(40nm), glass substrate, normal incidence, unpolarized (default)
stack = [
    Layer(index=1.8 + 0j, thickness_nm=40.0),   # ITO (approximately lossless in the visible)
    Layer(index=SILVER, thickness_nm=10.0),     # Ag (Drude dispersive material, callable object)
    Layer(index=1.8 + 0j, thickness_nm=40.0),   # ITO
]
wl = np.linspace(400.0, 1000.0, 601)
spec = transfer_matrix(stack, wl)

spec.transmittance   # T(λ)
spec.reflectance     # R(λ)
spec.absorptance     # A(λ) = 1 − T − R
spec.visible_average_transmittance()   # average visible transmittance (default 400–800 nm)
```

Usage with incidence angle and polarization:

```python
spec_s = transfer_matrix(stack, wl, angle_deg=45.0, polarization="s")
spec_p = transfer_matrix(stack, wl, angle_deg=45.0, polarization="p")
spec_u = transfer_matrix(stack, wl, angle_deg=45.0)  # unpolarized = (s+p)/2
```

## Physical model and formulas

See `docs/physics/tmm.md` (characteristic-matrix method, Drude model, conventions and literature sources).

## Units and conventions

- Thickness: nm; wavelength: nm; n/k dimensionless
- No-scattering assumption: T + R + A = 1
- The incident/exit media must be non-absorbing (default air 1.0 / glass 1.5); incidence angle [0, 90)°
- Complex refractive index branch convention Re(ñ) ≥ 0

## Validation

- `tests/test_transfer_matrix.py`: bare-interface Fresnel, single-layer Airy analytical solution, quarter-wave antireflection (R→0),
  half-wave film regression to the bare interface, thin-layer limit, energy conservation (absorbing layer), polarization splitting and unpolarized average, input validation
- `tests/test_drude.py`: Drude analytical properties (ε at ω=ωp, metallic behaviour, high-frequency limit), scalar/array returns, input validation
