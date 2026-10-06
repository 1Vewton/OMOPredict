// ============================================================================
//  OMOPredict — slide deck / 幻灯片
//    Part I  : English deck (17 slides)
//    Part II : 中文版 (17 slides)
//
//  Build:  typst compile omopredict-slides.typ omopredict-slides.pdf
//
//  Facts and figures are the ones measured on 2026-10-03 (see the overview
//  document, docs/omopredict-overview.typ): reference case ITO(40)/Ag(10)/ITO(40)
//  → Rs = 3.970819 Ω/sq, T@550 nm = 0.974497, SE@10 GHz = 33.7036 dB.
// ============================================================================

#set document(
  title: "OMOPredict — Slide Deck / 幻灯片",
  author: "OMOPredict project",
  date: datetime(year: 2026, month: 10, day: 3),
)

// ---------------------------------------------------------------- deck set-up
#set page(
  paper: "presentation-16-9",
  margin: (top: 0.95cm, bottom: 0.85cm, x: 1.3cm),
)
#set text(font: ("Segoe UI", "Microsoft YaHei"), size: 12.5pt, lang: "en")
#set par(leading: 0.58em, spacing: 0.85em)
#show raw.where(block: true): set text(size: 8.5pt, font: "DejaVu Sans Mono")

#let navy = rgb("#0f3350")
#let accent = rgb("#12395c")
#let blue = rgb("#2d5f8a")
#let muted = rgb("#5b7c99")
#let pale = rgb("#f2f6fa")
#let hair = rgb("#d8e2ec")
#let amber = rgb("#b45309")
#let amber-bg = rgb("#fdf6ec")
#let green = rgb("#1f7a4d")
#let red = rgb("#b91c1c")
#let red-bg = rgb("#fdf2f2")
#let grey = rgb("#8a94a6")
#let sky = rgb("#8fb4d4")
#let sky2 = rgb("#9dbfdb")

// deck bookkeeping: the footer shows a per-deck slide number
#let deck-info = state("deck-info", (base: 0, total: 17, label: "English deck"))

// ---------------------------------------------------------------- components
#let kicker-txt(t) = text(size: 9pt, weight: "bold", tracking: 1.6pt, fill: muted, upper(t))

#let chip(label, c) = box(fill: c, inset: (x: 5pt, y: 2pt), radius: 2.5pt)[
  #text(fill: white, size: 7.5pt, weight: "bold", tracking: 0.3pt)[#upper(label)]
]

#let card(body, c: pale) = block(width: 100%, fill: c, radius: 4pt, inset: 11pt)[#body]
#let cards(columns, gutter: 0.35cm, ..items) = grid(
  columns: columns,
  gutter: gutter,
  ..items.pos().map(card),
)

#let h3(t) = text(size: 12.5pt, weight: "bold", fill: blue)[#t]
#let mcard(value, label, vc: accent, c: pale) = card(c: c)[
  #text(size: 26pt, weight: "bold", fill: vc)[#value]
  #linebreak()
  #text(size: 9.5pt, fill: muted)[#label]
]
#let bullet(body) = grid(
  columns: (auto, 1fr),
  column-gutter: 7pt,
  align: horizon,
  text(fill: blue, size: 11pt)[•],
  body,
)

#let fbox(t, c: pale, tc: accent) = block(
  width: 100%,
  fill: c,
  radius: 4pt,
  inset: (x: 7pt, y: 7pt),
)[
  #set align(center)
  #text(size: 10.5pt, weight: "bold", fill: tc)[#t]
]
#let arrow(t: "→") = text(size: 15pt, fill: muted)[#t]
// `flow` takes alternating box/arrow cells (box, arrow, box, …). Column tracks must
// be built from the BOX count, not the cell count — otherwise the extra trailing
// tracks silently eat the free space and the row no longer spans the slide.
#let flow(..cells) = {
  let c = cells.pos()
  let n = calc.div-euclid(c.len() + 1, 2) // number of boxes
  let cols = ()
  for i in range(n) {
    cols.push(1fr)
    if i < n - 1 { cols.push(auto) }
  }
  grid(columns: cols, gutter: 6pt, align: horizon, ..c)
}

#let slide(body, kicker: none, title: none) = page[
  #grid(
    rows: (auto, auto, 1fr, auto),
    gutter: 4pt,
    {
      set align(bottom)
      block(width: 100%)[
        #if kicker != none [#kicker-txt(kicker) #linebreak()]
        #text(size: 24pt, weight: "bold", fill: accent)[#title]
        #v(3pt)
        #line(length: 100%, stroke: 0.9pt + hair)
      ]
    },
    body,
    [],
    {
      set text(size: 8pt, fill: muted)
      context {
        let cur = counter(page).get().first()
        let info = deck-info.get()
        let n = cur - info.base
        grid(
          columns: (auto, 1fr, auto),
          align: (left, center, right),
          gutter: 10pt,
          [OMOPredict · #info.label],
          block(width: 100%, height: 2.5pt, radius: 2pt, fill: hair)[
            #box(width: (n / info.total) * 100%, height: 2.5pt, radius: 2pt, fill: blue)
          ],
          [#n / #info.total],
        )
      }
    },
  )
]

#let title-slide(kicker: "", title: "", sub: none, metrics: (), foot: none) = page(
  fill: navy,
  margin: (x: 1.9cm, y: 1.7cm),
)[
  #set text(fill: white)
  #v(0.9cm)
  #text(size: 10.5pt, tracking: 3pt, fill: sky)[#upper(kicker)]
  #v(0.25cm)
  #text(size: 38pt, weight: "bold")[#title]
  #v(0.15cm)
  #text(size: 14pt, fill: rgb("#cfe0ee"))[#sub]
  #v(0.55cm)
  #line(length: 100%, stroke: 0.6pt + rgb("#3f6b91"))
  #v(0.45cm)
  #grid(
    columns: (1fr,) * metrics.len(),
    gutter: 0.3cm,
    ..metrics.map(m => [
      #text(size: 21pt, weight: "bold")[#m.at(0)]
      #linebreak()
      #text(size: 9pt, fill: sky2)[#m.at(1)]
    ]),
  )
  #v(0.5cm)
  #text(size: 9.5pt, fill: sky2)[#foot]
]

#let end-slide(big, small) = page(fill: navy)[
  #set text(fill: white)
  #v(2.9cm)
  #align(center)[
    #block(width: 82%)[#text(size: 23pt, weight: "bold")[#big]]
    #v(0.55cm)
    #text(size: 10.5pt, fill: sky2)[#small]
  ]
]

