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

Write-Host '[4/5] shell TypeScript (main = ESM, preload = CJS)'
if (-not $SkipBuild) {
    Push-Location $desktop
    try {
        & pnpm build
        if ($LASTEXITCODE -ne 0) { throw "shell build failed (exit $LASTEXITCODE)" }
    }
    finally { Pop-Location }
}
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
Remove-Item $outLog, $errLog -ErrorAction SilentlyContinue

Push-Location $desktop
try {
    $proc = Start-Process -FilePath $electron -ArgumentList '.' -PassThru -Wait `
        -RedirectStandardOutput $outLog -RedirectStandardError $errLog
    $proc.Refresh()
    $code = $proc.ExitCode
}
finally { Pop-Location }

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
if ($code -eq 0 -and ($out -match '\[smoke\] OK')) {
    Write-Host 'PASS: the shell started and rendered app://omo/index.html'
    exit 0
}
Write-Host 'FAIL: the shell did not render. The reason is in the output above.'
if ($code -lt 0) {
    # Native crash codes look like this: 0xC0000005 (access violation) or 0x80000003 (breakpoint),
    # which is what Electron does when the DSH sandbox blocks Chromium startup (HANDOVER 6.31).
    $hex = '0x{0:X8}' -f ([int64]$code -band 0xFFFFFFFFL)
    Write-Host ("hint: exit code $code ($hex) is a native crash. If you ran this INSIDE the DSH sandbox,")
    Write-Host '      that is expected - Electron cannot start there (docs/HANDOVER.md 6.31). Re-run it in a'
    Write-Host '      normal PowerShell window on the desktop.'
}
Write-Host 'Please send that output back for diagnosis.'
exit 1
