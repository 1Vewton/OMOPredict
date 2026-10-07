# TMM optics model (omo.optics)

> **English** · [中文版](tmm.md)

> Status: implemented in M1 (`engine/src/omo/optics/transfer_matrix.py`, `drude.py`).
> This document is maintained in sync with the code (AGENTS.md rule 10).

## 1. Model overview

For N isotropic thin-film layers (incident medium 0 → layers 1..N → exit medium s), given the
wavelength λ, the angle of incidence θ₀, the complex refractive index of each layer
ñⱼ = nⱼ + i·kⱼ and the thickness dⱼ, compute the transmittance T, reflectance R and absorptance A.

## 2. Characteristic matrix method (Macleod convention)

For the polarization pol ∈ {s, p}, define the optical admittance of layer j:

    s polarization: ηⱼ = ñⱼ · cos θⱼ
    p polarization: ηⱼ = ñⱼ / cos θⱼ

θⱼ is determined by the complex Snell law:

    ñⱼ · sin θⱼ = n₀ · sin θ₀
    cos θⱼ = sqrt(1 − (n₀·sin θ₀ / ñⱼ)²)

Phase thickness:

    δⱼ = 2π · ñⱼ · dⱼ · cos θⱼ / λ

Characteristic matrix of each layer:

    Mⱼ = [[cos δⱼ,        i·sin δⱼ / ηⱼ],
          [i·ηⱼ·sin δⱼ,          cos δⱼ]]

Overall matrix M = M₁·M₂·…·M_N. Let [B, C]ᵀ = M·[1, η_s]ᵀ; then (both incident and exit media non-absorbing):

    R = |(η₀·B − C) / (η₀·B + C)|²
    T = 4·η₀·Re(η_s) / |η₀·B + C|²
    A = 1 − R − T

Implementation notes:

- all computations use complex arithmetic, so absorbing layers (k > 0) are handled naturally;
- the unpolarized result is the average of s and p: T = (T_s + T_p)/2;
- an empty layer sequence (stack = []) represents a bare interface, and the matrix product degenerates to the identity matrix.

## 3. Drude metal dielectric function

    ε(ω) = ε_∞ − ω_p² / (ω² + i·γ·ω)

Wavelength-to-photon-energy conversion: E[eV] = h·c/(e·λ[nm]) ≈ 1239.84 eV·nm / λ[nm].
In the implementation ω_p and γ are given in energy units (ħ·ω_p, ħ·γ), decomposed as:

    ε' = ε_∞ − ω_p²/(ω² + γ²)
    ε'' = ω_p²·γ / (ω·(ω² + γ²))

The complex refractive index follows from ñ = sqrt(ε), with the branch convention Re(ñ) ≥ 0.

Built-in Ag parameters (`SILVER`): ε_∞ = 3.7, ħ·ω_p = 9.1 eV, ħ·γ = 0.02 eV —
a Drude fit to the measured optical constants of Johnson & Christy (1972), widely found in
the literature on OMO system simulation; the M2 benchmarking stage will calibrate it against
measured data.

## 4. Conventions and assumptions

- units: thickness in nm, wavelength in nm; n/k dimensionless
- no-scattering assumption: T + R + A = 1
- the incident/exit media must be non-absorbing (default air 1.0 / glass 1.5)
- angle of incidence range [0, 90)°; total internal reflection is not handled at the exit interface (it does not exist when n₀ < n_s)
- roughness between layers and interfacial diffusion layers are ignored (discussed as a systematic error during M2 benchmarking)

## 5. Validation

- bare interface: consistent with the Fresnel formulas (normal and oblique incidence, s/p)
- single non-absorbing layer: consistent with the Airy analytic expression
- quarter-wave antireflection (n₁ = √(n₀·n_s)): R → 0 at the design wavelength
- half-wave film / extremely thin layer: recovers the bare-interface result
- absorbing layer: 0 ≤ T, R, A ≤ 1 and A > 0
- s/p identical at normal incidence, split at oblique incidence, unpolarized as the average
- all of the above in `engine/tests/test_transfer_matrix.py`, `test_drude.py`

## 6. References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., CRC Press (2017), Ch. 2
- E. Hecht, *Optics*, 5th ed., Pearson (2016)
- P. B. Johnson, R. W. Christy, "Optical constants of the noble metals",
  Phys. Rev. B 6, 4370 (1972)
- Tiesinga et al., "CODATA recommended values of the fundamental physical constants",
  Rev. Mod. Phys. 93, 025010 (2021)