// ============================================================================
//  PART I — ENGLISH DECK
// ============================================================================
#deck-info.update((base: 0, total: 17, label: "English deck"))

#title-slide(
  kicker: "Project slides · 2026-10-03",
  title: "OMOPredict",
  sub: "A lightweight simulation and design tool for oxide–metal–oxide (OMO) nanolaminate thin films",
  metrics: (
    ([132], [tests passing]),
    ([3.970819], [Ω/sq sheet resistance]),
    ([97.4 %], [visible transmittance]),
    ([33.7 dB], [shielding at 10 GHz]),
  ),
  foot: "github.com/1Vewton/OMOPredict  ·  v0.1.0  ·  Python + Go + Vue 3 + Electron",
)

// ---------------------------------------------------------------- 2
#slide(kicker: "01 · Problem", title: "A transparent conductor is three problems at once")[
  #cards(
    (1fr, 1fr, 1fr),
    [
      #h3[Optics]
      #v(5pt)
      Transparency *and* anti-reflection: the oxide layers must not cost you the light the metal blocks.
    ],
    [
      #h3[Electrics]
      #v(5pt)
      Conduction lives in a 10 nm metal film whose resistivity is *not* the bulk value.
    ],
    [
      #h3[Shielding]
      #v(5pt)
      EMI attenuation comes from that same film — and has to survive bending and time.
    ],
  )
  #v(0.4cm)
  #card(c: amber-bg)[
    #text(weight: "bold", fill: amber)[The literature answers each question with isolated numbers from incompatible processes.]
    \ So you deposit, measure, adjust — and try again.
  ]
]

// ---------------------------------------------------------------- 3
#slide(kicker: "02 · Solution", title: "Structure in. Performance out.")[
  #v(0.25cm)
  #flow(
    fbox[Layer stack\ #text(size: 9pt, weight: "regular", fill: muted)[thickness · material · substrate]],
    arrow(),
    fbox[Physics engine\ #text(size: 9pt, weight: "regular", fill: muted)[TMM · F–S · transmission line]],
    arrow(),
    fbox[Performance\ #text(size: 9pt, weight: "regular", fill: muted)[T(λ) · R(λ) · Rs · SE(f) · FoM]],
  )
  #v(0.55cm)
  #cards(
    (1fr, 1fr),
    [
      #h3[What you give it]
      #v(4pt)
      A layer list: material name and thickness in nanometres, plus the substrate index.
    ],
    [
      #h3[What you get back]
      #v(4pt)
      Spectra, a sheet resistance, a shielding curve — and, if you ask, a recommended stack.
    ],
  )
  #v(0.4cm)
  #card[
    One library, one REST API, one stdio RPC endpoint, one CLI, one desktop app —
    *the same physics in all five.*
  ]
]

// ---------------------------------------------------------------- 4
#slide(kicker: "03 · Physics", title: "Every model carries its literature source")[
  #cards(
    (1fr, 1fr, 1fr),
    [
      #h3[Optics — transfer-matrix method]
      #v(5pt)
      $T = 4 eta_0 "Re"(eta_s) \/ abs(eta_0 B + C)^2$
      #v(3pt)
      #text(size: 9.5pt, fill: muted)[Metal dispersion via Drude: $epsilon(omega) = epsilon_infinity - omega_p^2\/(omega^2 + i gamma omega)$]
      #v(4pt)
      #text(size: 9pt, fill: muted)[Macleod, *Thin-Film Optical Filters* (2017)]
    ],
    [
      #h3[Electrical — parallel + size effect]
      #v(5pt)
      $1 \/ R_s = sum_i d_i \/ rho_"eff",i$
      #v(3pt)
      #text(size: 9.5pt, fill: muted)[Fuchs–Sondheimer correction for films thinner than the electron mean free path]
      #v(4pt)
      #text(size: 9pt, fill: muted)[Fuchs 1938 · Sondheimer 1952]
    ],
    [
      #h3[Shielding — transmission line]
      #v(5pt)
      $"SE" approx 20 log_10 (1 + Z_0 \/ (2 R_s))$
      #v(3pt)
      #text(size: 9.5pt, fill: muted)[Exact ABCD model plus the Schelkunoff split $R + A + M$]
      #v(4pt)
      #text(size: 9pt, fill: muted)[Schelkunoff 1943 · Paul 2006 · Ott 2009]
    ],
  )
  #v(0.4cm)
  #card[
    Assumptions are stated, not hidden: ideal planar interfaces with no scattering, so
    $T + R + A = 1$ exactly — and a flat SE curve for a thin film is physics, not a plotting bug.
  ]
]

// ---------------------------------------------------------------- 5
#slide(kicker: "04 · Architecture", title: "Three languages, one contract")[
  #v(0.15cm)
  #text(size: 9.5pt, weight: "bold", tracking: 1pt, fill: muted)[WEB / DEVELOPMENT]
  #v(4pt)
  #flow(
    fbox[Vue 3 + TS\ #text(size: 9pt, weight: "regular", fill: muted)[frontend]],
    arrow(t: "— REST/JSON →"),
    fbox[Go\ #text(size: 9pt, weight: "regular", fill: muted)[tasks · storage · JWT]],
    arrow(t: "— HTTP →"),
    fbox[omo.api\ #text(size: 9pt, weight: "regular", fill: muted)[FastAPI engine]],
  )
  #v(0.4cm)
  #text(size: 9.5pt, weight: "bold", tracking: 1pt, fill: muted)[DESKTOP · NO LISTENING PORT]
  #v(4pt)
  #flow(
    fbox[Vue 3 + TS\ #text(size: 9pt, weight: "regular", fill: muted)[renderer]],
    arrow(t: "— IPC →"),
    fbox[Electron Host\ #text(size: 9pt, weight: "regular", fill: muted)[supervises]],
    arrow(t: "— stdio →"),
    fbox[Go --stdio],
    arrow(t: "— stdio →"),
    fbox[omo.rpc\ #text(size: 9pt, weight: "regular", fill: muted)[engine]],
  )
  #v(0.45cm)
  #card[
    Only the transport and the auth mode differ. Params and results are *field-for-field identical*,
    and tests assert that on both sides (`contract_test.go`, `test_rpc.py`).
  ]
]

// ---------------------------------------------------------------- 6
#slide(kicker: "05 · Design rules", title: "Four decisions that keep it honest")[
  #cards(
    (1fr, 1fr),
    [
      #h3[Physics lives only in Python]
      #v(4pt)
      Go orchestrates and stores; the UI never computes a number. Every formula has exactly one implementation.
    ],
    [
      #h3[One contract, two transports]
      #v(4pt)
      HTTP and stdio share the same payload shape, checked field by field instead of by convention.
    ],
  )
  #v(0.35cm)
  #cards(
    (1fr, 1fr),
    [
      #h3[A child process, not a service]
      #v(4pt)
      In desktop mode Go spawns the engine. If it cannot be found, startup fails loudly — a silent HTTP fallback would break the no-port promise.
    ],
    [
      #h3[Optional dependencies stay out]
      #v(4pt)
      The base install is numpy + scipy. An import-graph test proves that the stdio entry point pulls in neither torch nor FastAPI.
    ],
  )
]

