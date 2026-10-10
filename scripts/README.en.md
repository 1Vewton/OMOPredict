# scripts — build and ops scripts

> **English** · [中文版](README.md)

> Design in [`docs/desktop.md`](../docs/desktop.md) §6/§7; T8 delivers `setup-engine.ps1` and `build-lite.ps1`,
> T9 delivers `build-desktop.ps1` and `rpc-cli.ps1`, and T11 delivers `smoke-desktop.ps1`.

| Script | Task | Purpose |
|---|---|---|
| `setup-engine.ps1` | T8 | The lightweight-package user prepares the engine **on their own machine**: `uv sync --frozen`, otherwise `python -m pip install -e engine`; a `ping` is then sent once to confirm the engine is usable |
| `build-lite.ps1` | T8 | Assemble the lightweight package: rendered artefacts + Go backend + **engine source** + setup script + README → size gate → zip |
| `build-desktop.ps1` | T9 | Full package: rendered artefacts + Go backend + **PyInstaller engine sidecar** + shell TS (main ESM / preload CJS) → electron-builder → size gate |
| `rpc-cli.ps1` | T9 | Manual debugging: send one or more lines of JSON-RPC to the stdio endpoint, printing stderr logs and responses separately |
| `smoke-desktop.ps1` | T11 | **One command to decide whether the shell runs**: build everything (renderer/backend/shell TS) → start Electron → exit **0** on a successful render, **1** on failure with the reason printed |
| `start-local.ps1` | T9 | Shell-less debugging (HTTP mode + open a browser) — **to do** |

## Usage

```powershell
# Lightweight-package user: prepare the engine (once only)
powershell -ExecutionPolicy Bypass -File scripts\setup-engine.ps1
powershell -ExecutionPolicy Bypass -File scripts\setup-engine.ps1 -SkipInstall    # only verify that the engine is usable

# Lightweight package (requires the shell directory produced by electron-builder; -ShellDir can specify it)
powershell -ExecutionPolicy Bypass -File scripts\build-lite.ps1
powershell -ExecutionPolicy Bypass -File scripts\build-lite.ps1 -AllowMissingShell  # stage only + size gate

# Full package (engine built in, the user does not need to install Python; PyInstaller takes about 1 minute)
powershell -ExecutionPolicy Bypass -File scripts\build-desktop.ps1
powershell -ExecutionPolicy Bypass -File scripts\build-desktop.ps1 -SkipPackaging    # first four steps + size gate

# Debug the protocol (no need to launch the shell)
powershell -ExecutionPolicy Bypass -File scripts\rpc-cli.ps1 -Method ping
powershell -ExecutionPolicy Bypass -File scripts\rpc-cli.ps1 -Method tasks.list
powershell -ExecutionPolicy Bypass -File scripts\rpc-cli.ps1 -Target engine -Method ping
powershell -ExecutionPolicy Bypass -File scripts\rpc-cli.ps1 -Method no.such.method  # see -32601

# Shell smoke check (must be run in a normal terminal OUTSIDE the DSH sandbox - see below)
powershell -ExecutionPolicy Bypass -File scripts\smoke-desktop.ps1
powershell -ExecutionPolicy Bypass -File scripts\smoke-desktop.ps1 -SkipBuild   # reuse existing artefacts, faster
```

Exit codes: `setup-engine` / `rpc-cli` / `smoke-desktop` = 0 success / 1 failure;
`build-lite` / `build-desktop` = 0 package produced / 1 build or size-gate failure / **2 staged only**
(the final packaging step was not performed, and success is not faked).

> `smoke-desktop.ps1` is the T11 decider: on a successful render it prints `[smoke] OK` and exits 0,
> otherwise it prints the reason and exits 1 (it recognises native crash codes and hints whether you are
> inside the sandbox). It performs exactly the "must actually launch once" items in docs/desktop.md §10.
> ⚠️ **It necessarily fails inside the sandbox**: Electron's browser process cannot start there
> (full evidence in HANDOVER §6.31), so run this script in a **normal PowerShell window outside the
> sandbox**; inside it you will see a `0x80000003` native crash.

