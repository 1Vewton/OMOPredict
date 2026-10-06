// ============================================================================
//  OMOPredict — Project Overview / 项目总览
//  Bilingual document: English version (Part I), then Chinese version (Part II).
//  Build:  typst compile omopredict-overview.typ omopredict-overview.pdf
//  Facts in this document were verified on 2026-10-03 by running every test
//  suite recorded in Section 1.5 / 2.5 (see "Verification note").
// ============================================================================

#set document(
  title: "OMOPredict — Project Overview / 项目总览",
  author: "OMOPredict project",
  date: datetime(year: 2026, month: 10, day: 3),
  keywords: ("OMO", "thin film", "TMM", "EMI shielding", "inverse design", "Typst"),
)

// ---------------------------------------------------------------- page & type
#set page(
  paper: "a4",
  margin: (x: 2.2cm, top: 2.3cm, bottom: 2.2cm),
  numbering: "1",
  footer: context [
    #set text(size: 8.5pt, fill: luma(120))
    #grid(
      columns: (1fr, auto),
      [OMOPredict · Project Overview · 2026-10-03],
      [#counter(page).display()],
    )
  ],
)

#set text(font: ("Libertinus Serif", "Microsoft YaHei"), size: 10.5pt, lang: "en")
#set par(justify: true, leading: 0.72em, spacing: 1.05em)
#set heading(numbering: "1.1")
#show raw.where(block: true): set text(size: 8.5pt, font: "DejaVu Sans Mono")
#set table(stroke: 0.5pt + luma(185), inset: 6pt, fill: (_, y) => if y == 0 { luma(240) } else { none })

#show heading.where(level: 2): set text(size: 13.5pt, weight: "bold", fill: rgb("#12395c"))
#show heading.where(level: 3): set text(size: 11.5pt, weight: "bold", fill: rgb("#2d5f8a"))
#show heading.where(level: 1): it => {
  v(0.3em)
  align(center, block(width: 100%)[
    #set text(size: 21pt, weight: "bold", fill: rgb("#12395c"))
    #it.body
  ])
  v(0.6em)
  line(length: 100%, stroke: 1pt + rgb("#12395c"))
  v(0.6em)
}

#let sub(t) = heading(level: 3, numbering: none)[#t]
// Part banners are level-1 headings WITH numbering enabled, so that the level-1
// counter advances (giving section numbers 1.x for English, 2.x for Chinese);
// the show rule below hides the number itself by rendering `it.body`.
#let banner(t) = heading(level: 1)[#t]

#let callout(title, body) = block(
  width: 100%,
  fill: rgb("#f4f7fa"),
  stroke: (left: 3pt + rgb("#1a4f7a")),
  inset: (x: 10pt, y: 8pt),
  radius: 2pt,
  above: 0.7em,
  below: 0.7em,
)[#text(weight: "bold", fill: rgb("#12395c"))[#title] #body]

#let diagram(src, caption) = block(
  width: 100%,
  fill: luma(248),
  inset: 9pt,
  radius: 3pt,
  above: 0.8em,
  below: 0.3em,
  raw(src, lang: "text", block: true),
)
#let dcap(caption) = align(center)[#text(size: 8.8pt, style: "italic", fill: luma(90))[#caption]]

// ---------------------------------------------------------------- diagrams
#let arch_web = "┌──────────────┐  REST/JSON  ┌──────────────┐   HTTP    ┌──────────────┐
│  Vue 3 + TS  │ ──────────▶ │      Go      │ ────────▶ │   omo.api    │
│   frontend   │ ◀────────── │  middleware  │ ◀──────── │  (FastAPI)   │
└──────────────┘             └──────────────┘           └──────────────┘"

#let arch_desktop = "┌────────────┐   IPC    ┌──────────────┐  stdio  ┌──────────┐  stdio  ┌───────────┐
│ Vue 3 + TS │ ───────▶ │   Electron   │ ──────▶ │    Go    │ ──────▶ │  omo.rpc  │
│ (renderer) │ ◀─────── │ main + Host  │ ◀────── │ --stdio  │ ◀────── │  engine   │
└────────────┘          └──────────────┘         └──────────┘         └───────────┘"

#let pipeline = "  structure                physics engine                 performance
┌───────────────┐        ┌─────────────────────┐        ┌───────────────────┐
│ layer stack:  │        │  TMM  (optics)      │        │  T(λ), R(λ), A(λ) │
│ thickness_nm  │ ─────▶ │  parallel + F–S     │ ─────▶ │  Rs  [Ω/sq]       │
│ material      │        │  transmission line  │        │  SE(f) [dB]       │
│ substrate / ρ │        │  (EMI shielding)    │        │  FoM = T¹⁰/Rs     │
└───────────────┘        └─────────────────────┘        └───────────────────┘"

#let loop = "   literature data            simulation              calibration
┌────────────────────┐     ┌────────────────┐     ┌──────────────────────┐
│ 3 papers, measured │     │  run the same  │     │ fit effective params │
│ T / Rs / SE points │ ──▶ │  stack in the  │ ──▶ │ (Ag ρ, Ag λ, ITO n)  │
│ (DOI recorded)     │     │  engine        │     │ then re-check MAE    │
└────────────────────┘     └────────────────┘     └──────────────────────┘"

// ============================================================================
//  COVER
// ============================================================================
#page(numbering: none, margin: (x: 2.5cm, y: 2.5cm))[
  #v(2.2cm)
  #align(center)[
    #text(size: 9.5pt, tracking: 2.5pt, fill: rgb("#5b7c99"))[PROJECT OVERVIEW · 项目总览]
    #v(0.6cm)
    #text(size: 34pt, weight: "bold", fill: rgb("#12395c"))[OMOPredict]
    #v(0.5cm)
    #line(length: 55%, stroke: 0.8pt + luma(160))
    #v(0.5cm)
    #text(size: 13pt)[
      A lightweight simulation and design tool for\
      oxide–metal–oxide (OMO) nanolaminate thin films
    ]
    #v(0.35cm)
    #text(size: 11.5pt, fill: rgb("#2d5f8a"))[
      面向 OMO（氧化物/金属/氧化物）纳米多层薄膜的轻量化仿真与设计软件
    ]
  ]

  #v(1.2cm)
  #align(center, block(width: 78%)[
    #set text(size: 10pt)
    #table(
      columns: (auto, 1fr),
      inset: (x: 6pt, y: 5pt),
      stroke: none,
      align: (right, left),
      [*Version*], [0.1.0],
      [*Date*], [3 October 2026 / 2026 年 10 月 3 日],
      [*Repository*], [github.com/1Vewton/OMOPredict],
      [*Stack*], [Python 3.12 (numpy / scipy) · Go 1.25 · Vue 3 + TypeScript · Electron],
      [*Form*], [Web/development and desktop (single-user, no listening port)],
      [*Status*], [M0–M5 complete · desktop T1–T8 complete, T9 mostly complete · T10–T11 pending],
    )
  ])

  #v(1.0cm)
  #align(center, block(width: 88%)[
    #callout([At a glance:], [
      132 Python tests · 60 frontend tests · 150 desktop tests · all Go packages passing ·
      reference case ITO(40)/Ag(10)/ITO(40) → Rs = 3.970819 Ω/sq, T\@550 nm = 0.974497,
      SE\@10 GHz = 33.7036 dB
    ])
  ])

  #v(0.6cm)
  #align(center)[#text(size: 9pt, fill: luma(110))[
    This document contains the English version (Part I) followed by the Chinese version (Part II).\
    本文档包含英文版（第 I 部分）与中文版（第 II 部分）。
  ]]
]

#pagebreak()

