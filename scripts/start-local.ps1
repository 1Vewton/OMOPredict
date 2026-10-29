<#
OMOPredict - start the whole stack locally, no Electron shell (docs/desktop.md T9).

This is the "debug the app in a browser" entry point. It drives the SAME no-port process tree the
desktop shell uses, and adds the one thing a browser needs - an HTTP origin:

  browser --HTTP--> local-bridge --stdio JSON-RPC--> Go --stdio JSON-RPC--> Python engine

Nothing in the chain listens on a port except the bridge (loopback only). That makes this script
the fastest way to check the stdio protocol path end to end, and the way to see the UI without
building or launching Electron.

Usage
  powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1
  powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1 -Port 9000 -Open
  powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1 -SkipFrontendBuild -SkipGoBuild
  powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1 -QuitAfterReady   # readiness gate

Running unattended
  In an interactive terminal it serves until Ctrl+C. When stdin is redirected (CI, a pipe, a
  scheduler) there is nobody to press Ctrl+C, so readiness itself becomes the success signal:
  it verifies /health, shuts the tree down and exits 0. Pass -KeepRunning to serve anyway, or
  -QuitAfterReady to force the gate in a terminal. That is also the smoke test for this script.

Exit codes
  0 = served and shut down cleanly (Ctrl+C), OR the readiness gate passed (-QuitAfterReady /
      redirected stdin)
  1 = setup/startup failure or the readiness gate failed (missing engine, port taken,
      renderer not built, bridge died, /health never answered)

NOTE: comments in this file are ASCII on purpose (docs/HANDOVER.md 6.19).
#>
[CmdletBinding()]
param(
    [int] $Port = 8787,
    [string] $DataDir = '',
    [string] $EngineCmd = '',
    [string] $Python = '',
    [string] $BackendExe = '',
    [switch] $SkipFrontendBuild,
    [switch] $SkipGoBuild,
    [switch] $Open,
    [int] $ReadyTimeoutSec = 120,
    # Readiness-gate mode for CI/smoke: bring everything up, verify /health, shut down, exit 0/1.
    # Implied automatically when stdin is redirected (see "Running unattended" in the header).
    [switch] $QuitAfterReady,
    # Force the "keep serving" behaviour even with redirected stdin.
    [switch] $KeepRunning
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$frontendDir = Join-Path $repoRoot 'frontend'
$distDir = Join-Path $frontendDir 'dist'
$serverDir = Join-Path $repoRoot 'server'
$bridgeJs = Join-Path $repoRoot 'scripts/local-bridge.mjs'

function Fail {
    param([string] $Message, [string[]] $Hints = @())
    Write-Host ''
    Write-Host ("[start-local] " + $Message) -ForegroundColor Red
    if ($Hints.Count -gt 0) {
        Write-Host ''
        Write-Host 'What to check:'
        foreach ($hint in $Hints) { Write-Host ("  - " + $hint) }
    }
    exit 1
}

# Print the tail of a bridge log; silently no-op when the file is absent (never mask the
# original failure with a logging error).
function Show-LogTail {
    param([string] $Path, [int] $Lines = 25)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $tail = @(Get-Content -LiteralPath $Path -Encoding UTF8 | Where-Object { $_.Trim().Length -gt 0 })
    if ($tail.Count -eq 0) { return }
    Write-Host ("--- " + (Split-Path -Leaf $Path) + " ---")
    $tail | Select-Object -Last $Lines | ForEach-Object { Write-Host $_ }
}

function Test-PortFree {    param([int] $Candidate)
    # Listen on loopback only, so we test exactly what the bridge will bind.
    try {
        $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Candidate)
        $listener.Start()
        $listener.Stop()
        return $true
    }
    catch {
        return $false
    }
}

Write-Host '=== OMOPredict local debug (no shell, no ports except the bridge) ==='
Write-Host ''