> `rpc-cli.ps1` places SQLite in the system temporary directory by default; in restricted environments (such as this repository's sandbox) use `-DataDir <writable directory>`
> to point it inside the workspace, otherwise you hit the "`%TEMP%` cannot write SQLite" pitfall from HANDOVER §6.23.

## ⚠️ The two hard rules for writing `.ps1` files (both have been hit)

1. **Comments must be ASCII only**. On Chinese Windows, PowerShell 5.1 reads `.ps1` as GBK, so CJK comments may "eat" the newline,
   commenting out the **next line of code**, while `Parser::ParseFile` reports 0 syntax errors (see HANDOVER §6.19).
2. **`Join-Path` accepts only one child path**. `Join-Path $a 'b' 'c'` requires the PS 6+ `-AdditionalChildPath`;
   on 5.1 it reports `A positional parameter cannot be found`. For multi-segment paths write `Join-Path $a 'b/c'`
   (forward slashes work on Windows too, and incidentally let the scripts run on Linux/macOS — that is how CI verifies them).

Also, when reading **Chinese text files**, pass `-Encoding UTF8` explicitly: PS 5.1 decodes BOM-less UTF-8 as ANSI,
and `ConvertFrom-Json` then fails outright (see HANDOVER §6.24).

## Size gates

Both packaging scripts follow the same idea: **manage "large constants we cannot control" and "the parts we can break" separately**.

`build-lite.ps1` (lightweight package):

| Gate | Default limit | Why this number |
|---|---|---|
| **app payload** | **50MB** | The part we control ourselves (Go backend + rendered artefacts + engine source + scripts). **This is the main gate against regressions**: leakage of torch/fastapi/matplotlib blows it up immediately (torch alone is several hundred MB). Measured ~27.5MB |
| **lite zip** | **150MB** | payload + Electron runtime. Electron itself is about 110MB compressed, a constant we cannot control |
| engine source directory | 90MB | Stops "packing the whole engine environment into the package" |

`build-desktop.ps1` (full package):

| Gate | Default limit | Why this number |
|---|---|---|
| **engine dir** | **250MB** | The PyInstaller onedir tree. **Measured 165.6MB** (numpy + scipy; torch/fastapi/uvicorn/matplotlib are all 0 entries). The original design said 90MB, estimated from "expected 50–90MB", which the measurement exceeded |
| **app payload** | **50MB** | Go backend + rendered artefacts + shell JS (measured 27.1MB) |
| **distributable** | **300MB** | The zip / nsis installer actually shipped (not the unpacked directory) |

```powershell
# Override on demand when needed (before changing, think clearly about which case this is)
-PayloadLimitMB 80      # the rendered artefacts/backend really did grow
-PackageLimitMB 200     # the Electron version was changed and the size changed
-EngineLimitMB 300      # the engine really did gain dependencies (but first confirm torch did not sneak in)
```

> ✅ **Decided (2026-09)**: the lightweight package **keeps the embedded Electron runtime**, so the original design's "lightweight package ≤50MB"
> is **relaxed to 150MB** (Electron is about 110MB compressed, and that number cannot possibly be compressed below 50MB); at the same time a new
> **app payload ≤50MB** tight gate was added to watch the part we really can break (measured 27.5MB).
> For the full package the **engine dir limit is relaxed from 90MB to 250MB** — likewise a measurement result: the PyInstaller-built
> numpy+scipy onedir is **165.6MB** (verified that the 4 excluded packages have 0 entries, and that the sidecar really does compute correct results).

## CI

In `.github/workflows/ci.yml`:

- the `desktop` job runs `pnpm build` (verifying that main=ESM / preload=CJS really are produced) + type-check + vitest;
- the `packaging` job (ubuntu + `pwsh`) runs:
  1. the full `build-lite.ps1` path with a **stub shell directory** (stage → size gate → compress), whose exit code must be 0;
  2. squeezes the gate limits down to 1MB to verify that it **really does block** (exit code 1);
  3. runs `setup-engine.ps1 -SkipInstall` in an environment with no engine installed, verifying that it exits 1 and prints the "What to check" guidance
     — that is, the T8 acceptance item "no-Python error path";
  4. uses the just-built backend to run `rpc-cli.ps1`'s `ping` (must get `"status":"ok"`) and an unknown method
     (must return `-32601`) — the debugging tool also needs someone to verify it.