// ============================================================================
//  CONTENTS
// ============================================================================
#align(center)[#text(size: 17pt, weight: "bold", fill: rgb("#12395c"))[Contents / 目录]]
#v(0.4em)
#outline(title: none, depth: 2, indent: 1.2em)

#pagebreak()

// ============================================================================
//  PART I — ENGLISH
// ============================================================================
#banner[Part I · English Version]

== Project Overview

*OMOPredict* is a lightweight simulation and design tool for *oxide–metal–oxide (OMO)
nanolaminate thin films*, aimed at undergraduate research and course projects. It answers a
practical question that appears in every transparent-conductor lab: *given a layer stack, what
optical, electrical and electromagnetic performance should we expect — and which stack should we
build instead?*

The input is a physical description of the stack (per-layer thickness, refractive index or
dielectric function, resistivity, substrate index). The output is a set of device-level performance
figures:

- *Optical*: transmittance $T(lambda)$, reflectance $R(lambda)$, absorptance $A = 1 - T - R$, and the
  visible-range average transmittance.
- *Electrical*: sheet resistance $R_s$ (Ω/sq) including the size effect in ultrathin metal films.
- *Electromagnetic*: shielding effectiveness $"SE"(f)$ in dB, with a Schelkunoff decomposition into
  reflection, absorption and multiple-reflection terms.
- *Design*: constraint-driven inverse design (recommended thicknesses), per-layer sensitivity, and a
  per-layer process window.

What distinguishes the project is *where the numbers are checked*. Analytic sanity checks are the
baseline, but the acceptance criterion is agreement with *measured data extracted from peer-reviewed
papers*, with the source and DOI recorded next to every data point. A calibration loop
(simulate → compare → adjust effective parameters → re-validate on a holdout set) is part of the
codebase, not a one-off manual exercise.

Typical systems: ITO/Ag/ITO, ZnO/Ag/ZnO, TiO₂/Ag/TiO₂ and WO₃₋ₓ/Ag/WO₃₋ₓ. In all of them a very
thin metal layer (typically 5–20 nm) provides conduction and shielding, while the oxide layers
provide anti-reflection, protection and interface control.

== System Architecture

The project is deliberately split into three layers, each written in the language that fits its job,
with a *single source of truth for every contract*.

#table(
  columns: (auto, auto, 1fr),
  table.header([*Layer*], [*Technology*], [*Responsibility*]),
  [Data science], [Python 3.12], [Physical modelling: optical TMM, sheet resistance, EMI shielding, inverse design, literature benchmarking, surrogate model],
  [Middleware], [Go 1.25], [User handling, task orchestration, result persistence, REST API and stdio JSON-RPC, engine lifecycle],
  [Frontend], [Vue 3 + TS], [Parameter entry, result charts, task history, target-driven design; computes nothing itself],
  [Desktop shell], [Electron + TS], [Single-user local form: starts and supervises the Go backend and the Python engine],
)

Two deployment forms share *the same source code, the same physics and the same JSON payloads*;
only the transport and the authentication mode differ.

#diagram(arch_web, "Web / development form")
#dcap[Figure 1 — Web form: REST/JSON from the frontend to Go, JWT authentication, HTTP from Go to the FastAPI engine.]

#diagram(arch_desktop, "Desktop form")
#dcap[Figure 2 — Desktop form: Electron IPC from the renderer to the Host layer, then stdio JSON-RPC from Go to the engine. No process listens on a port.]

#sub[Design rules that the repository enforces]

- *Physics lives only in Python.* Go orchestrates and stores; the frontend never computes a result.
  This keeps a single implementation of every formula.
- *One contract, two transports.* The params and results of `simulate` / `optimize` are field-for-field
  identical over HTTP and over stdio, and this equality is asserted by tests on both sides
  (Go: `contract_test.go`; Python: `test_rpc.py`).
- *The engine is a child process, not a service, in desktop mode.* `OMO_ENGINE_TRANSPORT=stdio` makes Go
  spawn the engine and speak JSON-RPC over pipes. If the engine cannot be resolved, startup fails loudly
  rather than silently falling back to HTTP — a silent fallback would break the "no port" guarantee.
- *Optional dependencies are excluded by design.* The engine's base install is only numpy + scipy;
  FastAPI/uvicorn (extra `api`), torch (extra `neural`) and matplotlib (extra `plot`) are opt-in, and an
  import-graph test asserts that importing the stdio entry point pulls in none of them.

== Physics Core

Every model carries its literature source in the module docstring, and each has dedicated unit tests
plus benchmark tests against measured data.

#table(
  columns: (auto, 1fr, 1fr),
  table.header([*Module*], [*Model and key relations*], [*Source*]),
  [Optics],
  [Transfer-matrix method (characteristic matrix, Macleod sign convention). Per layer
   $M_j = mat(cos delta_j, -i sin delta_j \/ eta_j; -i eta_j sin delta_j, cos delta_j)$, then
   $T = 4 eta_0 "Re"(eta_s) \/ abs(eta_0 B + C)^2$. Supports angle and s/p polarization in the library.],
  [Macleod, _Thin-Film Optical Filters_, 5th ed. (2017)],
  [Metal dispersion],
  [Drude dielectric function $epsilon(omega) = epsilon_infinity - omega_p^2 \/ (omega^2 + i gamma omega)$;
   for Ag: $epsilon_infinity = 3.7$, $ħ omega_p = 9.1$ eV, $ħ gamma = 0.02$ eV.],
  [Palik / literature values, centralized in the material registry],
  [Electrical],
  [Parallel in-plane conductance $1 \/ R_s = sum_i d_i \/ rho_"eff",i$ combined with the
   Fuchs–Sondheimer size effect for films whose thickness is comparable to the electron mean free path.],
  [Fuchs (1938); Sondheimer (1952); Tellier & Tosser (1982)],
  [EMI shielding],
  [Transmission-line (ABCD) model, exact for a multilayer at normal incidence, plus the Schelkunoff
   decomposition $"SE" = "SE"_R + "SE"_A + "SE"_M$ and the thin-film limit
   $"SE" approx 20 log_10 (1 + Z_0 \/ (2 R_s))$.],
  [Schelkunoff (1943); Paul (2006); Ott (2009)],
  [Inverse design],
  [Deterministic grid scan over the three thicknesses under hard constraints, ranked by the Haacke
   figure of merit $italic("FoM") = T_"vis"^10 \/ R_s$.],
  [Haacke, _J. Appl. Phys._ *47*, 4086 (1976)],
  [Surrogate],
  [Multilayer perceptron fitted to engine-generated samples; $R_s$ is learned in log space and the
   spectra are vector regressions on a fixed grid. Accuracy < 0.1 % with respect to the engine.],
  [Internal (M2.5); the engine remains the reference],
)

#callout([Why a surrogate at all?], [
The physics engine is the *only* validation baseline. The neural network exists to make large design
searches affordable; it never replaces the engine and is always reported against it.
])

== Feature Set

#sub[Simulation]

- Optical spectra over a configurable grid (default 380–1000 nm, 10 nm step, 63 points), with
  absorptance derived from the energy balance.
- Sheet resistance from a parallel-layer model with the Fuchs–Sondheimer correction for ultrathin
  metal, so that a 10 nm Ag layer is not treated as bulk silver.
- Shielding effectiveness over a configurable frequency grid (default 1–18 GHz, 1 GHz step), plus the
  exact Schelkunoff component split for interpreting *why* a stack shields the way it does.
- Graceful handling of non-conductive stacks: a pure-glass stack returns `sheet_resistance = null`
  and an empty SE series instead of an error.

#sub[Target-driven inverse design]

- Hard constraints may be combined freely: $T_"vis" >= x$, $R_s <= y$, $"SE" >= z$ within a frequency band.
- Exhaustive deterministic scan over the three-layer thickness space (default outer 20–80 nm step 4 nm,
  metal 5–20 nm step 1 nm ≈ 4096 combinations, roughly 3 s including the shielding evaluation;
  engine cap 2×10⁶ combinations).
