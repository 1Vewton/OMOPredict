# OMOPredict Frontend (M4 complete; M5 v2 adds the "inverse design" page)

> **English** · [中文版](README.md)

Vue 3 + TypeScript + Vite frontend: parameter design → submit simulation tasks → result visualisation (ECharts).

## Tech stack

- **Framework**: Vue 3 (Composition API + `<script setup>`), Vue Router, Pinia
- **Build**: Vite 7 + TypeScript (vue-tsc type checking)
- **Visualisation**: ECharts 5 (imported on demand: line chart + grid/legend/tooltip + Canvas rendering)
- **Code quality**: ESLint 9 (flat config, Vue's official TS rules) + Prettier

## Quick start

Prerequisites: the Go middleware layer is running (`server/`, default `:8080`) and the simulation engine is running (`engine/`, with `OMO_ENGINE_URL` pointing at it).

```bash
pnpm install
pnpm dev          # http://localhost:5173 (the dev server binds IPv6 ::1; 127.0.0.1 does not work)
```

The Vite dev server proxies `/api` to the Go middleware layer (default `http://127.0.0.1:8080`,
overridable with the `OMO_SERVER_URL` environment variable), avoiding CORS during development; in production deployment a reverse proxy (such as nginx) performs the same forwarding.

## Common commands

```bash
pnpm dev          # development server
pnpm build        # vue-tsc type checking + production build (output dist/)
pnpm preview      # preview the production build
pnpm lint         # ESLint check
pnpm test         # unit tests (vitest run, jsdom environment)
pnpm test:watch   # unit tests (watch mode)
pnpm format       # Prettier formatting
```

## Pages and routes

| Route | Page | Description |
|---|---|---|
| `/login` | Login/Register | A successful registration **does not log in automatically**; it jumps back to the login page to log in; the JWT is stored in localStorage. **In local single-user mode this page is redirected by the guard to `/design`** |
| `/design` | Parameter design | Layer table (material/thickness) + stack templates + substrate refractive index → submit a simulation task |
| `/optimize` | Inverse design | Performance targets (T/Rs/SE constraints + templates) → submit a kind=optimize task (scan space adjustable) |
| `/tasks/:id` | Task result | Branches by kind: simulate → T(λ)/R(λ) spectra + SE(f) + Rs card; optimize → candidate table + sensitivity/process window |
| `/history` | Task history | Type (simulation/inverse design) + status + summary + **delete** (two-step inline confirmation); auto-refreshes while there are pending tasks |

## Directory structure

```
src/
├── api/
│   ├── transport.ts  # transport abstraction: Transport interface + method↔endpoint mapping + http/ipc implementations + selection (window.omo)
│   ├── http.ts       # HTTP implementation: fetch + JWT injection + error message extraction; where ApiError is defined
│   ├── client.ts     # unified call entry point (401 → clear credentials + broadcast omo:unauthorized)
│   ├── token.ts      # credential persistence (used only in the JWT form)
│   ├── meta.ts       # capability endpoint (GET /api/meta)
│   └── auth.ts / tasks.ts   # business endpoints (called through client)
├── components/     # StatusBadge, SpectrumChart, SeChart, HelpTip
├── composables/    # useEChart (ECharts lifecycle wrapper)
├── content/        # centralised copy (help.ts tooltips, materials.ts material whitelist)
├── router/         # routes + guard (fetch meta first, then branch by mode)
├── stores/         # Pinia: auth (token/user + authRequired/isLocalMode capability gate)
├── styles/         # global styles
├── types/          # TS types corresponding to the backend JSON contract
├── utils/          # number.ts (tolerant numeric input)
└── views/          # LoginView / DesignView / OptimizeView / TaskDetailView / HistoryView
```

## Transport and capability gate (T5, see `docs/desktop.md` D10/D11)

**One of two transports**: `activeTransport()` in `api/transport.ts` detects `window.omo` (injected by the desktop shell's preload) —
if present it uses **IPC** (`window.omo.rpc(method, params)`, no network, no port), otherwise it uses **HTTP** (`fetch` with the relative path `/api/...`).
The **payloads of the two transports are field-for-field identical** (the RPC method name is the REST endpoint, with the mapping table in `transport.ts`), and errors are uniformly `ApiError`
(`status` follows HTTP semantics, and `error.code` on the IPC side is synonymous).

**Capability gate**: before mounting, `main.ts` calls `auth.bootstrap()` to fetch `meta` and decides from `auth_required` whether to require login:

- `auth_required === false` (desktop single-user) → the guard lets all pages through, `/login` redirects to `/design`,
  the top bar shows "local mode" and hides the username/logout, and `omo:unauthorized` is ignored;
- `auth_required === true` (Web default) → the login flow is kept;
- **fetching `meta` fails → fall back to "authentication required"**, to avoid wrongly letting protected pages through.

## Unit tests (vitest)

`pnpm test` (configuration in `vitest.config.ts`, jsdom environment, reusing vite's `@` alias). **60 cases, 5 files**:

| File | Coverage |
|---|---|
| `api/transport.test.ts` | Transport selection (`window.omo` detection/override), **all RPC method→endpoint mappings** (verb/path/whether a body is carried), path parameter encoding and missing-parameter errors, JWT injection, error normalisation for non-2xx and connection failures, the three error shapes of `toApiError`, **payload/result consistency of the same set of cases over HTTP and IPC** (the frontend part of `docs/desktop.md` §7) |
| `api/client.test.ts` | 401 (clearing credentials + broadcasting `omo:unauthorized`) without wrongly clearing on other status codes, normalisation of non-`ApiError`, method and parameter pass-through |
| `stores/auth.test.ts` | Gate: `auth_required` true/false, **meta failure falling back to authentication required**, the initial state defaulting to authentication required, idempotent `bootstrap`, login/logout/registration |
| `router/guard.test.ts` | Guard matrix: Web mode unauthenticated → redirect to login (with `redirect`), authenticated → allowed through, local mode allowing everything with `/login`→`/design`, meta failure still requiring login |
| `views/HistoryView.test.ts` | The two-step delete confirmation state machine: the first click only enters the confirmation state, the second click actually deletes and removes the row, cancel resets, failure shows an error and keeps the row, empty state |

> What is still not in place is a **browser end-to-end / real Electron shell smoke test** (part of desktop T7/T11); the behaviour of the gate in the real shell has not yet been measured.

## Conventions

- Field naming is snake_case, consistent with the `docs/api/rest.md` contract (AGENTS.md §6.7)
- **Layering discipline**: the frontend does not compute physical quantities; it only renders the T(λ)/R(λ)/Rs/SE(f) returned by the backend
- Authentication failure (401) uniformly redirects to the login page (in local single-user mode `App.vue` ignores this event)
- **Tolerant numeric input**: always read numbers with `parseNumberInput` from `utils/number.ts` (supports full-width characters, the `10,5` decimal comma,
  `1,500` thousands separators, and pasted values carrying units or percent signs such as `40 nm` / `85%` / `12 Ω/sq`)
- **Pre-submit validation**: material whitelist (`content/materials.ts`, same source as the engine registry),
  validity of step size / candidate count / SE frequency band, and the scan combination cap (`MAX_COMBINATIONS`, with a time estimate and suggestions when exceeded),
  to avoid "failing only after submitting"; native `confirm/alert` is not used (an embedded webview may disable it) and inline notices are used instead
- Forms are wrapped in `<form @submit.prevent>`, so pressing Enter in an input submits