// ---------------------------------------------------------------- 7
#slide(kicker: "06 · Feature", title: "Forward simulation: spectra, not slogans")[
  #grid(
    columns: (1fr, 1.35fr),
    gutter: 0.45cm,
    [
      #card[
        #h3[What comes out]
        #v(6pt)
        #bullet[Transmittance and reflectance over 380–1000 nm — 63 points by default]
        #v(5pt)
        #bullet[Absorptance from the energy balance: $A = 1 - T - R$]
        #v(5pt)
        #bullet[Sheet resistance with the Fuchs–Sondheimer size effect]
        #v(5pt)
        #bullet[Shielding over 1–18 GHz, with the Schelkunoff components split out]
      ]
    ],
    [
      #v(0.1cm)
      #cards(
        (1fr, 1fr),
        gutter: 0.3cm,
        mcard([3.970819], [Ω/sq  sheet resistance]),
        mcard([0.974497], [T at 550 nm]),
      )
      #v(0.3cm)
      #cards((1fr,), gutter: 0.3cm, mcard([33.7036 dB], [SE at 10 GHz  ·  ITO(40)/Ag(10)/ITO(40)]))
    ],
  )
  #v(0.35cm)
  #card[
    Those three numbers come out of the library, the REST API, the stdio RPC endpoint, the Go
    middleware and the desktop app — which is what makes "same physics everywhere" testable.
  ]
]

// ---------------------------------------------------------------- 8
#slide(kicker: "07 · Feature", title: "Inverse design: constraints in, candidates out")[
  #v(0.15cm)
  #flow(
    fbox[Hard constraints\ #text(size: 9pt, weight: "regular", fill: muted)[$T_"vis" >= 0.85$ · $R_s <= 12$ · $"SE" >= 25$]],
    arrow(),
    fbox[Deterministic scan\ #text(size: 9pt, weight: "regular", fill: muted)[≈4096 thickness combos, ~3 s]],
    arrow(),
    fbox[Ranked candidates\ #text(size: 9pt, weight: "regular", fill: muted)[FoM $= T_"vis"^10 \/ R_s$]],
  )
  #v(0.45cm)
  #cards(
    (1fr, 1fr),
    [
      #h3[Per-layer sensitivity]
      #v(4pt)
      A ±1 nm finite difference per layer: how much FoM, $T_"vis"$ and $log_10 R_s$ actually move.
      It answers *which layer is worth controlling*.
    ],
    [
      #h3[Process window]
      #v(4pt)
      How far a single layer may drift before the target stops being met (0.5 nm probe, up to ±5 nm).
    ],
  )
  #v(0.35cm)
  #card[
    The search calls the same evaluator as the forward simulation, so an inverse-design answer is
    self-consistent by construction — and the interface stays put when the surrogate takes over.
  ]
]

// ---------------------------------------------------------------- 9
#slide(kicker: "08 · Feature", title: "The loop that keeps the model honest")[
  #v(0.15cm)
  #flow(
    fbox[3 published datasets\ #text(size: 9pt, weight: "regular", fill: muted)[T · Rs · SE, with DOI]],
    arrow(),
    fbox[Run the same stack],
    arrow(),
    fbox[Fit effective parameters\ #text(size: 9pt, weight: "regular", fill: muted)[bounded, in log space]],
    arrow(),
    fbox[Holdout check],
  )
  #v(0.45cm)
  #cards(
    (1fr, 1fr, 1fr),
    mcard([↓92 %], [weighted training loss], vc: green),
    mcard([↓51 %], [holdout Rs MAE], vc: green),
    mcard([2 / 3], [fitted values at their bound], vc: amber),
  )
  #v(0.35cm)
  #card(c: amber-bg)[
    #text(weight: "bold", fill: amber)[Ag ρ = 2.60×10⁻⁸ Ω·m and ITO n = 2.1 both hit the ceiling.]
    \ They are *effective parameters* that absorb unmodelled interface and grain-boundary scattering —
    the CRC bulk value is still the physical truth, and two of three values sitting on the bound is
    itself the finding: the model form, not the constant, is what has to change.
  ]
]

// ---------------------------------------------------------------- 10
#slide(kicker: "09 · Feature", title: "Five ways in, one engine underneath")[
  #cards(
    (1fr, 1fr, 1fr, 1fr, 1fr),
    gutter: 0.28cm,
    [
      #h3[CLI]
      #v(4pt)
      #text(size: 9.5pt)[`omo-cli optimize`]
    ],
    [
      #h3[REST]
      #v(4pt)
      #text(size: 9.5pt)[`/simulate`\ `/optimize`]
    ],
    [
      #h3[stdio RPC]
      #v(4pt)
      #text(size: 9.5pt)[`ping`\ `simulate`\ `optimize`]
    ],
    [
      #h3[Web UI]
      #v(4pt)
      #text(size: 9.5pt)[design page,\ charts, history]
    ],
    [
      #h3[Desktop app]
      #v(4pt)
      #text(size: 9.5pt)[single user,\ no login]
    ],
  )
  #v(0.45cm)
  #cards(
    (1.35fr, 1fr),
    [
      #h3[Surrogate model (M2.5)]
      #v(4pt)
      A neural network reproduces the engine's T / Rs / SE to better than 0.1 % — but only inside a
      narrow domain (ITO/Ag/ITO thickness, outer 20–80 nm, metal 5–20 nm).
      #v(4pt)
      #text(size: 9.5pt, fill: muted)[Accuracy is measured against the *engine*, never claimed against literature.]
    ],
    [
      #h3[Status]
      #v(4pt)
      #chip("trained", green) #chip("validated", green) #chip("not wired in", amber)
      #v(6pt)
      The interface for acceleration exists; the wiring is the remaining work.
    ],
  )
]