- Feasible candidates ranked by the Haacke figure of merit, plus a *best-effort* candidate when no
  candidate satisfies every constraint.
- Per-layer sensitivity by ±1 nm finite differences (relative FoM change, absolute $T_"vis"$ change,
  $log_10 R_s$ change) and a per-layer process window (symmetric thickness tolerance that keeps the
  target feasible).
- The search calls the same evaluation path as the forward simulation, so an inverse-design answer is
  self-consistent with the forward model by construction; tests feed candidates back through the
  engine to confirm it.

#sub[Literature benchmarking and calibration]

- A dataset format that records the stack, the measured values, the extraction conditions and the DOI.
- Automatic comparison of simulation against measurement with MAE / RMSE / relative-error reports and
  comparison plots.
- A calibration pipeline (sensitivity analysis → bounded L-BFGS-B fit in log space → holdout
  validation) whose output is used as *dataset-scoped overrides*, never written back into the default
  physical constants.

#sub[Interfaces]

- `omo-cli optimize …` for scripted batch runs and quick experiments.
- REST API (`POST /simulate`, `POST /optimize`, `GET /health`, `GET /api/meta`) for the web form.
- stdio JSON-RPC (`ping` / `simulate` / `optimize`) for the desktop form and for the Go middleware.
- A Vue frontend with layer design, result charts (T/R spectra and SE curves), task history with
  deletion, and a dedicated target-driven design page with a candidate table and sensitivity display.
- A desktop form that starts with no login, keeps all data in the user's local application directory,
  and opens no network port.

#sub[Engineering]

- One CI workflow with five jobs: engine (ruff + pytest + CLI smoke), Go (gofmt + vet + build + test),
  frontend (lint + vitest + build), desktop (type-check + shell build + vitest), and packaging
  (real execution of the packaging scripts, including a test that the size gate really trips).
- Packaging scripts with explicit, contractual exit codes: 0 = package produced, 1 = build or gate
  failure, 2 = staged only (deliberately not claiming success when the shell is missing).
- Two size gates per package: a tight gate on the part the project controls (application payload
  ≤ 50 MB, measured ≈ 27 MB) and a loose gate on the part it does not (embedded runtime).

== Current Progress (as of 2026-10-03)

#sub[Milestones]

#table(
  columns: (auto, 1.7fr, 1.2fr),
  table.header([*Milestone*], [*Deliverable*], [*Status*]),
  [M0], [Scaffolding: Python project, Go skeleton, CI], [Complete],
  [M1], [Physics engine: TMM + Drude, parallel sheet resistance + Fuchs–Sondheimer, transmission-line shielding], [Complete],
  [M2], [Literature benchmark framework: three real datasets, reports, calibration loop], [Complete],
  [M2.5], [Neural surrogate: engine-generated data pipeline and forward surrogate for T / Rs / SE], [Complete],
  [M3], [Go middleware: users and JWT, GORM with SQLite/MySQL/PostgreSQL, task orchestration, REST API], [Complete],
  [M4], [Vue 3 frontend: registration/login, layer design, ECharts results, task history], [Complete],
  [M5], [Inverse design: v1 in the engine, v2 wired through the API and the frontend], [Complete; report export, advanced optimizers and surrogate acceleration pending],
  [M6], [Integration and polish; extended with the desktop form (Electron, single user, portless)], [In progress: T1–T8 complete, T9 mostly complete, T10–T11 pending],
)

#sub[Verified state of the codebase]

Repository at this date: 70 commits on `master`, 213 tracked files
(engine 63 · server 39 · frontend 47 · desktop 39 · docs 15 · scripts 5), working tree clean.
Every figure below was produced by *running the command*, not by reading the documentation.

#table(
  columns: (auto, auto, 1fr),
  table.header([*Layer*], [*Command*], [*Result*]),
  [Python engine], [`pytest`], [*132 passed*; `ruff check src tests` → all checks passed],
  [Go middleware], [`go test ./...`], [All packages ok: api, model, rpc, store, task, user],
  [Frontend], [`pnpm test` / `build` / `lint`], [*60 passed* in 5 files; build produced `dist`; lint clean],
  [Desktop], [`pnpm type-check` / `test`], [Type-check clean against real Electron types; *150 passed*, 3 environment-gated end-to-end cases skipped],
  [End-to-end values], [engine `simulate` on ITO(40)/Ag(10)/ITO(40)], [*Rs = 3.970819 Ω/sq · T\@550 nm = 0.974497 · SE\@10 GHz = 33.7036 dB* — identical to the documented API contract values],
)

#callout([Verification note], [
The end-to-end numbers above are the project's reference case. They are reproduced by the library
entry point, the HTTP API, the stdio RPC endpoint, the Go middleware and the desktop Host layer, which
is what makes the claim "the desktop form computes the same physics as the web form" testable rather
than aspirational.
])

#sub[Desktop form: task-by-task status]

The desktop form is tracked as T1–T11 in `docs/desktop.md`. Its design goal is that *no process
listens on any port* while the application runs.

#table(
  columns: (auto, 1.9fr, 1.3fr),
  table.header([*Task*], [*Scope*], [*Status*]),
  [T1], [Single-user mode (`OMO_AUTH_MODE=none`) and the capability endpoint `GET /api/meta`], [Complete],
  [T2], [Task deletion `DELETE /api/tasks/{id}` with ownership checks], [Complete],
  [T3], [Go-side stdio JSON-RPC dispatcher (`omopredict --stdio`)], [Complete],
  [T4], [Orchestration moved to the neutral `omo.sim` layer, stdio entry `omo.rpc`, optional extras, import-graph test], [Complete],
  [T4.5], [Go→engine stdio transport and four-level engine discovery; portless operation verified], [Complete],
  [T5], [Frontend transport abstraction (`window.omo` ⇒ IPC, otherwise HTTP) and capability gate], [Complete],
  [T6], [Desktop Host layer: paths, rotating logs, JSON-Lines framing, RPC client, backend supervision, singleton lock], [Complete],
  [T7], [Electron shell: `app://` protocol with traversal protection, CSP, IPC envelope, preload allowlist], [Complete in code — *never actually launched*],
  [T8], [Lightweight package: engine setup script, package assembly, size gates], [Complete],
  [T9], [Contract tests, `rpc-cli.ps1`, `build-desktop.ps1`, PyInstaller sidecar, CI packaging job], [Mostly complete: `start-local.ps1`, release upload with SHA-256 manifest and the full-package CI job remain],
  [T10], [Documentation consolidation], [Pending],
  [T11], [Clean-machine acceptance: shell launch and rendering, electron-builder run, portless check], [Pending],
)

#sub[What has been proven, and what has not]

- *Proven by execution*: the engine computes the reference values; the Go–engine stdio transport
  returns field-identical payloads with no listening socket; the Host layer supervises the backend
  through real pipes; the packaging scripts run and their size gates really trip; the PyInstaller
  sidecar computes correct results with no Python installed and contains zero entries for
  torch / fastapi / uvicorn / matplotlib.
- *Not yet proven*: the Electron shell has never been started (the binary cannot be downloaded in the
  development environment), so window creation, `app://` rendering and CSP behaviour are unverified;
  `electron-builder` has never been executed, so the final artifact layout is still a contract rather
  than an observation. Both belong to T11.

== Validation and Accuracy

#sub[Benchmark datasets]

Three published datasets are recorded, each with its stack, measured values, extraction conditions and
DOI. In total about nine measured points, each from a single deposition process.