# ---- [1/5] renderer ---------------------------------------------------------
Write-Host '[1/5] renderer (frontend/dist)'
if ($SkipFrontendBuild) {
    Write-Host '      skipped (-SkipFrontendBuild)'
}
else {
    Push-Location $frontendDir
    try {
        & pnpm build
        if ($LASTEXITCODE -ne 0) { Fail "pnpm build failed (exit $LASTEXITCODE)" @('run "cd frontend; pnpm install" first') }
    }
    catch {
        Fail ("could not build the renderer: " + $_.Exception.Message) @(
            'pnpm must be on PATH',
            'run "cd frontend; pnpm install" first',
            'or pass -SkipFrontendBuild if frontend/dist is already current'
        )
    }
    finally { Pop-Location }
}
if (-not (Test-Path -LiteralPath (Join-Path $distDir 'index.html'))) {
    Fail "renderer not built: $distDir\index.html is missing" @(
        'drop -SkipFrontendBuild, or run "cd frontend; pnpm build"'
    )
}

# ---- [2/5] Go backend -------------------------------------------------------
# Reuse an existing build unless it is stale: this script is meant to be run often.
Write-Host '[2/5] Go backend'
$builtBackend = Join-Path $serverDir 'omopredict.exe'
if (-not (Test-Path -LiteralPath $builtBackend)) { $builtBackend = Join-Path $serverDir 'omopredict' }

$backendPath = ''
if ($BackendExe -ne '') {
    if (-not (Test-Path -LiteralPath $BackendExe)) { Fail "backend executable not found: $BackendExe" }
    $backendPath = (Resolve-Path -LiteralPath $BackendExe).Path
    Write-Host ("      using -BackendExe: {0}" -f $backendPath)
}
elseif ($SkipGoBuild) {
    if (-not (Test-Path -LiteralPath $builtBackend)) {
        Fail "no backend binary and -SkipGoBuild was given" @(
            'run "cd server; go build -o omopredict.exe ./cmd/omopredict" first',
            'or drop -SkipGoBuild'
        )
    }
    $backendPath = (Resolve-Path -LiteralPath $builtBackend).Path
    Write-Host ("      skipped build: {0}" -f $backendPath)
}
else {
    $stale = $true
    if (Test-Path -LiteralPath $builtBackend) {
        # Stale = any .go file newer than the binary (avoids a rebuild on every start).
        $builtAt = (Get-Item -LiteralPath $builtBackend).LastWriteTime
        $newer = @(Get-ChildItem -LiteralPath $serverDir -Recurse -File -Filter *.go |
            Where-Object { $_.LastWriteTime -gt $builtAt })
        $stale = $newer.Count -gt 0
        if (-not $stale) { Write-Host ("      up to date: {0}" -f $builtBackend) }
    }
    if ($stale) {
        Push-Location $serverDir
        try {
            $env:CGO_ENABLED = '0'   # glebarez/sqlite is pure Go
            & go build -o $builtBackend ./cmd/omopredict
            if ($LASTEXITCODE -ne 0) {
                Fail "go build failed (exit $LASTEXITCODE)" @('go must be on PATH (see server/README.md)')
            }
        }
        catch { Fail ("go build failed: " + $_.Exception.Message) @('go must be on PATH') }
        finally { Pop-Location }
    }
    if (-not (Test-Path -LiteralPath $builtBackend)) {
        Fail "backend build produced nothing at $builtBackend" @('run "cd server; go build ./cmd/omopredict"')
    }
    $backendPath = (Resolve-Path -LiteralPath $builtBackend).Path
}