// ---------------------------------------------------------------- 11
#slide(kicker: "10 · Status", title: "What the tests say today (2026-10-03)")[
  #table(
    columns: (auto, 1.15fr, 1fr),
    inset: (x: 7pt, y: 5pt),
    stroke: (x: none, y: 0.6pt + hair),
    [*Layer*], [*Command*], [*Result*],
    [Python engine], [`pytest` / `ruff`], [*132 passed*, lint clean],
    [Go middleware], [`go test ./...`], [all packages ok],
    [Frontend], [`pnpm test` / `build` / `lint`], [*60 passed*, build produced `dist`],
    [Desktop], [`pnpm type-check` / `test`], [*150 passed*, 3 gated E2E skipped],
  )
  #v(0.35cm)
  #cards(
    (1fr, 1fr, 1fr),
    mcard([70], [commits on `master`]),
    mcard([213], [tracked files]),
    mcard([34], [pages in this deck,\ 2 languages]),
  )
  #v(0.35cm)
  #card[
    Every row came from *running the command*, not from reading the documentation. Where the two
    disagree, this deck quotes the command.
  ]
]

// ---------------------------------------------------------------- 12
#slide(kicker: "11 · Status", title: "M0 → M6: physics, stack, desktop")[
  #cards(
    (1fr, 1fr, 1fr, 1fr),
    gutter: 0.3cm,
    [
      #h3[M0 · Scaffold] #v(3pt) #chip("done", green)
      #v(4pt)
      #text(size: 9.5pt)[uv project, Go skeleton, CI]
    ],
    [
      #h3[M1 · Physics] #v(3pt) #chip("done", green)
      #v(4pt)
      #text(size: 9.5pt)[TMM + Drude, sheet resistance + F–S, transmission-line SE]
    ],
    [
      #h3[M2 · Benchmark] #v(3pt) #chip("done", green)
      #v(4pt)
      #text(size: 9.5pt)[3 real datasets, reports, calibration loop]
    ],
    [
      #h3[M2.5 · Surrogate] #v(3pt) #chip("done", green)
      #v(4pt)
      #text(size: 9.5pt)[engine-generated data, T / Rs / SE surrogate]
    ],
  )
  #v(0.3cm)
  #cards(
    (1fr, 1fr, 1fr, 1fr),
    gutter: 0.3cm,
    [
      #h3[M3 · Go layer] #v(3pt) #chip("done", green)
      #v(4pt)
      #text(size: 9.5pt)[users, tasks, GORM, REST + stdio RPC]
    ],
    [
      #h3[M4 · Frontend] #v(3pt) #chip("done", green)
      #v(4pt)
      #text(size: 9.5pt)[design page, charts, history, target page]
    ],
    [
      #h3[M5 · Inverse design] #v(3pt) #chip("partial", amber)
      #v(4pt)
      #text(size: 9.5pt)[v1 engine + v2 API/UI done; report export, advanced optimizers, surrogate acceleration remain]
    ],
    [
      #h3[M6 · Integration] #v(3pt) #chip("in progress", amber)
      #v(4pt)
      #text(size: 9.5pt)[desktop T1–T8 done, T9 mostly, T10–T11 pending]
    ],
  )
]

// ---------------------------------------------------------------- 13
#slide(kicker: "12 · Status", title: "Desktop form: portless by construction")[
  #v(0.1cm)
  #flow(
    fbox[Renderer\ #text(size: 9pt, weight: "regular", fill: muted)[same Vue build]],
    arrow(t: "— IPC →"),
    fbox[Electron Host\ #text(size: 9pt, weight: "regular", fill: muted)[logs · lock · supervision]],
    arrow(t: "— stdio →"),
    fbox[Go --stdio\ #text(size: 9pt, weight: "regular", fill: muted)[single user, SQLite]],
    arrow(t: "— stdio →"),
    fbox[omo.rpc\ #text(size: 9pt, weight: "regular", fill: muted)[pure numpy/scipy]],
  )
  #v(0.4cm)
  #text(size: 9.5pt, weight: "bold", tracking: 1pt, fill: muted)[TASK STATUS]
  #v(5pt)
  #grid(
    columns: (1fr,) * 11,
    gutter: 3pt,
    ..(
      ("T1", green), ("T2", green), ("T3", green), ("T4", green), ("T4.5", green),
      ("T5", green), ("T6", green), ("T7", red), ("T8", green), ("T9", amber), ("T10–11", grey),
    ).map(t => block(width: 100%, fill: t.at(1), radius: 3pt, inset: (y: 7pt))[
      #set align(center)
      #text(size: 8.5pt, weight: "bold", fill: white)[#t.at(0)]
    ]),
  )
  #v(0.4cm)
  #cards(
    (1fr, 1fr),
    [
      #h3[Verified by execution]
      #v(4pt)
      The chain computes the reference values, and while it runs the process tree holds
      *no LISTENING socket*. The PyInstaller engine sidecar also computes them with no Python installed.
    ],
    [
      #h3[T7 is red on purpose]
      #v(4pt)
      The shell is written and type-checked against real Electron types, but it has *never been
      launched* — no Electron binary in the build environment. That is T11's job.
    ],
  )
]

// ---------------------------------------------------------------- 14
#slide(kicker: "13 · Honesty", title: "Two things are still unproven")[
  #v(0.3cm)
  #cards(
    (1fr, 1fr),
    [
      #text(size: 15pt, weight: "bold", fill: red)[The shell has never started]
      #v(6pt)
      Window creation, `app://` rendering of the built frontend, whether the CSP clips Vue or ECharts,
      and whether the preload bridge really injects `window.omo` are all *untested*.
    ],
    [
      #text(size: 15pt, weight: "bold", fill: red)[electron-builder has never run]
      #v(6pt)
      The packaging configuration is a *layout contract*, not an observation. The final
      installer and zip have never been produced.
    ],
  )
  #v(0.45cm)
  #card[
    Everything else shown in this deck was executed and can be re-run from the repository:
    `pytest`, `go test ./...`, `pnpm test`, the packaging scripts, and the reference case itself.
  ]
]