#table(
  columns: (auto, 1fr, auto),
  table.header([*Source*], [*System*], [*Role*]),
  [Voronin 2025, _Materials_ *18*, 5393], [WO₃₋ₓ/Ag/WO₃₋ₓ and In₂O₃/Ag/In₂O₃], [Training subset; also the thin-Ag holdout samples],
  [Isiyaku 2020], [ITO/Al/Ag/ITO], [Training subset; constrains the oxide index],
  [Lim 2020], [WO₃₋ₓ/Ag/WO₃₋ₓ], [Training plus one holdout thickness],
)

#sub[Calibration outcome]

The loss is a quantity-weighted MSE (sheet resistance in $log_10$ space with weight 1, T and R in
absolute terms with weight 1, SE in dB with weight 0.1). Sensitivity analysis identifies the dominant
parameters, which are then fitted with bounds; thin-Ag samples and one WO₃₋ₓ thickness are held out.

#table(
  columns: (auto, auto, auto, auto),
  table.header([*Parameter*], [*Default*], [*Fitted*], [*Competing explanation*]),
  [Ag bulk resistivity $rho$], [1.59×10⁻⁸ Ω·m], [*2.60×10⁻⁸ Ω·m* (at bound)], [Interface and grain-boundary scattering not represented in the model],
  [Ag mean free path $lambda$], [52 nm], [*95 nm*], [Same effect absorbed into the size-effect term],
  [ITO refractive index $n$], [1.8], [*2.1* (at bound)], [Sputtered ITO genuinely spans 1.8–2.1 depending on process],
)

Weighted training loss falls from 7.75 to 0.59 (−92 %). On the held-out thin-Ag samples the
$log_10 R_s$ MAE falls from 0.374 to 0.183 (−51 %) but remains visibly worse than the training fit —
the expected signature of island growth and percolation in silver below roughly 10 nm, which the
continuous-film Fuchs–Sondheimer model does not describe.

#callout([How to read the fitted parameters], [
They are *effective simulation parameters*, not material properties. They absorb unmodelled interface
and grain-boundary scattering. The CRC bulk value for silver remains the true physical constant, and
the calibration output is applied as a dataset-scoped override rather than written into the registry.
Two of the three fitted values sit on their bounds, which is itself a result: it says the model form,
not the parameter value, is what needs to change.
])

#sub[What can and cannot be claimed]

- *Can be claimed*: within the calibrated systems, simulation reproduces the published transmittance
  to within a few percentage points and the sheet resistance to roughly 7 %; the model boundary at
  thin silver is identified rather than hidden.
- *Cannot be claimed*: global accuracy, accuracy for systems that were never benchmarked, accuracy in
  the thin-Ag regime, or any uncertainty statement — the tool returns point predictions with no error
  bars, and the process window is a deterministic tolerance rather than a statistical distribution.

== Limitations and Scope

The limitations below are known and deliberately kept; most of them are boundaries of the physical
model rather than defects waiting to be fixed.

#sub[1. Physical model and validity domain]

- *Percolation is not modelled.* Below roughly 10 nm, silver grows as islands; the continuous-film
  assumption behind Fuchs–Sondheimer fails and the holdout error is correspondingly large. This is
  recorded as a model boundary, not fitted away.
- *No dispersion in the oxide layers, no roughness, no interdiffusion.* Oxide indices are constants
  (for example ITO at $n approx 1.8$); TMM assumes ideal planar interfaces with no scattering, which is
  why $T + R + A = 1$ exactly. Roughness, interface diffusion, crystallinity and annealing are outside
  the model.
- *Material whitelist.* The engine ships with ITO, Ag and glass; other materials require extending the
  registry, and a free-form material name is rejected rather than silently approximated.
- *The shielding model includes conductive layers only.* Dielectric capacitance and interface effects
  are not part of the transmission-line stack. In the thin-film limit the shielding effectiveness is
  therefore almost frequency-independent — a physical result of the model, not a plotting artefact.
- *No temperature, magnetic or anisotropic effects.* Relative permeability defaults to 1; there is no
  magnetic material model, no temperature dependence and no bending or strain model.
- *Angle and polarization are library-only.* The Python API supports incidence angle and s/p
  polarization, but the HTTP API and the frontend fix normal incidence and unpolarized light.
- *Output grids are fixed in the UI* even though the API can accept custom wavelength and frequency grids.

#sub[2. Accuracy claims]

- The benchmark base is small: three papers and about nine measured points, each representing a single
  deposition process. Those numbers characterize the benchmarked systems, not the tool in general.
- No uncertainty quantification: point predictions only, no confidence intervals, and the inverse-design
  process window is a deterministic tolerance rather than a process-fluctuation distribution.
- Physical constants may not be tuned to make results look better; any change to a constant requires a
  literature justification and a re-run of the benchmark suite.

#sub[3. Inverse design and the surrogate]

- *Fixed three-layer OMO only* (ITO/Ag/ITO by default; the materials can be swapped within the registry
  config, but the frontend does not expose that). Arbitrary layer counts or layer-order search are not
  supported.
- *Restricted objective shape*: hard constraints only ($T_"vis"$, $R_s$, in-band minimum $"SE"$), with a
  single ranking metric (Haacke FoM). No custom objective function and no Pareto front.
- *Deterministic grid scan with exponential cost in the number of scanned dimensions*: engine cap
  2×10⁶ combinations, the frontend warns above 10⁵, and the default 4096-combination scan takes about
  three seconds including shielding. Gradient, genetic and Bayesian optimizers are not implemented, and
  the scan evaluates serially — the neural surrogate is not yet wired in as an accelerator.
- *The process window is per-layer and independent*: it fixes the other layers and perturbs one layer
  (probe step 0.5 nm, search limit ±5 nm). It is not a joint multi-layer tolerance.
- *The surrogate domain is narrow*: version 1 maps three ITO/Ag/ITO thicknesses (outer 20–80 nm, metal
  5–20 nm) with fixed materials and substrate. Its accuracy is measured against the physics engine, not
  against literature, and its weights are a regenerable build artefact rather than a shipped model.

#sub[4. Software and deployment]

- *The desktop form has no authentication.* It is fixed to a single local user, must not be exposed to a
  network, and any networked deployment must use the default JWT mode.
- *Tasks are in-process and asynchronous.* There is no durable queue, no retry and no cancellation; if
  the process dies, unfinished tasks remain in `pending` or `running` and are not recovered.
- *Single-machine, single-instance assumption.* SQLite is the default and concurrent writes are limited;
  MySQL and PostgreSQL are supported but only SQLite is covered by CI. There is no rate limiting, no
  quota, and results are written once with no versioning or recomputation.
- *Test coverage is uneven.* Python and Go have solid unit and benchmark suites and the frontend has
  vitest coverage of the transport, gate and routing logic, but there is no browser-level end-to-end
  test and the real Electron shell has never been smoke-tested.
- *The desktop package is not yet delivered.* Packaging excludes torch (so no surrogate acceleration in
  the desktop build), there is no code signing and no auto-update, Windows is the first target, and the
  lightweight package requires the user to provide Python.
- *Not implemented*: report export, general inverse design (arbitrary layer count or order, custom
  objectives), additional material systems, and an `omo-cli simulate` subcommand.

#sub[5. Unsuitable scenarios]

- Process freeze or device-delivery decisions — this tool is for screening and mechanism explanation;
  conclusions require experimental confirmation.
- Any setting that needs uncertainty quantification or statistical process tolerances.
- Systems outside the material whitelist, outside the validated thickness range (especially thin
  silver), or requiring dispersion, roughness or annealing effects.
- Multi-user online service: the desktop form has no authentication and the web form still lacks
  rate limiting, auditing and password recovery.

== Potential and Roadmap

#sub[Near term: make the desktop form a delivered, verifiable artifact]