# ---- [3/5] engine -----------------------------------------------------------
Write-Host '[3/5] engine'
$enginePath = ''
if ($EngineCmd -ne '') {
    $enginePath = $EngineCmd
    Write-Host ("      explicit: {0}" -f $enginePath)
}
else {
    $candidates = @()
    if ($Python -ne '') { $candidates += $Python }
    $venvPython = Join-Path $repoRoot 'engine/.venv/Scripts/python.exe'
    $venvPythonPosix = Join-Path $repoRoot 'engine/.venv/bin/python'
    if (Test-Path -LiteralPath $venvPython) { $candidates += $venvPython }
    if (Test-Path -LiteralPath $venvPythonPosix) { $candidates += $venvPythonPosix }
    foreach ($name in @('python', 'python3', 'py')) {
        $found = Get-Command $name -ErrorAction SilentlyContinue
        if ($null -ne $found) { $candidates += $found.Source }
    }
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) { $enginePath = $candidate; break }
    }
    if ($enginePath -eq '') {
        Fail 'no Python interpreter found for the engine' @(
            'install Python >= 3.12, or run "cd engine; uv sync" to create engine/.venv',
            'or pass -EngineCmd "<python> -m omo.rpc"'
        )
    }
    Write-Host ("      interpreter: {0}" -f $enginePath)
}

# ---- [4/5] port + bridge ----------------------------------------------------
Write-Host '[4/5] local bridge'
if (-not (Test-PortFree -Candidate $Port)) {
    Fail "port $Port is already in use" @(
        "pass -Port <other> (e.g. -Port 8899)",
        'or stop whatever is holding the port'
    )
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail 'node is not on PATH (the bridge is plain Node)' @('install Node.js 20+ (see desktop/README.md)')
}
if (-not (Test-Path -LiteralPath $bridgeJs)) { Fail "bridge script missing: $bridgeJs" }

if ($DataDir -eq '') { $DataDir = Join-Path $repoRoot '.scratch/start-local' }
# SQLite never creates the parent directory; a missing one shows up as a misleading
# "unable to open database file" (HANDOVER 6.23).
if (-not (Test-Path -LiteralPath $DataDir)) {
    $null = New-Item -ItemType Directory -Force -Path $DataDir -ErrorAction SilentlyContinue
}
if (-not (Test-Path -LiteralPath $DataDir)) { Fail "could not create data directory: $DataDir" }
$DataDir = (Resolve-Path -LiteralPath $DataDir).Path
Write-Host ("      data: {0}" -f $DataDir)

# Paths and the engine command are handed over through ENVIRONMENT VARIABLES, not argv.
#
# Why: Start-Process re-parses its -ArgumentList string, so a value that itself contains quotes
# (an engine command like '"C:\...\python.exe" -m omo.rpc', or a path with spaces) gets split and
# its inner quotes are consumed. That silently turned the engine command into a bare interpreter
# path, which then failed with "ping response timeout" 60s later - a very confusing symptom.
# Environment variables are passed through untouched, and Go already reads OMO_ENGINE_CMD, so
# this is also the same variable the shell and rpc-cli use.
$env:OMO_ENGINE_CMD = if ($EngineCmd -ne '') { $EngineCmd } else { '"{0}" -m omo.rpc' -f (Resolve-Path -LiteralPath $enginePath).Path }
$savedBackendOverride = $env:OMO_BACKEND_EXE
$savedDistOverride = $env:OMO_DIST_DIR
$env:OMO_BACKEND_EXE = $backendPath
$env:OMO_DIST_DIR = $distDir

$bridgeArgs = @(
    $bridgeJs,
    '--data-dir', $DataDir,
    '--port', "$Port",
    '--cwd', $repoRoot
)

$logFile = Join-Path $DataDir 'bridge.log'
# Start-Process refuses identical stdout/stderr targets, so keep two files and tail both.
$stdoutLog = Join-Path $DataDir 'bridge.stdout.log'
$stderrLog = Join-Path $DataDir 'bridge.stderr.log'
$nodeExe = (Get-Command node).Source
# Run node directly (no extra pwsh hop): the process we hold is then the top of the real tree,
# so tree-kill below reaches the backend and the engine.
$child = Start-Process -FilePath $nodeExe -PassThru `
    -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog `
    -ArgumentList $bridgeArgs