// ---------------------------------------------------------------- 15
#slide(kicker: "14 · Limits", title: "Where the model stops being true")[
  #cards(
    (1fr, 1fr),
    [
      #h3[The physics]
      #v(4pt)
      Below ≈10 nm, silver grows as islands: the continuous-film assumption fails and the error grows.
      No dispersion in the oxides, no roughness, no interdiffusion, no annealing.
      Materials are a whitelist: ITO, Ag, glass.
    ],
    [
      #h3[The evidence]
      #v(4pt)
      Three papers, about nine measured points, one deposition process each. Point predictions only —
      no error bars — and the process window is a deterministic tolerance, not a distribution.
    ],
  )
  #v(0.3cm)
  #cards(
    (1fr, 1fr),
    [
      #h3[The design space]
      #v(4pt)
      Fixed three-layer OMO. Hard constraints only, one ranking metric (Haacke FoM), no Pareto front.
      Deterministic grid scan with exponential cost; the surrogate is not yet an accelerator.
    ],
    [
      #h3[The deployment]
      #v(4pt)
      The desktop form has *no authentication* — never expose it to a network. Tasks are in-process
      and asynchronous; SQLite means one machine, one instance. No browser-level E2E test yet.
    ],
  )
]

// ---------------------------------------------------------------- 16
#slide(kicker: "15 · Potential", title: "What it can become")[
  #cards(
    (1fr, 1fr, 1fr),
    [
      #h3[Finish — near term]
      #v(5pt)
      #bullet[Run the shell on a machine with Electron and close T11]
      #v(4pt)
      #bullet[Produce the real installer and zip]
      #v(4pt)
      #bullet[Release pipeline with a SHA-256 manifest]
      #v(4pt)
      #bullet[Report export for the lab notebook]
    ],
    [
      #h3[Deepen — mid term]
      #v(5pt)
      #bullet[Wire the surrogate in as the evaluator: far larger design spaces]
      #v(4pt)
      #bullet[Gradient-based inverse design on a differentiable surrogate]
      #v(4pt)
      #bullet[Multi-objective search with a Pareto front]
    ],
    [
      #h3[Widen — longer term]
      #v(5pt)
      #bullet[More materials and dispersive oxides: ZnO, TiO₂, AZO, Cu, Al]
      #v(4pt)
      #bullet[Roughness and percolation-aware thin-metal models]
      #v(4pt)
      #bullet[Uncertainty estimates; cross-platform packaging]
      #v(4pt)
      #bullet[Teaching material: formula → curve → decision, in one auditable path]
    ],
  )
]

// ---------------------------------------------------------------- 17
#end-slide(
  [Model, compare with published measurements, calibrate the effective parameters, then design under constraints — in one auditable, dependency-light tool.],
  [github.com/1Vewton/OMOPredict  ·  v0.1.0  ·  English deck ends here; 中文版 follows],
)

// ============================================================================
//  PART II — 中文版
// ============================================================================
#deck-info.update((base: 17, total: 17, label: "中文版"))
#set text(font: ("Segoe UI", "Microsoft YaHei"), lang: "zh")

#title-slide(
  kicker: "项目幻灯片 · 2026-10-03",
  title: "OMOPredict",
  sub: "面向 OMO（氧化物/金属/氧化物）纳米多层薄膜的轻量化仿真与设计软件",
  metrics: (
    ([132], [个测试通过]),
    ([3.970819], [Ω/sq 方阻]),
    ([97.4 %], [可见光透过率]),
    ([33.7 dB], [10 GHz 屏蔽效能]),
  ),
  foot: "github.com/1Vewton/OMOPredict  ·  v0.1.0  ·  Python + Go + Vue 3 + Electron",
)

// ---------------------------------------------------------------- 2
#slide(kicker: "01 · 问题", title: "透明导电薄膜，本质上是三个问题叠加")[
  #cards(
    (1fr, 1fr, 1fr),
    [
      #h3[光学]
      #v(5pt)
      既要透明、又要增透：氧化物层不能把金属挡掉的光再吃掉。
    ],
    [
      #h3[电学]
      #v(5pt)
      导电性寄托在 10 nm 的金属膜上，而它的电阻率*不是*块体值。
    ],
    [
      #h3[电磁]
      #v(5pt)
      屏蔽效能来自同一层膜，还得经得起弯折和时间。
    ],
  )
  #v(0.4cm)
  #card(c: amber-bg)[
    #text(weight: "bold", fill: amber)[而文献给出的，是来自互不兼容工艺的孤立测量值。]
    \ 于是只能：镀膜、测量、调参、再来一轮。
  ]
]

// ---------------------------------------------------------------- 3
#slide(kicker: "02 · 方案", title: "输入结构，输出性能")[
  #v(0.25cm)
  #flow(
    fbox[膜层结构\ #text(size: 9pt, weight: "regular", fill: muted)[厚度 · 材料 · 衬底]],
    arrow(),
    fbox[物理引擎\ #text(size: 9pt, weight: "regular", fill: muted)[TMM · F–S · 传输线]],
    arrow(),
    fbox[性能指标\ #text(size: 9pt, weight: "regular", fill: muted)[T(λ) · R(λ) · Rs · SE(f) · FoM]],
  )
  #v(0.55cm)
  #cards(
    (1fr, 1fr),
    [
      #h3[你要给的]
      #v(4pt)
      一张膜层表：材料名 + 纳米级厚度，外加衬底折射率。
    ],
    [
      #h3[你会拿到的]
      #v(4pt)
      光谱曲线、方阻、屏蔽曲线——以及（如果需要）一个推荐的膜厚组合。
    ],
  )
  #v(0.4cm)
  #card[
    一个库、一个 REST 接口、一个 stdio RPC 端点、一个命令行、一个桌面应用——
    *五处入口，同一套物理。*
  ]
]

