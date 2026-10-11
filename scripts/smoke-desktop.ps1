<#
OMOPredict - desktop shell smoke check (T11 helper).

Decides, in one command, whether the Electron shell actually starts and renders:
  * renderer loaded  -> prints "[smoke] OK" and exits 0
  * load failed / timeout -> prints the reason and exits 1

Run this OUTSIDE the DSH sandbox (a normal PowerShell window). Inside the sandbox Electron's
browser process cannot start at all (see docs/HANDOVER.md 6.31), so this script would just
report the sandbox crash.

Usage
  powershell -ExecutionPolicy Bypass -File scripts\smoke-desktop.ps1
  powershell -ExecutionPolicy Bypass -File scripts\smoke-desktop.ps1 -SkipBuild     # use what is already built
  powershell -ExecutionPolicy Bypass -File scripts\smoke-desktop.ps1 -TimeoutMs 90000

Exit codes
  0 = shell started and the renderer loaded
  1 = build problem, or the shell failed / timed out (reason is printed)

NOTE: comments in this file are ASCII on purpose (docs/HANDOVER.md 6.19).
#>
[CmdletBinding()]
param(
    [int] $TimeoutMs = 60000,
    [switch] $SkipBuild
)

$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$desktop = Join-Path $repo 'desktop'
$electron = Join-Path $desktop 'node_modules/electron/dist/electron.exe'

# Detect the DSH harness environment UP FRONT. Inside it Electron cannot start (HANDOVER 6.31), and
# the symptom (0x80000003, no output) is identical to a real failure - which is very confusing, so
# say it here instead of letting the user puzzle over the verdict at the end.
$inHarness = ($env:ELECTRON_RUN_AS_NODE -ne '') -or [bool](Get-ChildItem Env:DSH_* -ErrorAction SilentlyContinue)
if ($inHarness) {
    Write-Warning 'You appear to be INSIDE the DSH harness environment'
    Write-Warning ("  ELECTRON_RUN_AS_NODE='" + $env:ELECTRON_RUN_AS_NODE + "', DSH_* variables present")
    Write-Warning 'Electron cannot start here, so the first attempt WILL fail with 0x80000003 (expected).'
    Write-Warning 'The script then retries with the sandbox disabled and workspace-local data dirs, which'
    Write-Warning 'does work here. On a normal desktop just run this from the Start menu instead.'
    # The harness denies mkdir outside the workspace, so point the app's data dir at the workspace
    # too (otherwise Host startup fails with EPERM and the app exits before rendering).
    $localRedirect = Join-Path $repo '.smoke/localappdata'
    New-Item -ItemType Directory -Force -Path $localRedirect | Out-Null
    $env:LOCALAPPDATA = $localRedirect
    Write-Warning ("  LOCALAPPDATA redirected to " + $localRedirect)
    Write-Host ''
}

Write-Host '[1/5] Electron binary'
if (-not (Test-Path -LiteralPath $electron)) {
    Write-Host '      missing - downloading it now (about 115 MB, a few minutes)'
    Push-Location $desktop
    try {
        # Use the DEFAULT source: npmmirror times out on some machines, GitHub works (HANDOVER 6.33).
        Remove-Item Env:ELECTRON_MIRROR -ErrorAction SilentlyContinue
        & node 'node_modules/electron/install.js'
        if ($LASTEXITCODE -ne 0) { throw "electron download failed (exit $LASTEXITCODE)" }
    }
    finally { Pop-Location }
}
Write-Host ("      ok: " + (Get-Content (Join-Path $desktop 'node_modules/electron/dist/version') -ErrorAction SilentlyContinue))

# ELECTRON_RUN_AS_NODE makes electron.exe behave as plain Node, which breaks everything in a very
# confusing way (HANDOVER 6.32). Clear it before launching.
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Write-Host '      ELECTRON_RUN_AS_NODE cleared'

Write-Host '[2/5] renderer bundle'
$distIndex = Join-Path $repo 'frontend/dist/index.html'
if ((-not $SkipBuild) -or (-not (Test-Path -LiteralPath $distIndex))) {
    Push-Location (Join-Path $repo 'frontend')
    try {
        & pnpm build
        if ($LASTEXITCODE -ne 0) { throw "frontend build failed (exit $LASTEXITCODE)" }
    }
    finally { Pop-Location }
}
if (-not (Test-Path -LiteralPath $distIndex)) { throw "renderer missing: $distIndex" }

Write-Host '[3/5] Go backend'
$backend = Join-Path $repo 'server/omopredict.exe'
if (-not $SkipBuild) {
    Push-Location (Join-Path $repo 'server')
    try {
        $env:CGO_ENABLED = '0'
        & go build -o $backend './cmd/omopredict'
        if ($LASTEXITCODE -ne 0) { throw "go build failed (exit $LASTEXITCODE)" }
    }
    finally { Pop-Location }
}
if (-not (Test-Path -LiteralPath $backend)) {
    throw "backend missing: $backend (run without -SkipBuild, or build it manually)"
}

Write-Host '[4/5] shell TypeScript (main = CJS, preload = bundled single file)'
if (-not $SkipBuild) {
    Push-Location $desktop
    try {
        # pnpm 11 aborts in a non-TTY environment when it wants to rebuild node_modules; CI=true lets it continue
        $env:CI = 'true'
        & pnpm build
        if ($LASTEXITCODE -ne 0) { throw "shell build failed (exit $LASTEXITCODE)" }
    }
    finally { Pop-Location }
}
# main and preload are both CommonJS, so each output dir gets a package.json declaring the type
Set-Content -LiteralPath (Join-Path $desktop 'dist/main/package.json') -Value '{ "type": "commonjs" }' -Encoding ASCII
Set-Content -LiteralPath (Join-Path $desktop 'dist/preload/package.json') -Value '{ "type": "commonjs" }' -Encoding ASCII
$mainJs = Join-Path $desktop 'dist/main/main.js'
if (-not (Test-Path -LiteralPath $mainJs)) { throw "shell main missing: $mainJs" }

