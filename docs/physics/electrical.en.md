# Electrical model (omo.electrical)

> **English** · [中文版](electrical.md)

> Status: implemented in M1 (`engine/src/omo/electrical/sheet_resistance.py`, `materials.py`).
> This document is maintained in sync with the code (AGENTS.md rule 10).

## 1. Model overview

For a multilayer film (conductive layers in parallel within the film plane), compute the total
sheet resistance Rs; for ultrathin metal layers (d ~ 5–15 nm) the resistivity enhancement caused
by Fuchs–Sondheimer surface scattering is taken into account.

## 2. Parallel sheet-resistance model

The current flows in the film plane, so the conductances of the conductive layers are in parallel:

    1/Rs = Σ 1/Rs_i = Σ d_i / ρ_eff,i

where Rs_i = ρ_eff,i / d_i is the sheet resistance of layer i when it exists alone.
The contribution of insulating layers (ρ extremely large, e.g. SiO₂) is negligible and can be
omitted; weakly conductive layers (e.g. ITO) are counted automatically.

Units: thickness in nm, resistivity in Ω·m, sheet resistance in Ω/sq (Rs = ρ/d, with d converted to m).

## 3. Fuchs–Sondheimer size effect

In ultrathin metal films, surface scattering shortens the effective mean free path and the effective resistivity increases:

    ρ_film/ρ_bulk = 1 / [1 − (3(1−p)/(2κ))·∫₁^∞ (1/t³ − 1/t⁵)(1−e^(−κt))/(1−p·e^(−κt)) dt]

where κ = d/λ, λ is the bulk electron mean free path and p is the specular scattering coefficient.

- p = 0: fully diffuse surface scattering (default), the largest enhancement
- p = 1: fully specular scattering, no size effect (the ratio is always 1)
- large-thickness limit (κ ≫ 1): ρ_film/ρ_bulk ≈ 1 + 3(1−p)λ/(8d)
- extremely thin films (κ → 0): the resistivity diverges (model failure region, numerically guarded in the implementation)

The implementation uses exact numerical integration with `scipy.integrate.quad`.

## 4. Material constants (materials.py)

| Constant | Value | Source |
|---|---|---|
| SILVER_BULK_RESISTIVITY | 1.59×10⁻⁸ Ω·m | CRC Handbook (bulk silver at room temperature) |
| SILVER_MEAN_FREE_PATH_NM | 52 nm | commonly used value for FS analysis of ultrathin silver films (52–57 nm), M2 calibration |
| ITO_BULK_RESISTIVITY | 1.5×10⁻⁶ Ω·m | typical sputtered-ITO literature value (process-dependent), M2 calibration |

## 5. Validation

- single layer: Rs = ρ/d (Ag 10 nm → 1.59 Ω/sq)
- parallel: two identical layers → the sheet resistance is halved; a zero-thickness layer contributes nothing
- FS: κ≫1 analytic limit 1+3λ/8d; p=1 no enhancement; monotonicity in thickness (r(5) > r(10) > r(100) > 1)
- ITO/Ag/ITO: Rs ∈ (2, 4) Ω/sq, and lower than pure Ag (parallel contribution of ITO)
- all of the above in `engine/tests/test_electrical.py`

## 6. References

- E. Fuchs, Proc. Cambridge Philos. Soc. 34, 100 (1938)
- E. H. Sondheimer, Adv. Phys. 1, 1 (1952)
- C. R. Tellier, A. J. Tosser, *Size Effects in Thin Films*, Elsevier (1982)
- H. S. Nalwa (ed.), *Handbook of Thin Film Materials* (review of Ag electrical parameters)