The remaining work is narrow and concrete: finish the local debug script, add a release pipeline with a
SHA-256 manifest, and — most importantly — complete the clean-machine acceptance. That means launching
the shell on a machine with the Electron binary, confirming that the window renders the built frontend
under the `app://` protocol, checking that the CSP does not clip Vue or ECharts, verifying that the
preload bridge is injected, and running `electron-builder` for the first time to observe the real
artifact layout. Until that is done, the desktop form is designed and unit-tested but not demonstrated.

#sub[Mid term: close the loop between the surrogate and the optimizer]

The surrogate already reaches sub-0.1 % agreement with the engine inside a narrow domain, and the inverse
design interface is deliberately separated from the evaluator. Wiring the surrogate in as an accelerator
would make far larger design spaces affordable, which in turn enables the features that are currently
out of reach: gradient-based inverse design on a differentiable surrogate, multi-objective search with a
Pareto front (for example transmittance versus sheet resistance versus shielding), and interactive
exploration instead of an exhaustive scan. Report export would turn a design session into a lab record.

#sub[Model expansion to widen the validity domain]

- Additional materials and dispersive oxide models (ZnO, TiO₂, AZO, Cu, Al), driven by the same registry
  so the physics stays in one place.
- A roughness or effective-medium interface layer, and either a percolation-aware thin-metal model or a
  clearly documented calibrated correction inside the thin-film regime.
- Flexible substrates and strain, which matter for the applications the tool is aimed at.

#sub[A larger benchmark base, and honest error bars]

The single most valuable improvement is more measured data: more papers, more deposition processes,
more systems. That widens what the tool is allowed to claim. Paired with uncertainty estimation, it
would turn "point prediction" into "prediction with a stated confidence", which is what a design
decision actually needs.

#sub[Platform and teaching value]

- Cross-platform packaging (macOS, Linux) and a single-process web deployment path.
- Reusable as teaching material: the codebase shows transfer-matrix optics, size effects and shielding
  theory implemented from first principles, with an unbroken, testable path from a physical formula to
  a curve on screen, and a CI pipeline that runs three language ecosystems on every commit.

#callout([The project's real thesis], [
Designing a transparent conductive film means reasoning across optics, electricity and electromagnetic
shielding at once, while the literature reports isolated measurements from incompatible processes.
OMOPredict's contribution is to put the whole loop — *model, compare with published measurements,
calibrate the effective parameters, then design under constraints* — into one auditable, dependency-light
tool that a student can run on a laptop and read end to end.
])

// ============================================================================
//  PART II — CHINESE
// ============================================================================
#pagebreak()
#banner[Part II · 中文版]
#set text(font: ("Libertinus Serif", "Noto Serif SC"), lang: "zh")

== 项目总览

*OMOPredict* 是一款面向大学生科研与课程设计的 *OMO（氧化物/金属/氧化物）纳米多层薄膜*
轻量化仿真与设计软件。它回答透明导电薄膜实验里最常见的那个问题：
*给定一个膜层结构，它的光学、电学与电磁性能应当是多少？以及，我们更应该去做哪一个结构？*

输入是对膜系的物理描述（逐层厚度、折射率或介电函数、电阻率、衬底折射率），输出是器件级的性能指标：

- *光学*：透过率 $T(lambda)$、反射率 $R(lambda)$、吸收率 $A = 1 - T - R$，以及可见光平均透过率。
- *电学*：方阻 $R_s$（Ω/sq），并对超薄金属计入尺寸效应。
- *电磁*：屏蔽效能 $"SE"(f)$（dB），并给出 Schelkunoff 的反射／吸收／多次反射精确分解。
- *设计*：约束驱动的目标反推（推荐膜厚）、逐层灵敏度与逐层工艺窗口。

这个项目真正的差异点在*"拿什么来验收结果"*：解析解自检只是底线，验收标准是*与同行评议论文中
实测数据的一致性*，而且每个数据点旁边都记录来源与 DOI。"仿真 → 对标 → 调整有效参数 →
在留出集上重新验证"的校准闭环是代码库的一部分，而不是一次性的手工操作。

典型体系：ITO/Ag/ITO、ZnO/Ag/ZnO、TiO₂/Ag/TiO₂ 与 WO₃₋ₓ/Ag/WO₃₋ₓ。它们的共同点是：
极薄的金属层（通常 5–20 nm）提供导电与屏蔽，氧化物层提供增透、保护与界面调控。

== 系统架构

项目刻意分为三层，每层用最适合其职责的语言实现，并且*每一份契约都有唯一来源*。

#table(
  columns: (auto, auto, 1fr),
  table.header([*层*], [*技术*], [*职责*]),
  [数据科学层], [Python 3.12], [物理建模：TMM 光学、方阻、电磁屏蔽、目标反推、文献对标、代理模型],
  [中间层], [Go 1.25], [用户处理、任务编排、结果持久化、REST API 与 stdio JSON-RPC、引擎生命周期],
  [前端], [Vue 3 + TS], [参数输入、结果图表、任务历史、目标反推页；自身不做任何计算],
  [桌面壳], [Electron + TS], [单用户本地形态：拉起并守护 Go 后端与 Python 引擎],
)

两种运行形态*共用同一份源码、同一套物理与同一份 JSON 载荷*，差异仅在传输方式与认证模式。

#diagram(arch_web, "Web form")
#dcap[图 1 —— Web 形态：前端与 Go 之间走 REST/JSON，认证用 JWT；Go 到 FastAPI 引擎走 HTTP。]

#diagram(arch_desktop, "Desktop form")
#dcap[图 2 —— 桌面形态：渲染进程到 Host 层走 Electron IPC，Go 到引擎走 stdio JSON-RPC；全程没有任何进程监听端口。]

#sub[仓库实际强制执行的几条设计纪律]

- *物理逻辑只在 Python 层。* Go 只做编排与存储，前端不自行计算结果——每一条公式因此只有一份实现。
- *一份契约、两种传输。* `simulate` / `optimize` 的参数与结果在 HTTP 与 stdio 下*逐字段相同*，
  并且这个"相同"由两侧的测试断言（Go 侧 `contract_test.go`，Python 侧 `test_rpc.py`）。
- *桌面形态下引擎是子进程，不是服务。* `OMO_ENGINE_TRANSPORT=stdio` 让 Go 拉起引擎、用管道说 JSON-RPC；
  若引擎无法解析，*启动即失败*而不是静默回退到 HTTP——静默回退会直接破坏"不监听端口"这条承诺。
- *可选依赖按设计排除。* 引擎基础安装只有 numpy + scipy；FastAPI/uvicorn（extra `api`）、torch
  （extra `neural`）、matplotlib（extra `plot`）均为按需安装，并有 import 图测试断言
  导入 stdio 入口时不会拉进这些依赖。

== 物理内核

每个模型都在模块文档字符串里标注文献来源，并配有单元测试与文献基准测试。

