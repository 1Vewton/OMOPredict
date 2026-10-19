# scripts — build and ops scripts

> **English** · [中文版](README.md)

> Design in [`docs/desktop.md`](../docs/desktop.md) §6/§7; T8 delivers `setup-engine.ps1` and `build-lite.ps1`,
> T9 delivers `build-desktop.ps1`, `rpc-cli.ps1`, `start-local.ps1` and `release-manifest.ps1`,
> and T11 delivers `smoke-desktop.ps1`.

| Script | Task | Purpose |
|---|---|---|
| `setup-engine.ps1` | T8 | The lightweight-package user prepares the engine **on their own machine**: `uv sync --frozen`, otherwise `python -m pip install -e engine`; a `ping` is then sent once to confirm the engine is usable |
| `build-lite.ps1` | T8 | Assemble the lightweight package: rendered artefacts + Go backend + **engine source** + setup script + README → size gate → zip |
| `build-desktop.ps1` | T9 | Full package: rendered artefacts + Go backend + **PyInstaller engine sidecar** + shell TS (main ESM / preload CJS) → electron-builder → size gate |
| `rpc-cli.ps1` | T9 | Manual debugging: send one or more lines of JSON-RPC to the stdio endpoint, printing stderr logs and responses separately |
| `start-local.ps1` | T9 | **Shell-less local debugging**: brings up `local-bridge.mjs` (HTTP ↔ Go `--stdio` ↔ engine), serves the renderer and prints/opens the browser URL |
| `release-manifest.ps1` | T9 | Release manifest: writes `SHA256SUMS.txt` + a JSON manifest for the artefacts; `-Verify` re-checks them (tampering always fails) |
| `smoke-desktop.ps1` | T11 | **One command to decide whether the shell runs**: build everything (renderer/backend/shell TS) → start Electron → exit **0** on a successful render, **1** on failure with the reason printed; it self-checks at the start whether it is running inside the harness |
| `diagnose-electron.ps1` | T11 | Electron launch diagnostics: prints "where am I running" (`ELECTRON_RUN_AS_NODE` / DSH variables / parent process) plus a launch matrix for a minimal Electron app, to tell "inside the sandbox" apart from "cannot start on this machine" |

`scripts/` also holds the Node modules the scripts use (currently only the local debug bridge):

| File | Purpose |
|---|---|
| `local-bridge-lib.mjs` | The bridge's **unit-testable core**: REST↔RPC route mapping, JSON-Lines client, static serving and traversal protection (zero dependencies) |
| `local-bridge-lib.d.mts` | Type declarations for that `.mjs` (imported by `desktop/src/shell/localBridge.test.ts`) |
| `local-bridge.mjs` | The bridge's CLI entry point: spawns Go `--stdio`, listens on the one port, serves the renderer |

> Why those `.mjs` files are not in a `lib/` sub-directory: the repository's root `.gitignore` has a
> blanket **`lib/`** rule (line 17, inherited from the Python template), so putting them there would get
> them **silently ignored** — present on disk, invisible to `git status`.

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

# Shell-less local run: drive the whole no-port chain from a browser (Ctrl+C reclaims everything)
powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1
powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1 -Port 9000 -Open
powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1 -SkipFrontendBuild -SkipGoBuild
powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1 -EngineCmd '"C:\Python312\python.exe" -m omo.rpc'

# Release manifest (for a tagged version; also used to add the full package locally)
powershell -ExecutionPolicy Bypass -File scripts\release-manifest.ps1
powershell -ExecutionPolicy Bypass -File scripts\release-manifest.ps1 -InputDir desktop\release -OutDir dist\release
powershell -ExecutionPolicy Bypass -File scripts\release-manifest.ps1 -Verify    # check a published manifest

