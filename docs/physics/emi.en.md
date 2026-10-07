# Electromagnetic shielding effectiveness model (omo.emi)

> **English** · [中文版](emi.md)

> Status: implemented in M1 (`engine/src/omo/emi/shielding.py`, `materials.py`).
> This document is maintained in sync with the code (AGENTS.md rule 10).

## 1. Model overview

For a multilayer film (normally incident plane wave, free space on both sides), compute the shielding effectiveness
SE = 20·log₁₀(E_i/E_t) [dB] (power on both sides of free space ∝ |E|²).

## 2. Transmission-line model (exact, multilayer)

Each layer is regarded as a transmission-line section with characteristic impedance η_j and propagation constant γ_j:

    η_j = sqrt(j·ω·μ_j / (σ_j + j·ω·ε_j))
    γ_j = sqrt(j·ω·μ_j·(σ_j + j·ω·ε_j))

where μ_j = μ₀·μ_rj, ε_j = ε₀·ε_rj, ω = 2π·f; γ and η take the principal branch (Re ≥ 0 for passive media).

Layer ABCD matrix:

    L_j = [[cosh(γ_j·d_j),  η_j·sinh(γ_j·d_j)],
           [sinh(γ_j·d_j)/η_j,      cosh(γ_j·d_j)]]

Total matrix M = ∏L_j, exit-medium wave impedance η_s, then the electric-field transmission coefficient is:

    t = E_t/E_i = 2η_s / (M11·η_s + M12 + η_0·η_s·M21 + η_0·M22)

SE = 20·log₁₀(1/|t|).

Implementation notes:

- all complex arithmetic; the glass substrate is counted as a dielectric layer with σ=0 (ε_r = 2.25);
- empty layer sequence (no shielding): t=1, SE=0;
- the definition of SE requires identical media on both sides (free space by default);
- numerical limit: total attenuation of the conductive layers Σαd ≲ 100 (cosh/sinh overflow); for millimetre-scale
  solid metal plates, evaluate with the Schelkunoff component formulas.

## 3. Schelkunoff component decomposition (single layer)

For a single homogeneous shield (free space on both sides), SE can be decomposed exactly (derivation: expand 1/t):

    SE_A = 20·log₁₀|e^{γd}|          (absorption loss)
    SE_R = 20·log₁₀|(Z₀+η)²/(4Z₀η)|  (reflection loss)
    SE_M = 20·log₁₀|1 − q·e^{−2γd}|  (multiple reflections, q = ((Z₀−η)/(Z₀+η))²)

- large-thickness limit: SE_M → 0, SE_A ≈ 8.686·d/δ (δ = 1/√(πfμσ) skin depth);
- thin-film limit: SE_M ≈ −SE_R (they cancel), and the total SE is determined by the sheet resistance (see Section 4);
- the sum of the components is an exact decomposition, point-by-point identical to the transmission-line model (the implementation uses this property for unit tests).

## 4. Thin conductive film approximation

For a transparent conductive film (d ≪ δ), SE is determined by the total sheet resistance Rs:

    SE ≈ 20·log₁₀(1 + Z₀/(2·Rs))

This expression can be derived rigorously from the thin-film limit of the transmission-line model (σ·d = 1/Rs, M ≈ [[1,0],[1/Rs,1]]).
Rs is computed by omo.electrical (including the Fuchs–Sondheimer size effect).

### 4.1 Frequency flatness (frequent question: why is SE(f) a straight line)

**Conclusion: for a thin conductive film (d ≪ δ), a flat SE(f) is physically correct behaviour, not a bug.**

Reasons:

1. the expression above **contains no frequency** — in the thin-film regime SE is determined only by Rs;
2. Rs is independent of frequency from 1–18 GHz (dispersion of the metal conductivity only becomes
   significant at THz frequencies, ω ≪ the relaxation frequency);
3. for example ITO(40)/Ag(10)/ITO(40): SE = 33.704 dB @ 1/5/10/18 GHz (completely flat,
   point-by-point identical to the transmission-line model to <0.001 dB).

**When it is no longer flat**: once the metal layer is thick enough to be comparable with the skin depth (d ≳ δ), the absorption loss
SE_A = 8.686·d/δ dominates, and δ = 1/√(πfμσ) ∝ 1/√f → SE rises with frequency (∝√f).
Example: Ag 3.2 µm (≈5δ @10GHz) SE = 92.7 → 124.7 dB (1 → 18 GHz).
"Flat line vs. rising" reflects the switch of the shielding mechanism: thin layers are reflection-dominated (frequency-independent), thick layers are absorption-dominated (√f).

**Consistent with the literature**: real measurements of transparent ITO/Ag/ITO films are equally flat (e.g. Voronin 2025,
Materials 18, 5393: SE uniformly 25–30 dB covering 10 MHz–1 THz, the M2 benchmarking dataset of this project).

**Difference from measurement**: this model is ideally flat (exact to 0.001 dB); real samples show <1 dB ripple
because of the test setup and slight dispersion — an expected difference, not a model error.

## 5. Material parameters (materials.py)

| Constant | Value | Source |
|---|---|---|
| SILVER_BULK_CONDUCTIVITY | 6.29×10⁷ S/m | 1/ρ_Ag (CRC Handbook, see electrical) |
| ITO_BULK_CONDUCTIVITY | 6.67×10⁵ S/m | 1/ρ_ITO (reference value, process-dependent) |

Effective conductivity including the size effect: `ShieldingLayer.from_conductive_layer` (σ_eff = 1/ρ_eff).

## 6. Validation

- analytic value of the thin-film approximation; a 10 nm Ag single layer is consistent with the Rs formula (±0.2 dB)
- the Schelkunoff component sum is strictly consistent with the transmission-line model (1e-6 dB)
- SE_A = 8.686·d/δ analytic value; thick layers SE ∝ √f, thin layers frequency-flat
- ITO/Ag/ITO: X-band SE ≈ 34 dB (literature range 25–35 dB)
- glass dielectric does not shield (< 0.5 dB); parameter validation
- all of the above in `engine/tests/test_emi.py`

## 7. References

- S. A. Schelkunoff, *Electromagnetic Waves*, Van Nostrand (1943)
- C. R. Paul, *Introduction to Electromagnetic Compatibility*, 2nd ed., Wiley (2006)
- H. W. Ott, *Electromagnetic Compatibility Engineering*, Wiley (2009)