Write-Host '[5/5] launching the shell (a window may appear, then close by itself)'
$env:OMO_BACKEND_EXE = $backend
$env:OMO_DESKTOP_SMOKE_MS = [string]$TimeoutMs
# Pin the engine interpreter when the repo venv exists, so discovery cannot pick a stray python.
$enginePython = Join-Path $repo 'engine/.venv/Scripts/python.exe'
if (Test-Path -LiteralPath $enginePython) {
    $env:OMO_ENGINE_CMD = '"' + $enginePython + '" -m omo.rpc'
}

$outLog = Join-Path $env:TEMP 'omopredict-smoke-out.log'
$errLog = Join-Path $env:TEMP 'omopredict-smoke-err.log'

# Run the shell. If it dies with a native crash code before any of our JS runs (0x80000003 /
# 0xC0000005), that is Chromium's own process sandbox failing to initialise on this machine
# (docs/HANDOVER.md 6.31) - retry once with the sandbox disabled so the app is still verifiable.
# On a healthy machine the first attempt just succeeds and nothing here changes.
function Invoke-ShellAttempt {
    param([switch] $DisableSandbox, [string] $UserDataDir)
    Remove-Item $outLog, $errLog -ErrorAction SilentlyContinue
    if ($DisableSandbox) { $env:ELECTRON_DISABLE_SANDBOX = '1' } else { Remove-Item Env:ELECTRON_DISABLE_SANDBOX -ErrorAction SilentlyContinue }
    $argv = @('.')
    if ($UserDataDir) { $argv += ("--user-data-dir=" + $UserDataDir) }
    Push-Location $desktop
    try {
        $proc = Start-Process -FilePath $electron -ArgumentList $argv -PassThru -Wait `
            -RedirectStandardOutput $outLog -RedirectStandardError $errLog
        $proc.Refresh()
        return $proc.ExitCode
    }
    finally { Pop-Location }
}

$code = Invoke-ShellAttempt
$out = @(Get-Content $outLog -ErrorAction SilentlyContinue)
$usedFallback = $false
if ($code -lt 0 -and ($out -join "`n") -notmatch '\[smoke\]') {
    Write-Host ''
    Write-Host ("      attempt 1 died before our code ran (exit $code) - retrying with the sandbox disabled")
    $usedFallback = $true
    # Chromium also refuses to create the user-data directory itself on such machines, so hand it one
    $fallbackProfile = Join-Path $repo '.smoke/profile'
    New-Item -ItemType Directory -Force -Path $fallbackProfile | Out-Null
    $code = Invoke-ShellAttempt -DisableSandbox -UserDataDir $fallbackProfile
}
Remove-Item Env:ELECTRON_DISABLE_SANDBOX -ErrorAction SilentlyContinue

Write-Host ''
Write-Host '--- shell output ---'
$out = @(Get-Content $outLog -ErrorAction SilentlyContinue)
if ($out.Count -eq 0) { Write-Host '(no stdout)' } else { $out | ForEach-Object { Write-Host $_ } }
$err = @(Get-Content $errLog -ErrorAction SilentlyContinue)
if ($err.Count -gt 0) {
    Write-Host '--- shell stderr ---'
    $err | ForEach-Object { Write-Host $_ }
}

Write-Host ''
Write-Host '=== VERDICT ==='
Write-Host ("exit code: " + $code)
$bridgeOk = ($out -join "`n") -match '\[smoke\] BRIDGE OK'
$renderOk = ($out -join "`n") -match '\[smoke\] OK'
if ($code -eq 0 -and $bridgeOk) {
    Write-Host 'PASS: renderer loaded app://omo/index.html AND window.omo.rpc() answered'
    Write-Host '      (preload injected, IPC bridge -> Host -> Go backend -> engine all verified)'
    if ($usedFallback) {
        Write-Host 'NOTE: this machine needed ELECTRON_DISABLE_SANDBOX=1 and a pre-created --user-data-dir,'
        Write-Host '      because Chromium cannot initialise its process sandbox / profile here'
        Write-Host '      (docs/HANDOVER.md 6.31/6.35). On a healthy machine attempt 1 succeeds without them.'
    }
    exit 0
}
if ($code -eq 0 -and $renderOk) {
    Write-Host 'PARTIAL: the renderer loaded, but the IPC bridge did not answer'
    Write-Host '         (preload missing or window.omo not injected - see the BRIDGE FAIL line above)'
    exit 1
}
Write-Host 'FAIL: the shell did not render. The reason is in the output above.'
if ($code -lt 0) {
    # Native crash codes: 0xC0000005 (access violation) / 0x80000003 (breakpoint). Seen when Chromium's
    # sandbox cannot start, or when its user-data directory cannot be created (HANDOVER 6.31/6.35).
    $hex = '0x{0:X8}' -f ([int64]$code -band 0xFFFFFFFFL)
    Write-Host ("hint: exit code $code ($hex) is a native crash that happened before our code ran, so it is a")
    Write-Host '      Chromium startup problem, not an OMOPredict bug. Check docs/HANDOVER.md 6.35.'
}
Write-Host 'Please send that output back for diagnosis.'
exit 1
