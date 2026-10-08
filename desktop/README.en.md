# desktop — desktop shell (Electron)

> **English** · [中文版](README.md)

> Design in [`docs/desktop.md`](../docs/desktop.md); this directory currently implements **T6 (Host layer)**.

## Status

| Task | Status | Description |
|---|---|---|
| **T6 Host layer** | ✅ Complete | `src/host/`: directories/logging/single instance/engine source/Go child-process supervision + stdio JSON-RPC client |
| **T7 Electron shell** | ✅ Complete (**never launched**) | `src/main.ts` + `src/preload.ts` + `src/shell/`; `tsc --noEmit` is clean against real Electron types, 150 unit tests |
| T8 lightweight package / T9 packaging and CI | ⏳ To do | `setup-engine.ps1`, `build-desktop.ps1` / `build-lite.ps1`, size gates |

**Both the Host layer and the shell logic deliberately do not depend on Electron** (`src/host/` and `src/shell/` are pure Node modules), so the vast majority of the
code can be unit-tested in a GUI-less environment; only `src/main.ts` / `src/preload.ts` are Electron wiring.

> ⚠️ **The shell still has not actually been launched** (rechecked 2026-10): the Electron binary **is
> now installed** (44.4.5, `dist` about 367MB), but **Electron's browser process cannot start inside the
> DSH sandbox** — even a 30-line minimal Electron app crashes before `app.whenReady()`
> (`0x80000003` by default; `0xC0000005` with `--no-sandbox`; every GPU/process flag tried made no difference).
> So "the window can open, `app://` can render `frontend/dist`, CSP does not accidentally break
> Vue/ECharts inline styles, and preload injects `window.omo`" have **still not been run** —
> they belong to the **T11 clean-machine acceptance** in docs/desktop.md §10.

## Smoke check (one command to decide whether the shell runs)

The shell has a built-in smoke hook (`OMO_DESKTOP_SMOKE_MS`, see `attachSmokeHooks` in `src/main.ts`):
if the renderer loads it prints `[smoke] OK` and exits **0**; on load failure or timeout it prints the
reason and exits **1**, forwarding the renderer console to the main-process stdout (CSP blocks and
preload-injection failures show up as console errors).

```powershell
cd desktop
pnpm build                                                  # main -> ESM / preload -> CJS
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue   # see warning below
$env:OMO_BACKEND_EXE = "<repo>\server\omopredict.exe"        # build it first with go build
$env:OMO_DESKTOP_SMOKE_MS = '45000'
pnpm exec electron .
```

> ⚠️ **You must clear `ELECTRON_RUN_AS_NODE` first**: when that variable is set, `electron.exe` behaves
> as plain Node (`electron --version` prints the *Node* version and `require('electron')` has no `app`),
> and the resulting errors are very hard to read. To check the real version, read
> `node_modules/electron/dist/version`, not `--version`.
> Download the binary from the **default source** (`npmmirror` times out on this machine):
> `node node_modules/electron/install.js`.

## Structure

```
src/
├── main.ts        # main-process wiring: window (app:// protocol), menu, IPC, single instance, graceful exit (T7)
├── preload.ts     # contextBridge allowlist → window.omo (T7)
├── host/          # Host layer (T6, no Electron, unit-testable in pure Node)
│   ├── paths.ts   # user data/log directories (D6: Windows %LOCALAPPDATA%\OMOPredict)
│   ├── logger.ts  # file log named by day + retained for 7 days (D7), can echo to stderr
│   ├── lines.ts   # JSON-Lines framing (half lines across chunks, over-long lines discarded)
│   ├── rpc.ts     # stdio JSON-RPC 2.0 client (id↔Promise, timeout, error codes = HTTP semantics)
│   ├── backend.ts # Go child-process supervision: spawn/health check/log capture/in-flight requests invalidated on exit/rate-limited restart/process-tree reaping
│   ├── engine.ts  # engine source detection (only the part Go cannot see) + D9 level-5 friendly guidance
│   ├── singleton.ts  # single-instance file lock
│   └── host.ts    # assembly: directories→logging→lock→engine→backend; exposes invoke()/dispose()
└── shell/         # shell logic (T7, likewise decoupled from Electron)
    ├── appProtocol.ts   # app:// resolution + SPA fallback + directory traversal protection + CSP/security headers
    ├── channels.ts      # IPC channel names + result envelope + preload-side restoration
    ├── preloadBridge.ts # builds window.omo (depends only on {invoke}, unit-testable with a fake ipcRenderer)
    ├── menu.ts          # menu template (about/data directory/log directory/export diagnostics)
    ├── windowOptions.ts # window and webPreferences security baseline
    ├── backendCommand.ts# locating the backend executable (env / packaged resources / repository build artefacts)
    └── diagnostics.ts   # diagnostics construction (**secret redaction**)
test/fixtures/fake-backend.mjs   # fake backend (real child process, real pipes), used to test the various failure paths
```