// ---------------------------------------------------------------- 4
#slide(kicker: "03 · 物理内核", title: "每个模型都带文献出处")[
  #cards(
    (1fr, 1fr, 1fr),
    [
      #h3[光学 —— 传输矩阵法]
      #v(5pt)
      $T = 4 eta_0 "Re"(eta_s) \/ abs(eta_0 B + C)^2$
      #v(3pt)
      #text(size: 9.5pt, fill: muted)[金属色散用 Drude：$epsilon(omega) = epsilon_infinity - omega_p^2\/(omega^2 + i gamma omega)$]
      #v(4pt)
      #text(size: 9pt, fill: muted)[Macleod, *Thin-Film Optical Filters* (2017)]
    ],
    [
      #h3[电学 —— 并联 + 尺寸效应]
      #v(5pt)
      $1 \/ R_s = sum_i d_i \/ rho_"eff",i$
      #v(3pt)
      #text(size: 9.5pt, fill: muted)[膜厚与电子平均自由程可比时，计入 Fuchs–Sondheimer 修正]
      #v(4pt)
      #text(size: 9pt, fill: muted)[Fuchs 1938 · Sondheimer 1952]
    ],
    [
      #h3[屏蔽 —— 传输线模型]
      #v(5pt)
      $"SE" approx 20 log_10 (1 + Z_0 \/ (2 R_s))$
      #v(3pt)
      #text(size: 9.5pt, fill: muted)[精确 ABCD 模型 + Schelkunoff 的 $R + A + M$ 分解]
      #v(4pt)
      #text(size: 9pt, fill: muted)[Schelkunoff 1943 · Paul 2006 · Ott 2009]
    ],
  )
  #v(0.4cm)
  #card[
    假设是写出来的，不是藏起来的：理想平面、无散射，因此 $T + R + A = 1$ 精确成立；
    薄膜的 SE 曲线是平的，那是物理结果，不是绘图 bug。
  ]
]

// ---------------------------------------------------------------- 5
#slide(kicker: "04 · 架构", title: "三种语言，一份契约")[
  #v(0.15cm)
  #text(size: 9.5pt, weight: "bold", tracking: 1pt, fill: muted)[WEB / 开发形态]
  #v(4pt)
  #flow(
    fbox[Vue 3 + TS\ #text(size: 9pt, weight: "regular", fill: muted)[前端]],
    arrow(t: "— REST/JSON →"),
    fbox[Go\ #text(size: 9pt, weight: "regular", fill: muted)[任务 · 存储 · JWT]],
    arrow(t: "— HTTP →"),
    fbox[omo.api\ #text(size: 9pt, weight: "regular", fill: muted)[FastAPI 引擎]],
  )
  #v(0.4cm)
  #text(size: 9.5pt, weight: "bold", tracking: 1pt, fill: muted)[桌面形态 · 全程不监听端口]
  #v(4pt)
  #flow(
    fbox[Vue 3 + TS\ #text(size: 9pt, weight: "regular", fill: muted)[渲染进程]],
    arrow(t: "— IPC →"),
    fbox[Electron Host\ #text(size: 9pt, weight: "regular", fill: muted)[守护后端]],
    arrow(t: "— stdio →"),
    fbox[Go --stdio],
    arrow(t: "— stdio →"),
    fbox[omo.rpc\ #text(size: 9pt, weight: "regular", fill: muted)[引擎]],
  )
  #v(0.45cm)
  #card[
    两种形态只有传输方式与认证模式不同。请求参数与返回结果*逐字段相同*，
    并由两侧测试守护（`contract_test.go`、`test_rpc.py`）。
  ]
]

// ---------------------------------------------------------------- 6
#slide(kicker: "05 · 设计纪律", title: "四条让它保持诚实的决定")[
  #cards(
    (1fr, 1fr),
    [
      #h3[物理只在 Python 层]
      #v(4pt)
      Go 只做编排与存储，前端不自己算数。每一条公式都只有一份实现。
    ],
    [
      #h3[一份契约、两种传输]
      #v(4pt)
      HTTP 与 stdio 共用同一份载荷形态，并逐字段比对，而不是靠"约定"。
    ],
  )
  #v(0.35cm)
  #cards(
    (1fr, 1fr),
    [
      #h3[是子进程，不是服务]
      #v(4pt)
      桌面形态下由 Go 拉起引擎；找不到引擎就启动即失败——静默回退到 HTTP 会直接破坏"无端口"的承诺。
    ],
    [
      #h3[可选依赖按设计排除]
      #v(4pt)
      基础安装只有 numpy + scipy，并用 import 图测试证明 stdio 入口不会拉进 torch 或 FastAPI。
    ],
  )
]

// ---------------------------------------------------------------- 7
#slide(kicker: "06 · 功能", title: "正向仿真：给的是光谱，不是口号")[
  #grid(
    columns: (1fr, 1.35fr),
    gutter: 0.45cm,
    [
      #card[
        #h3[输出什么]
        #v(6pt)
        #bullet[380–1000 nm 的透过率与反射率，默认 63 个点]
        #v(5pt)
        #bullet[吸收率由能量守恒导出：$A = 1 - T - R$]
        #v(5pt)
        #bullet[方阻含 Fuchs–Sondheimer 尺寸效应]
        #v(5pt)
        #bullet[1–18 GHz 屏蔽效能，并给出 Schelkunoff 组分分解]
      ]
    ],
    [
      #v(0.1cm)
      #cards(
        (1fr, 1fr),
        gutter: 0.3cm,
        mcard([3.970819], [Ω/sq 方阻]),
        mcard([0.974497], [550 nm 处透过率]),
      )
      #v(0.3cm)
      #cards((1fr,), gutter: 0.3cm, mcard([33.7036 dB], [10 GHz 处屏蔽效能  ·  ITO(40)/Ag(10)/ITO(40)]))
    ],
  )
  #v(0.35cm)
  #card[
    这三个数从库入口、REST API、stdio RPC、Go 中间层到桌面应用都能复现——
    正因如此，"处处同一套物理"才是*可测的*，而不是一句愿景。
  ]
]

// ---------------------------------------------------------------- 8
#slide(kicker: "07 · 功能", title: "目标反推：给约束，出候选")[
  #v(0.15cm)
  #flow(
    fbox[硬约束\ #text(size: 9pt, weight: "regular", fill: muted)[$T_"vis" >= 0.85$ · $R_s <= 12$ · $"SE" >= 25$]],
    arrow(),
    fbox[确定性扫描\ #text(size: 9pt, weight: "regular", fill: muted)[约 4096 组膜厚，~3 秒]],
    arrow(),
    fbox[候选排序\ #text(size: 9pt, weight: "regular", fill: muted)[FoM $= T_"vis"^10 \/ R_s$]],
  )
  #v(0.45cm)
  #cards(
    (1fr, 1fr),
    [
      #h3[逐层灵敏度]
      #v(4pt)
      每层 ±1 nm 有限差分：FoM、$T_"vis"$、$log_10 R_s$ 到底动了多少。
      它回答的是*哪一层值得控*。
    ],
    [
      #h3[工艺窗口]
      #v(4pt)
      单层可以漂多远、目标仍能满足（0.5 nm 探测步长，上限 ±5 nm）。
    ],
  )
  #v(0.35cm)
  #card[
    反推调用与正向仿真同一条求值路径，因此结果在构造上自洽；
    等代理模型接手求值时，这个接口不需要改。
  ]
]