# Drop the hand-off variables again: the child inherited them, and leaving them set would make a
# later run (or another tool in this session) pick up a stale engine command or paths.
Remove-Item Env:\OMO_BACKEND_EXE -ErrorAction SilentlyContinue
Remove-Item Env:\OMO_DIST_DIR -ErrorAction SilentlyContinue
Remove-Item Env:\OMO_ENGINE_CMD -ErrorAction SilentlyContinue
if ($null -ne $savedBackendOverride) { $env:OMO_BACKEND_EXE = $savedBackendOverride }
if ($null -ne $savedDistOverride) { $env:OMO_DIST_DIR = $savedDistOverride }

# End-to-end readiness: GET /health only proves the Go backend answers - Go replies to `ping`
# ITSELF, and the engine is spawned lazily on the first real task. So a broken engine still passes
# a /health check (docs/HANDOVER.md section 7: Go spawns the engine lazily, so failures only show
# up once a task actually runs).
# To prove the whole chain, submit one tiny simulate task and wait for it to finish.
function Test-EngineRoundTrip {
    param([string] $BaseUrl, [int] $TimeoutSec = 120)
    $payload = @{
        kind   = 'simulate'
        name   = 'start-local readiness probe'
        layers = @(
            @{ material = 'ITO'; thickness_nm = 40 },
            @{ material = 'Ag'; thickness_nm = 10 },
            @{ material = 'ITO'; thickness_nm = 40 }
        )
    } | ConvertTo-Json -Depth 5 -Compress

    try {
        $created = Invoke-RestMethod -Uri ($BaseUrl + 'api/tasks') -Method Post `
            -ContentType 'application/json' -Body $payload -TimeoutSec 10
    }
    catch {
        return @{ ok = $false; reason = "could not create a task: $($_.Exception.Message)" }
    }

    $taskId = $created.id
    if (-not $taskId) { return @{ ok = $false; reason = 'task creation returned no id' } }

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 400
        try {
            $task = Invoke-RestMethod -Uri ($BaseUrl + "api/tasks/$taskId") -TimeoutSec 10
        }
        catch {
            return @{ ok = $false; reason = "could not poll the task: $($_.Exception.Message)" }
        }
        if ($task.status -eq 'succeeded') {
            $rs = $task.result.sheet_resistance
            return @{ ok = $true; reason = ("engine answered (Rs={0} ohm/sq)" -f $rs) }
        }
        if ($task.status -eq 'failed') {
            # The backend surfaces the engine failure here, which is the actionable message.
            return @{ ok = $false; reason = 'the engine failed: ' + $task.error }
        }
    }
    return @{ ok = $false; reason = "the task did not finish within $TimeoutSec s" }
}

$url = "http://127.0.0.1:$Port/"
$stopped = $false
try {
    # ---- [5/5] wait for readiness ------------------------------------------
    Write-Host '[5/5] waiting for readiness'
    $deadline = (Get-Date).AddSeconds($ReadyTimeoutSec)
    $ready = $false
    while ((Get-Date) -lt $deadline) {
        if ($null -ne $child -and $child.HasExited) { break }
        try {
            $resp = Invoke-WebRequest -Uri ($url + 'health') -UseBasicParsing -TimeoutSec 3
            if ($resp.StatusCode -eq 200) { $ready = $true; break }
        }
        catch { Start-Sleep -Milliseconds 400 }
    }

    if (-not $ready) {
        Write-Host ''
        Write-Host '[start-local] the bridge never became ready. Its log follows:' -ForegroundColor Red
        Show-LogTail -Path $stderrLog -Lines 40
        Show-LogTail -Path $stdoutLog -Lines 10
        Fail 'startup failed' @(
            'the log above usually names the culprit (missing engine, bad -EngineCmd, port race)',
            'try -EngineCmd "<python> -m omo.rpc" with an explicit interpreter'
        )
    }

    Write-Host ''
    Write-Host '=== ready ===' -ForegroundColor Green
    Write-Host ("  open:  {0}" -f $url)
    Write-Host ("  log:   {0}" -f $stderrLog)
    Write-Host '  auth:  none (single-user local mode; no login required)'
    Write-Host '  stop:  Ctrl+C here, or close this window'
    Write-Host ''

    if ($Open) {
        Start-Process $url | Out-Null
    }

    # Decide whether to keep serving after readiness.
    #
    # Interactive terminal -> serve until Ctrl+C (the documented behaviour).
    # Redirected stdin     -> do NOT spin forever: an unattended caller (CI, a pipe, a scheduler)
    #                         has no way to press Ctrl+C, so before this change the script hung
    #                         until the job timed out. Readiness itself becomes the success signal.
    # Both can be overridden explicitly, so the decision is never silent.
    $nonInteractive = [Console]::IsInputRedirected
    $keepServing = $KeepRunning.IsPresent -or -not ($QuitAfterReady.IsPresent -or $nonInteractive)

    if ($keepServing) {
        if ($nonInteractive) {
            Write-Host '[start-local] stdin is redirected but -KeepRunning was given: serving until killed.' -ForegroundColor Yellow
        }
        while ($true) {
            $child.Refresh()
            if ($child.HasExited) {
                Write-Host ''
                Write-Host ("[start-local] the bridge exited (code " + $child.ExitCode + "). Log tail:") -ForegroundColor Red
                Show-LogTail -Path $stderrLog -Lines 25
                exit 1
            }
            Start-Sleep -Milliseconds 500
        }
    }

    # Readiness gate. /health alone is NOT enough (see Test-EngineRoundTrip): prove the engine
    # actually answers by running one tiny simulation before reporting success.
    $why = if ($QuitAfterReady.IsPresent) { '-QuitAfterReady' } else { 'stdin redirected' }
    Write-Host ("[start-local] readiness gate ({0}): checking the engine, not just the backend..." -f $why)
    $probe = Test-EngineRoundTrip -BaseUrl $url -TimeoutSec $ReadyTimeoutSec
    if (-not $probe.ok) {
        Write-Host ''
        Write-Host ('[start-local] readiness gate FAILED: ' + $probe.reason) -ForegroundColor Red
        Show-LogTail -Path $stderrLog -Lines 40
        Fail 'the engine is not usable, so this stack would look ready but fail every task' @(
            'check the interpreter / command passed to -Python / -EngineCmd',
            'run "cd engine; uv sync --all-extras" if the engine dependencies are missing',
            'the engine error above is the exact message the backend reported'
        )
    }

    Write-Host ''
    Write-Host ("=== readiness gate passed ({0}) ===" -f $why) -ForegroundColor Green
    Write-Host ('  ' + $probe.reason)
    Write-Host '  shutting the stack down and exiting 0 (that is also the smoke test for this script)'
    Write-Host ''
    # Leave via the finally block so the bridge/backend tree is reclaimed exactly like Ctrl+C.
    exit 0
}
finally {    if (-not $stopped -and $null -ne $child) {
        $child.Refresh()
        if (-not $child.HasExited) {
            Write-Host ''
            Write-Host '[start-local] stopping the bridge and the backend...'
            # Force-kill the tree is the only reliable stop here: this script does not redirect the
            # child's stdin, so there is no pipe we could close to make the bridge exit on EOF
            # (its graceful path is stdin EOF or SIGINT). Nothing of value is lost - the bridge
            # writes its log synchronously to a file, so the log stays complete.
            # /T kills the whole tree (node -> Go -> engine); plain Kill() would orphan them.
            if ($env:OS -eq 'Windows_NT') {
                & taskkill /PID $child.Id /T /F 2>&1 | Out-Null
            }
            else {
                try { $child.Kill() } catch { }
            }
        }
        $stopped = $true
    }
}