#table(
  columns: (auto, 1fr, 1fr),
  table.header([*模块*], [*模型与关键关系*], [*来源*]),
  [光学],
  [传输矩阵法（特征矩阵，Macleod 符号约定）。逐层
   $M_j = mat(cos delta_j, -i sin delta_j \/ eta_j; -i eta_j sin delta_j, cos delta_j)$，随后
   $T = 4 eta_0 "Re"(eta_s) \/ abs(eta_0 B + C)^2$。库内支持入射角与 s/p 偏振。],
  [Macleod, _Thin-Film Optical Filters_, 5th ed. (2017)],
  [金属色散],
  [Drude 介电函数 $epsilon(omega) = epsilon_infinity - omega_p^2 \/ (omega^2 + i gamma omega)$；
   Ag 取 $epsilon_infinity = 3.7$、$ħ omega_p = 9.1$ eV、$ħ gamma = 0.02$ eV。],
  [Palik 等文献值，集中于材料注册表],
  [电学],
  [面内并联电导 $1 \/ R_s = sum_i d_i \/ rho_"eff",i$，并对膜厚与电子平均自由程可比的薄膜计入
   Fuchs–Sondheimer 尺寸效应。],
  [Fuchs (1938)；Sondheimer (1952)；Tellier & Tosser (1982)],
  [电磁屏蔽],
  [传输线（ABCD）模型（垂直入射多层膜精确解），配合 Schelkunoff 分解
   $"SE" = "SE"_R + "SE"_A + "SE"_M$ 与薄膜极限 $"SE" approx 20 log_10 (1 + Z_0 \/ (2 R_s))$。],
  [Schelkunoff (1943)；Paul (2006)；Ott (2009)],
  [目标反推],
  [在硬约束下对三层厚度做确定性网格扫描，按 Haacke 品质因子
   $italic("FoM") = T_"vis"^10 \/ R_s$ 排序。],
  [Haacke, _J. Appl. Phys._ *47*, 4086 (1976)],
  [代理模型],
  [以引擎生成样本训练的多层感知机；$R_s$ 在 log 空间学习，光谱在固定网格上做向量回归。
   相对物理引擎精度 < 0.1 %。],
  [项目内部（M2.5）；引擎始终是基准],
)

#callout([为什么要有代理模型？], [
物理引擎是*唯一*的验证基准。神经网络的存在只是为了让大规模设计搜索变得可承受；
它不替代引擎，并且任何精度都必须以引擎为参照来报告。
])

== 功能清单

#sub[仿真]

- 可配置波长网格上的光学光谱（默认 380–1000 nm、步长 10 nm，共 63 点），吸收率由能量守恒导出。
- 方阻采用并联层模型并对超薄金属计入 Fuchs–Sondheimer 修正，因此 10 nm 的 Ag 不会被当成块体银。
- 可配置频率网格上的屏蔽效能（默认 1–18 GHz、步长 1 GHz），并给出精确的 Schelkunoff 组分分解，
  用于解释"为什么这个结构能这样屏蔽"。
- 无导电层的膜系优雅降级：纯玻璃膜系返回 `sheet_resistance = null` 与空 SE 序列，而不是报错。

#sub[目标驱动的反推设计]

- 硬约束可自由组合：$T_"vis" >= x$、$R_s <= y$、以及频带内的 $"SE" >= z$。
- 三层厚度空间的确定性穷举扫描（默认外层 20–80 nm 步长 4 nm、金属 5–20 nm 步长 1 nm，
  约 4096 组合，含屏蔽求值约 3 秒；引擎上限 2×10⁶ 组合）。
- 可行候选按 Haacke 品质因子排序；当无任何候选满足全部约束时，另给一个 *best-effort* 最接近方案。
- 逐层灵敏度（±1 nm 有限差分：FoM 相对变化、$T_"vis"$ 绝对变化、$log_10 R_s$ 变化）
  与逐层工艺窗口（保持目标可行的对称厚度容差）。
- 反推与正向仿真走*同一条求值路径*，因此反推结果与正向模型在构造上自洽；
  测试会把候选回灌物理引擎再确认一次。

#sub[文献对标与校准]

- 数据集格式记录膜系、实测值、提取条件与 DOI。
- 自动对比仿真与实测，输出 MAE / RMSE / 相对误差报告与对比图。
- 校准流水线（灵敏度分析 → log 空间有界 L-BFGS-B 拟合 → 留出集验证），
  其产物以*数据集范围的覆盖参数*形式使用，*绝不写回默认物理常数*。

#sub[接口]

- `omo-cli optimize …`：脚本化批量运行与快速实验。
- REST API（`POST /simulate`、`POST /optimize`、`GET /health`、`GET /api/meta`）：Web 形态。
- stdio JSON-RPC（`ping` / `simulate` / `optimize`）：桌面形态与 Go 中间层。
- Vue 前端：膜层设计、结果图表（T/R 光谱与 SE 曲线）、含删除的任务历史，
  以及带候选表与灵敏度展示的目标反推页面。
- 桌面形态：无登录页、数据全部留在用户本地应用目录、不开放任何网络端口。

#sub[工程能力]

- 单个 CI 工作流、五个 job：引擎（ruff + pytest + CLI 冒烟）、Go（gofmt + vet + build + test）、
  前端（lint + vitest + build）、桌面（type-check + 壳构建 + vitest）、
  打包（真实执行打包脚本，其中包含"体积门禁真的会拦"这一条反向验证）。
- 打包脚本的退出码当契约用：0 = 出包，1 = 构建或门禁失败，2 = 仅暂存
  （没有壳时*刻意不假装成功*）。
- 每个包两道体积门禁：对自己能掌控的部分*收紧*（应用载荷 ≤ 50 MB，实测约 27 MB），
  对自己掌控不了的部分*放宽*（内嵌运行时）。

== 当前进度（截至 2026-10-03）

#sub[里程碑]

#table(
  columns: (auto, 1.7fr, 1.2fr),
  table.header([*阶段*], [*交付物*], [*状态*]),
  [M0], [脚手架：Python 工程、Go 骨架、CI], [已完成],
  [M1], [物理引擎：TMM + Drude、并联方阻 + Fuchs–Sondheimer、传输线屏蔽], [已完成],
  [M2], [文献对标框架：3 篇真实数据集、对标报告、校准闭环], [已完成],
  [M2.5], [神经网络代理：引擎生成数据管线与 T / Rs / SE 正向代理], [已完成],
  [M3], [Go 中间层：用户与 JWT、GORM（SQLite/MySQL/PostgreSQL）、任务编排、REST API], [已完成],
  [M4], [Vue 3 前端：注册/登录、膜层设计、ECharts 结果图、任务历史], [已完成],
  [M5], [目标反推：v1 引擎层、v2 打通 API 与前端], [已完成；报告导出、高级寻优与代理加速待做],
  [M6], [集成与打磨；扩展桌面形态（Electron、单用户、无端口）], [进行中：T1–T8 已完成、T9 大部分完成、T10–T11 待做],
)

#sub[代码库的实测状态]

该日期仓库状态：`master` 分支 70 次提交、213 个受版本管理文件
（engine 63 · server 39 · frontend 47 · desktop 39 · docs 15 · scripts 5），工作区干净。
下表中每一个数字都是*把命令真跑一遍*得到的，不是从文档抄来的。

#table(
  columns: (auto, auto, 1fr),
  table.header([*层*], [*命令*], [*结果*]),
  [Python 引擎], [`pytest`], [*132 passed*；`ruff check src tests` → all checks passed],
  [Go 中间层], [`go test ./...`], [全部包通过：api、model、rpc、store、task、user],
  [前端], [`pnpm test` / `build` / `lint`], [5 个文件 *60 passed*；`build` 成功产出 `dist`；lint 无告警],
  [桌面], [`pnpm type-check` / `test`], [对真实 Electron 类型 type-check 干净；*150 passed*，3 个需环境变量门控的端到端用例跳过],
  [端到端数值], [引擎 `simulate`：ITO(40)/Ag(10)/ITO(40)], [*Rs = 3.970819 Ω/sq · T\@550 nm = 0.974497 · SE\@10 GHz = 33.7036 dB*，与 API 契约记录的数值完全一致],
)

#callout([验证说明], [
上表的端到端数值是本项目的参考算例。它在库入口、HTTP API、stdio RPC、Go 中间层与桌面 Host 层
都能复现——正因如此，"桌面形态与 Web 形态算的是同一套物理"这句话是*可测的*，而不是一句愿景。
])

#sub[桌面形态：逐任务状态]

桌面形态在 `docs/desktop.md` 中按 T1–T11 拆解，其设计目标是应用运行期间*没有任何进程监听端口*。