// ---------------------------------------------------------------- 9
#slide(kicker: "08 · 功能", title: "让模型保持诚实的那个闭环")[
  #v(0.15cm)
  #flow(
    fbox[3 篇文献数据集\ #text(size: 9pt, weight: "regular", fill: muted)[T · Rs · SE，附 DOI]],
    arrow(),
    fbox[用同一结构复算],
    arrow(),
    fbox[拟合有效参数\ #text(size: 9pt, weight: "regular", fill: muted)[有界、log 空间]],
    arrow(),
    fbox[留出集验证],
  )
  #v(0.45cm)
  #cards(
    (1fr, 1fr, 1fr),
    mcard([↓92 %], [加权训练损失], vc: green),
    mcard([↓51 %], [留出集 Rs MAE], vc: green),
    mcard([2 / 3], [拟合值触到边界], vc: amber),
  )
  #v(0.35cm)
  #card(c: amber-bg)[
    #text(weight: "bold", fill: amber)[Ag ρ = 2.60×10⁻⁸ Ω·m 与 ITO n = 2.1 都顶到了上界。]
    \ 它们是*有效参数*，吸收的是模型未表达的界面与晶界散射——CRC 块体值仍是物理真值。
    三个值里两个触界，这本身就是结论：要改的是*模型形式*，不是常数。
  ]
]

// ---------------------------------------------------------------- 10
#slide(kicker: "09 · 功能", title: "五个入口，底下同一个引擎")[
  #cards(
    (1fr, 1fr, 1fr, 1fr, 1fr),
    gutter: 0.28cm,
    [
      #h3[命令行]
      #v(4pt)
      #text(size: 9.5pt)[`omo-cli optimize`]
    ],
    [
      #h3[REST]
      #v(4pt)
      #text(size: 9.5pt)[`/simulate`\ `/optimize`]
    ],
    [
      #h3[stdio RPC]
      #v(4pt)
      #text(size: 9.5pt)[`ping`\ `simulate`\ `optimize`]
    ],
    [
      #h3[Web 界面]
      #v(4pt)
      #text(size: 9.5pt)[设计页、\ 图表、历史]
    ],
    [
      #h3[桌面应用]
      #v(4pt)
      #text(size: 9.5pt)[单用户、\ 无登录]
    ],
  )
  #v(0.45cm)
  #cards(
    (1.35fr, 1fr),
    [
      #h3[代理模型（M2.5）]
      #v(4pt)
      神经网络复现引擎的 T / Rs / SE，相对误差优于 0.1%——但只在很窄的适用域内
      （ITO/Ag/ITO 三厚度，外层 20–80 nm、金属 5–20 nm）。
      #v(4pt)
      #text(size: 9.5pt, fill: muted)[精度以*引擎*为基准衡量，从不对文献宣称精度。]
    ],
    [
      #h3[状态]
      #v(4pt)
      #chip("已训练", green) #chip("已验证", green) #chip("尚未接入", amber)
      #v(6pt)
      加速用的接口已经留好；剩下的是接线。
    ],
  )
]

// ---------------------------------------------------------------- 11
#slide(kicker: "10 · 进度", title: "截至目前，测试说的是什么（2026-10-03）")[
  #table(
    columns: (auto, 1.15fr, 1fr),
    inset: (x: 7pt, y: 5pt),
    stroke: (x: none, y: 0.6pt + hair),
    [*层*], [*命令*], [*结果*],
    [Python 引擎], [`pytest` / `ruff`], [*132 passed*，lint 干净],
    [Go 中间层], [`go test ./...`], [全部包通过],
    [前端], [`pnpm test` / `build` / `lint`], [*60 passed*，构建产出 `dist`],
    [桌面], [`pnpm type-check` / `test`], [*150 passed*，3 个门控端到端用例跳过],
  )
  #v(0.35cm)
  #cards(
    (1fr, 1fr, 1fr),
    mcard([70], [`master` 分支提交数]),
    mcard([213], [受版本管理文件数]),
    mcard([34], [本套幻灯片页数\（两种语言）]),
  )
  #v(0.35cm)
  #card[
    上表每一行都是*把命令真跑一遍*得到的，而不是从文档抄来的。两者不一致时，这页以命令为准。
  ]
]

// ---------------------------------------------------------------- 12
#slide(kicker: "11 · 进度", title: "M0 → M6：物理、全栈、桌面")[
  #cards(
    (1fr, 1fr, 1fr, 1fr),
    gutter: 0.3cm,
    [
      #h3[M0 · 脚手架] #v(3pt) #chip("已完成", green)
      #v(4pt)
      #text(size: 9.5pt)[uv 工程、Go 骨架、CI]
    ],
    [
      #h3[M1 · 物理引擎] #v(3pt) #chip("已完成", green)
      #v(4pt)
      #text(size: 9.5pt)[TMM + Drude、并联方阻 + F–S、传输线屏蔽]
    ],
    [
      #h3[M2 · 文献对标] #v(3pt) #chip("已完成", green)
      #v(4pt)
      #text(size: 9.5pt)[3 篇真实数据集、对标报告、校准闭环]
    ],
    [
      #h3[M2.5 · 代理模型] #v(3pt) #chip("已完成", green)
      #v(4pt)
      #text(size: 9.5pt)[引擎生成数据，T / Rs / SE 正向代理]
    ],
  )
  #v(0.3cm)
  #cards(
    (1fr, 1fr, 1fr, 1fr),
    gutter: 0.3cm,
    [
      #h3[M3 · Go 中间层] #v(3pt) #chip("已完成", green)
      #v(4pt)
      #text(size: 9.5pt)[用户、任务、GORM、REST + stdio RPC]
    ],
    [
      #h3[M4 · 前端] #v(3pt) #chip("已完成", green)
      #v(4pt)
      #text(size: 9.5pt)[设计页、图表、历史、目标反推页]
    ],
    [
      #h3[M5 · 目标反推] #v(3pt) #chip("部分完成", amber)
      #v(4pt)
      #text(size: 9.5pt)[v1 引擎 + v2 API/前端已通；报告导出、高级寻优、代理加速待做]
    ],
    [
      #h3[M6 · 集成] #v(3pt) #chip("进行中", amber)
      #v(4pt)
      #text(size: 9.5pt)[桌面 T1–T8 完成、T9 大部分、T10–T11 待做]
    ],
  )
]