# Shell smoke check (must be run in a normal terminal OUTSIDE the DSH sandbox - see below)
powershell -ExecutionPolicy Bypass -File scripts\smoke-desktop.ps1
powershell -ExecutionPolicy Bypass -File scripts\smoke-desktop.ps1 -SkipBuild   # reuse existing artefacts, faster
```

Exit codes: `setup-engine` / `rpc-cli` / `smoke-desktop` / `start-local` / `release-manifest` = 0 success / 1 failure;
`build-lite` / `build-desktop` = 0 package produced / 1 build or size-gate failure / **2 staged only**
(the final packaging step was not performed, and success is not faked).

## `start-local.ps1` and `local-bridge.mjs` (shell-less debugging)

The desktop shape **listens on no port at runtime** (`docs/desktop.md` D11): Go runs `--stdio` and the
engine is a stdio child of Go. Safe, but a browser has nothing to connect to. `local-bridge.mjs` is the
adapter that closes that gap:

```
browser --HTTP--> local-bridge.mjs --stdio JSON-RPC--> Go --stdio JSON-RPC--> Python engine
```

The bridge owns the **only** listening port in the whole process tree (loopback), so this single path
verifies both "the no-port chain works" and "the UI actually runs", without building or launching
Electron. The bridge is a **debug tool**: it only talks to the child it spawned itself, binds `127.0.0.1`
by default, and its route table is a **closed whitelist** (there is no generic proxy/forward feature).

Measured locally: `/health`, `/api/meta` (`auth_mode: none`), creating a `simulate` task →
`Rs = 3.970819 Ω/sq`, `T@550nm = 0.974497`, `SE@10GHz = 33.7036` (matching the REST/engine contract),
SPA deep links and task deletion all behave; after Ctrl+C the port is free and no child process is left.

> ⚠️ The bridge sets `PYTHONUTF8=1` / `PYTHONIOENCODING=utf-8` in **its own** environment before
> spawning Go: the engine is a grandchild, so this is the only place the encoding can be set. Without it
> Python on Windows writes stderr using the ANSI code page, so the engine's UTF-8 log lines land in the
> log file as mojibake while the Go lines right next to them look fine (HANDOVER §6.38).

## `release-manifest.ps1` (release manifest)

It writes two things (to `-OutDir`, default `dist/release/`):

| File | Contents |
|---|---|
| `SHA256SUMS.txt` | `sha256sum`-compatible `<64 hex>  <file name>` (two spaces); **UTF-8 without BOM, LF only**, so Linux/macOS can run `sha256sum -c` directly |
| `omopredict-<version>.json` | Machine-readable manifest: `product` / `version` / `commit` / `generated` / per-artefact `sha256`, `size` |

- Only **direct child files** of `-InputDir` are collected (`*.json` and `SHA256SUMS.txt` excluded): a
  `release/` directory usually also holds unpacked trees such as `win-unpacked/`, which must never be
  hashed. Anything outside it needs an explicit `-Include <path>`.
- The version comes from `desktop/package.json` (falling back to `engine/pyproject.toml`), and `-Version` overrides it.
- `-Verify` compares entry by entry: a missing file or a hash mismatch fails (exit 1), so **tampering is
  always detected** (measured).
- Before writing the manifest the release job checks that the `tag` (minus the leading `v`) matches
  `desktop/package.json`'s `version`, so a package labelled vX but containing Y cannot ship.


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

- the `desktop` job runs `pnpm build` (verifying that main=ESM / preload=CJS really are produced) + type-check + vitest
  (including `desktop/src/shell/localBridge.test.ts`, which covers the debug bridge's route mapping,
  JSON-Lines client and traversal protection);
- the `packaging` job (ubuntu + `pwsh`) runs:
  1. the full `build-lite.ps1` path with a **stub shell directory** (stage → size gate → compress), whose exit code must be 0;
  2. squeezes the gate limits down to 1MB to verify that it **really does block** (exit code 1);
  3. runs `setup-engine.ps1 -SkipInstall` in an environment with no engine installed, verifying that it exits 1 and prints the "What to check" guidance
     — that is, the T8 acceptance item "no-Python error path";
  4. uses the just-built backend to run `rpc-cli.ps1`'s `ping` (must get `"status":"ok"`) and an unknown method
     (must return `-32601`) — the debugging tool also needs someone to verify it;
  5. copies `start-local.ps1` into an empty directory to prove its failure path is actionable (exit 1 plus a
     "What to check" block) without needing pnpm, Go or Electron;
  6. round-trips `release-manifest.ps1`: generate → `-Verify` must pass → tamper with one byte → `-Verify`
     must fail. A gate nobody exercises is not a gate.
- the `release` job runs **on `v*` tags only** (`if: startsWith(github.ref, 'refs/tags/v')`) and:
  1. refuses to continue if the tag does not match `desktop/package.json`'s `version`;
  2. builds the lightweight package for real (the renderer is genuinely built; only the Electron shell
     directory is a stand-in, because electron-builder needs the Windows target);
  3. generates the SHA256 manifest and verifies it against its own artefacts before publishing;
  4. creates the GitHub Release via `gh release create`, attaching the zip, `SHA256SUMS.txt` and the JSON
     manifest;
  5. writes a run summary stating that the **full** desktop package (`build-desktop.ps1`, which needs
     electron-builder) still has to be built on a local Windows machine and attached by hand, and that the
     manifest should be regenerated afterwards so its hash is covered.