#table(
  columns: (auto, 1.9fr, 1.3fr),
  table.header([*任务*], [*内容*], [*状态*]),
  [T1], [单用户模式（`OMO_AUTH_MODE=none`）与能力端点 `GET /api/meta`], [已完成],
  [T2], [任务删除 `DELETE /api/tasks/{id}`（含归属校验）], [已完成],
  [T3], [Go 侧 stdio JSON-RPC 分发器（`omopredict --stdio`）], [已完成],
  [T4], [编排下沉到中立层 `omo.sim`、stdio 入口 `omo.rpc`、可选 extras、import 图测试], [已完成],
  [T4.5], [Go→引擎 stdio 传输与四级引擎发现；"无端口"已实测], [已完成],
  [T5], [前端传输抽象（有 `window.omo` 走 IPC，否则 HTTP）与能力门禁], [已完成],
  [T6], [桌面 Host 层：路径、按天日志、JSON-Lines 分帧、RPC 客户端、后端守护、单实例锁], [已完成],
  [T7], [Electron 壳：`app://` 协议与目录穿越防护、CSP、IPC 信封、preload 白名单], [代码完成——*但从未真正启动过*],
  [T8], [轻量包：引擎准备脚本、包组装、体积门禁], [已完成],
  [T9], [契约测试、`rpc-cli.ps1`、`build-desktop.ps1`、PyInstaller sidecar、CI 打包 job], [大部分完成：`start-local.ps1`、Release 上传 + SHA-256 清单、完整包 CI job 待做],
  [T10], [文档收尾], [待做],
  [T11], [净机验收：壳的启动与渲染、electron-builder 实跑、无端口检查], [待做],
)

#sub[哪些已被证明，哪些还没有]

- *已由执行证明*：引擎算得出参考数值；Go↔引擎 的 stdio 传输与 HTTP 载荷逐字段一致且无监听套接字；
  Host 层通过真实管道守护后端；打包脚本能跑通且体积门禁真的会拦；
  PyInstaller 打出的 sidecar 在无 Python 环境下算得出正确结果，且 torch / fastapi / uvicorn /
  matplotlib 均为 0 个条目。
- *尚未证明*：Electron 壳*一次都没启动过*（开发环境拉不下 Electron 二进制），
  因此窗口能否创建、`app://` 能否渲染、CSP 会不会误伤都未验证；`electron-builder` 也从未实跑，
  所以最终产物形态目前只是一份*布局契约*而不是观测结果。这两件事都属于 T11。

== 验证与精度

#sub[对标数据集]

项目记录了 3 篇已发表数据集，每篇都带膜系、实测值、提取条件与 DOI。合计约 9 个实测点，
且每个点对应单一沉积工艺。

#table(
  columns: (auto, 1fr, auto),
  table.header([*来源*], [*体系*], [*在本项目中的角色*]),
  [Voronin 2025, _Materials_ *18*, 5393], [WO₃₋ₓ/Ag/WO₃₋ₓ 与 In₂O₃/Ag/In₂O₃], [训练子集；同时提供薄 Ag 留出样本],
  [Isiyaku 2020], [ITO/Al/Ag/ITO], [训练子集；约束氧化物折射率],
  [Lim 2020], [WO₃₋ₓ/Ag/WO₃₋ₓ], [训练集与一个留出厚度],
)

#sub[校准结果]

损失为按量加权的 MSE（方阻取 $log_10$ 空间、权重 1；T 与 R 取绝对值、权重 1；SE 取 dB、权重 0.1）。
先做灵敏度分析找出主导参数，再在有界范围内拟合；薄 Ag 样本与一个 WO₃₋ₓ 厚度作为留出集。

#table(
  columns: (auto, auto, auto, 1fr),
  table.header([*参数*], [*默认值*], [*拟合值*], [*竞争性解释*]),
  [Ag 块体电阻率 $rho$], [1.59×10⁻⁸ Ω·m], [*2.60×10⁻⁸ Ω·m*（触上界）], [界面与晶界散射未被模型表达],
  [Ag 平均自由程 $lambda$], [52 nm], [*95 nm*], [同一效应被吸收进尺寸效应项],
  [ITO 折射率 $n$], [1.8], [*2.1*（触上界）], [溅射 ITO 的折射率确实存在 1.8–2.1 的工艺依赖区间],
)

加权训练损失由 7.75 降至 0.59（↓92 %）。在留出的薄 Ag 样本上，$log_10 R_s$ 的 MAE 由 0.374 降至
0.183（↓51 %），但仍明显劣于训练拟合——这正是银在约 10 nm 以下岛状生长与渗流的特征，
而连续膜 Fuchs–Sondheimer 模型并不描述这一机制。

#callout([如何解读拟合出的参数], [
它们是*仿真有效参数*，不是材料物性。它们吸收的是模型未表达的界面与晶界散射；
银的 CRC 块体值仍然是真实的物理常数，校准产物以数据集范围的覆盖参数使用、不写入注册表。
三个拟合值里有两个触到边界，这本身就是一条结论：需要改变的是*模型形式*，而不是参数取值。
])

#sub[能宣称什么、不能宣称什么]

- *可以宣称*：在被对标的体系内，仿真能复现文献透过率到几个百分点的水平、方阻约 7 %；
  并且薄银处的模型边界是被*明确指出*的，而不是被掩盖的。
- *不能宣称*：全局精度、未对标体系的精度、薄 Ag 区间的精度，以及任何不确定性陈述——
  工具只给点预测、没有误差棒，反推的"工艺窗口"是确定性容差而不是统计分布。

== 局限性与适用范围

以下限制都是已知的、有意保留的；其中多数是物理模型的边界，而不是待修的缺陷。

#sub[1. 物理模型与适用域]

- *未建模渗流。* 银在约 10 nm 以下呈岛状生长，Fuchs–Sondheimer 的连续膜假设失效，
  留出集误差因此显著。这被记为模型边界，而不是靠拟合掩盖。
- *氧化物无色散、无粗糙度、无界面互扩散。* 氧化物折射率取常数（如 ITO 约 $n = 1.8$）；
  TMM 假设理想平面、无散射，这正是 $T + R + A = 1$ 精确成立的原因。
  粗糙度、界面扩散、结晶度与退火均不在模型范围内。
- *材料白名单。* 引擎默认只有 ITO、Ag 与玻璃；其它材料需要扩展注册表，
  自由输入的材料名会被*拒绝*，而不是被静默近似。
- *屏蔽模型只纳入导电层。* 介电层电容与界面效应不参与传输线堆叠。因此在薄膜极限下，
  屏蔽效能几乎与频率无关——这是模型的物理结果，不是绘图假象。
- *无温度、磁场与各向异性效应。* 相对磁导率默认为 1，没有磁性材料模型、温度依赖，
  也没有弯折或应力模型。
- *角度与偏振仅在库内可用。* Python 库支持入射角与 s/p 偏振，
  但 HTTP API 与前端固定为垂直入射、非偏振。
- *界面上的输出网格是固定的*，尽管 API 本身可以接受自定义波长与频率网格。

#sub[2. 关于精度的宣称]

- 对标样本基数小：3 篇文献、约 9 个实测点，每篇对应单一沉积工艺。
  这些数字刻画的是*被对标的体系*，不能外推为工具的一般精度。
- 不做不确定度量化：只有点预测、没有置信区间；反推的工艺窗口是确定性容差，
  不是工艺波动的统计分布。
- 不允许为了让结果更好看而调物理常数；任何常数变更都需要文献依据，并重跑整套基准测试。

#sub[3. 目标反推与代理模型]

- *仅支持固定三层 OMO*（默认 ITO/Ag/ITO；材料可在引擎配置内替换，但前端未开放）。
  不支持任意层数或层序搜索。