// ---------------------------------------------------------------- 13
#slide(kicker: "12 · 进度", title: "桌面形态：从设计上就不监听端口")[
  #v(0.1cm)
  #flow(
    fbox[渲染进程\ #text(size: 9pt, weight: "regular", fill: muted)[同一份前端构建]],
    arrow(t: "— IPC →"),
    fbox[Electron Host\ #text(size: 9pt, weight: "regular", fill: muted)[日志 · 锁 · 进程守护]],
    arrow(t: "— stdio →"),
    fbox[Go --stdio\ #text(size: 9pt, weight: "regular", fill: muted)[单用户、SQLite]],
    arrow(t: "— stdio →"),
    fbox[omo.rpc\ #text(size: 9pt, weight: "regular", fill: muted)[纯 numpy/scipy]],
  )
  #v(0.4cm)
  #text(size: 9.5pt, weight: "bold", tracking: 1pt, fill: muted)[任务状态]
  #v(5pt)
  #grid(
    columns: (1fr,) * 11,
    gutter: 3pt,
    ..(
      ("T1", green), ("T2", green), ("T3", green), ("T4", green), ("T4.5", green),
      ("T5", green), ("T6", green), ("T7", red), ("T8", green), ("T9", amber), ("T10–11", grey),
    ).map(t => block(width: 100%, fill: t.at(1), radius: 3pt, inset: (y: 7pt))[
      #set align(center)
      #text(size: 8.5pt, weight: "bold", fill: white)[#t.at(0)]
    ]),
  )
  #v(0.4cm)
  #cards(
    (1fr, 1fr),
    [
      #h3[已经实测的部分]
      #v(4pt)
      这条链路算得出参考数值，而且运行期间进程树里*没有任何 LISTENING 套接字*。
      PyInstaller 打出的引擎 sidecar 在无 Python 环境下同样算得对。
    ],
    [
      #h3[T7 是红的，故意的]
      #v(4pt)
      壳已经写完，也通过了针对真实 Electron 类型的类型检查，但它*从未被启动过*——
      构建环境里拿不到 Electron 二进制。这件事属于 T11。
    ],
  )
]

// ---------------------------------------------------------------- 14
#slide(kicker: "13 · 如实说", title: "还有两件事没有被证明")[
  #v(0.3cm)
  #cards(
    (1fr, 1fr),
    [
      #text(size: 15pt, weight: "bold", fill: red)[壳从未启动过]
      #v(6pt)
      窗口能否创建、`app://` 能否渲染构建好的前端、CSP 会不会裁掉 Vue 或 ECharts、
      preload 桥是否真的注入了 `window.omo`——这些*都没有实测过*。
    ],
    [
      #text(size: 15pt, weight: "bold", fill: red)[electron-builder 从未实跑]
      #v(6pt)
      打包配置目前只是一份*布局契约*，不是观测结果。真正的安装包与 zip 还没产出过。
    ],
  )
  #v(0.45cm)
  #card[
    这套幻灯片里其他所有内容都是跑出来的，并且可以在仓库里重跑：
    `pytest`、`go test ./...`、`pnpm test`、打包脚本，以及参考算例本身。
  ]
]

// ---------------------------------------------------------------- 15
#slide(kicker: "14 · 局限", title: "模型在哪里不再成立")[
  #cards(
    (1fr, 1fr),
    [
      #h3[物理模型]
      #v(4pt)
      银在约 10 nm 以下呈岛状生长：连续膜假设失效，误差随之变大。
      氧化物无色散，无粗糙度、无界面互扩散、无退火建模。材料是白名单：ITO、Ag、玻璃。
    ],
    [
      #h3[证据强度]
      #v(4pt)
      3 篇文献、约 9 个实测点，每篇对应单一沉积工艺。只有点预测、没有误差棒；
      工艺窗口是确定性容差，不是统计分布。
    ],
  )
  #v(0.3cm)
  #cards(
    (1fr, 1fr),
    [
      #h3[设计空间]
      #v(4pt)
      固定三层 OMO；只有硬约束、单一排序指标（Haacke FoM），没有 Pareto 前沿；
      确定性网格扫描，代价指数增长；代理模型尚未作为加速器接入。
    ],
    [
      #h3[部署形态]
      #v(4pt)
      桌面形态*没有认证*——绝不能暴露到网络。任务是进程内异步的；默认 SQLite 意味着单机单实例。
      也还没有浏览器级端到端测试。
    ],
  )
]

// ---------------------------------------------------------------- 16
#slide(kicker: "15 · 潜力", title: "它能长成什么")[
  #cards(
    (1fr, 1fr, 1fr),
    [
      #h3[先做完 · 近期]
      #v(5pt)
      #bullet[在装有 Electron 的机器上跑起壳，关闭 T11]
      #v(4pt)
      #bullet[产出真正的安装包与 zip]
      #v(4pt)
      #bullet[发布流程附 SHA-256 清单]
      #v(4pt)
      #bullet[报告导出，进实验记录本]
    ],
    [
      #h3[再挖深 · 中期]
      #v(5pt)
      #bullet[把代理模型接成求值器：设计空间大几个量级]
      #v(4pt)
      #bullet[在可微代理上做梯度反设计]
      #v(4pt)
      #bullet[多目标搜索与 Pareto 前沿]
    ],
    [
      #h3[再拓宽 · 长期]
      #v(5pt)
      #bullet[更多材料与色散氧化物：ZnO、TiO₂、AZO、Cu、Al]
      #v(4pt)
      #bullet[粗糙度与考虑渗流的薄金属模型]
      #v(4pt)
      #bullet[不确定度估计；跨平台打包]
      #v(4pt)
      #bullet[教学材料：公式 → 曲线 → 决策，一条可审计的路径]
    ],
  )
]

// ---------------------------------------------------------------- 17
#end-slide(
  [建模、与已发表实测对比、标定有效参数、再在约束下设计——全部装进一个可审计、依赖极轻的工具里。],
  [github.com/1Vewton/OMOPredict  ·  v0.1.0  ·  中文版结束],
)