## Common commands

```bash
pnpm install
pnpm type-check   # tsc --noEmit (strict; includes real Electron types)
pnpm test         # vitest (node environment; cases really spawn child processes)
```

> ⚠️ This directory **does not yet configure eslint/prettier** (the frontend does). Per docs/desktop.md §7, desktop-side
> lint and the remaining toolchain belong to T9 and will be filled in together then.

## Integration tests (real backend + real engine)

Skipped by default; run after explicitly providing the backend executable and the engine command:

```powershell
cd server; go build -o ..\.itest\omopredict.exe .\cmd\omopredict
cd ..\desktop
$env:OMO_BACKEND_EXE = "$PWD\..\.itest\omopredict.exe"
$env:OMO_ENGINE_CMD  = '"<repo>\engine\.venv\Scripts\python.exe" -m omo.rpc'
$env:OMO_INTEGRATION_DIR = "$PWD\..\.itest\data"   # restricted environments must specify a writable directory, see HANDOVER §6
pnpm vitest run src/host/integration.test.ts
```

It verifies two chains:

1. **Host ↔ backend**: the Host starts Go (`--stdio`) → Go starts the engine (stdio) → `tasks.create` → poll `succeeded`
   → the values match the REST contract (Rs≈3.9708, T@550nm≈0.9745, SE@10GHz≈33.70) → delete →
   **the backend process listens on no port** (D11/§10.6) → graceful exit with no leftover processes.
2. **The chain visible to the renderer process (T7)**: `window.omo.rpc('meta')` → IPC envelope → **real Host/Go/engine** →
   create a task → poll → values match → a nonexistent task returns a **cross-process 404**.
   This chain uses the same handler factory as `src/main.ts` (`makeRpcHandler`) and the same bridge as the preload
   (`createOmoApi`), replacing only the Electron transport with a fake one — that is, everything except Electron itself is a real component.

## Interface with T7 (frozen)

```ts
const host = await Host.start({
  backendCommand: <path to omopredict-server.exe>,
  backendArgs: ['--stdio'],
  resourcesDir: <resources/ directory>,   // required when the full package bundles the engine
})
const tasks = await host.invoke('tasks.list')        // method names in docs/api/rpc.md
const off = host.onEvent((e) => { /* exit / restart / failed / stdout-pollution */ })
await host.dispose()
```

T7's preload exposes `window.omo.rpc(method, params)` per the contract frozen in T5: it resolves the result on success and
rejects with an HTTP-semantic `code` on failure — the implementation is in `src/shell/preloadBridge.ts` + `src/shell/channels.ts`
(the reason for the envelope mechanism is written in the comment at the top of `channels.ts`).

## Launching the shell (T7, requires the Electron binary)

```bash
# 1) Fetch the binary (downloads about 100MB+; not yet downloaded in this repository's environment)
pnpm rebuild electron        # or remove ELECTRON_SKIP_BINARY_DOWNLOAD at install time

# 2) Build the rendered artefacts and the backend
cd ..\frontend && pnpm build && cd ..\desktop
cd ..\server && go build -o ..\server\omopredict.exe .\cmd\omopredict && cd ..\desktop

# 3) Compile the TS and launch (the main entry is package.json's "main")
pnpm exec tsc -p tsconfig.json --outDir dist   # note: the sources are currently noEmit, and the compile configuration used for packaging belongs to T9
pnpm exec electron dist/main.js
```

> ⚠️ Step 3 above depends on the T9 build scripts (the current `tsconfig.json` is `noEmit`, and the preload needs to output `.cjs`).
> Until T9 fills this in, **the way to run it is not yet settled**; this is part of why "the shell has never been launched".