- *目标形态受限*：只支持硬约束（$T_"vis"$、$R_s$、频带内最小 $"SE"$），且只有一个排序指标（Haacke FoM）。
  不支持自定义目标函数，也不展示 Pareto 前沿。
- *确定性网格扫描，代价随维数指数增长*：引擎上限 2×10⁶ 组合，前端在 10⁵ 以上给出提示，
  默认 4096 组合含屏蔽求值约 3 秒。梯度／遗传／贝叶斯寻优均未实现，
  扫描为串行求值——*代理模型尚未接入作为加速后端*。
- *工艺窗口是"单层独立"口径*：固定其余层、单层扰动（探测步长 0.5 nm、上限 ±5 nm），
  不等于多层联合容差。
- *代理模型的适用域很窄*：v1 仅映射 ITO/Ag/ITO 三个厚度（外层 20–80 nm、金属 5–20 nm），
  材料与衬底固定。其精度以*物理引擎*为基准（不是实测文献），
  权重是可重新生成的构建产物，而不是随包交付的模型。

#sub[4. 软件与部署]

- *桌面形态没有认证。* 固定单用户本地模式，*绝不能暴露到网络*；
  任何联网部署都必须使用默认的 JWT 模式。
- *任务是进程内异步的。* 没有持久化队列、没有重试、没有取消接口；
  进程异常退出时未完成的任务会停在 `pending` / `running`，不会自动恢复。
- *单机单实例假设。* 默认 SQLite，并发写受限；MySQL 与 PostgreSQL 虽已支持，但 CI 只覆盖 SQLite。
  没有速率限制与配额，结果一次性写入、无版本化与重算。
- *测试覆盖不均。* Python 与 Go 有较完整的单测与对标测试，前端对传输、门禁与路由有 vitest 覆盖，
  但*没有浏览器级端到端测试，真实 Electron 壳也从未冒烟*。
- *桌面包尚未交付。* 打包排除 torch（故桌面版无代理加速），无代码签名与自动更新，
  Windows 优先，轻量包需要用户自备 Python。
- *未实现*：报告导出、通用逆向设计（任意层数/层序、自定义目标函数）、更多材料体系，
  以及 `omo-cli simulate` 子命令。

#sub[5. 不适合的场景]

- 工艺定型或器件交付决策——本工具用于筛选与机理解释，结论需要实验验证。
- 任何需要不确定度量化或统计工艺容差的场合。
- 超出材料白名单、超出已验证厚度域（尤其薄银），或需要色散、粗糙度、退火效应的体系。
- 多用户联网服务：桌面形态无认证，Web 形态也仍缺少限流、审计与密码找回。

== 潜力与路线图

#sub[近期：让桌面形态成为可交付、可验证的产物]

剩余工作明确而具体：补上本地调试脚本、加上带 SHA-256 清单的发布流程，以及最关键的一项——
完成净机验收。也就是在装有 Electron 二进制的机器上启动壳，确认窗口能在 `app://` 协议下渲染
构建好的前端，检查 CSP 不会裁掉 Vue 或 ECharts，验证 preload 桥确实被注入，
并第一次真正运行 `electron-builder` 以观察产物布局。在这些完成之前，桌面形态属于
"已设计、已单测、但未演示"。

#sub[中期：把代理模型接入优化器，形成闭环]

代理模型已在较窄的适用域内与物理引擎达到 0.1 % 以内的一致，而反推接口与求值器是刻意分开的。
把代理接到优化器上作为加速后端，就能承受大得多的设计空间，从而解锁目前够不到的能力：
在可微代理上做梯度反设计、带 Pareto 前沿的多目标搜索（例如透过率／方阻／屏蔽效能三方权衡）、
以及交互式探索而不是穷举扫描。报告导出则能把一次设计会话变成可归档的实验记录。

#sub[模型扩展：把可宣称的适用范围撑开]

- 更多材料与色散氧化物模型（ZnO、TiO₂、AZO、Cu、Al），仍走同一套注册表，保证物理只有一份实现。
- 引入粗糙度或等效介质界面层；并针对薄膜区，给出要么考虑渗流的薄金属模型，
  要么明确文档化的、经过校准的有效修正。
- 柔性衬底与应力——这正是本工具瞄准的应用场景里绕不开的因素。

#sub[更大的对标数据集，以及诚实的误差棒]

最有价值的单项改进就是更多实测数据：更多论文、更多沉积工艺、更多体系。
这直接决定"工具被允许宣称什么"。如果再配上不确定度估计，
就能把"点预测"变成"带置信度的预测"——而这才是设计决策真正需要的东西。

#sub[平台与教学价值]

- 跨平台打包（macOS、Linux）与单进程 Web 部署路径。
- 可直接作为教学材料：代码库完整展示了从第一性原理出发的传输矩阵光学、尺寸效应与屏蔽理论，
  并且从物理公式到屏幕上的一条曲线之间是一条*未被切断且可测试*的路径；
  CI 在每次提交上同时运行三个语言生态。

#callout([这个项目真正的主张], [
设计透明导电薄膜，意味着必须同时权衡光学、电学与电磁屏蔽；而文献给出的往往是来自互不兼容工艺的
孤立测量值。OMOPredict 的贡献是把整个回路——*建模、与已发表实测对比、标定有效参数、
再在约束下设计*——装进一个可审计、依赖极轻、学生能在笔记本上跑起来并从头读到尾的工具里。
])

// ============================================================================
//  CLOSING NOTE
// ============================================================================
#pagebreak()
#set text(font: ("Libertinus Serif", "Microsoft YaHei"), lang: "en")
#align(center)[#text(size: 15pt, weight: "bold", fill: rgb("#12395c"))[Notes on this document]]
#v(0.4em)

#sub[Sources]

Every statement about the project's state comes from the repository itself: `AGENTS.md`,
`README.md`, `docs/HANDOVER.md`, `docs/desktop.md`, `docs/physics/`, `docs/benchmarks/`,
`docs/api/`, and the source trees under `engine/`, `server/`, `frontend/`, `desktop/` and `scripts/`.
The structural diagrams were drawn from the code paths that implement them, not from the design
document alone.

#sub[How the numbers were obtained]

The test-matrix figures in Section 1.5 (Part I) and Section 2.5 (Part II) were produced on
3 October 2026 by running, in the repository root:

#diagram("cd engine && pytest            # 132 passed\ncd engine && ruff check src tests\ncd server && go test ./...     # all packages ok\ncd frontend && pnpm test && pnpm build && pnpm lint\ncd desktop && pnpm type-check && pnpm test", "")

The end-to-end reference values were obtained by calling the library entry point directly:

#diagram("# ITO(40 nm) / Ag(10 nm) / ITO(40 nm), substrate n = 1.5\nRs = 3.970819 Ω/sq\nT  @ 550 nm  = 0.974497\nSE @ 10 GHz  = 33.7036 dB", "")

#sub[Known documentation drift, observed while writing this overview]

- `README.md`'s architecture table still describes the Electron shell as "to be done", although T7 is
  complete in code.
- `docs/HANDOVER.md`'s header still says "last updated: M6-a (T1–T4)" while its body already covers T9,
  and two separate items in its environment-notes section are both numbered 10.
- `docs/desktop.md` §6 lists `start-local.ps1` in the directory layout although `scripts/README.md`
  marks it as not yet written.

None of these affect behaviour; they are recorded here because a project overview is only useful if it
distinguishes what is verified from what is merely written down.

#v(0.8em)
#align(center)[#text(size: 9pt, fill: luma(110))[
  OMOPredict · Project Overview · generated with Typst · 2026-10-03\
  English version (Part I) and Chinese version (Part II) are parallel in structure and content.
]]
