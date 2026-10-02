<#
OMOPredict - build the FULL desktop package (bundled engine, nothing to install).

Pipeline (docs/desktop.md section 7):
  [1] renderer      pnpm build                                    -> frontend/dist
  [2] go backend    go build (CGO_ENABLED=0)                      -> desktop/release-bin/omopredict-server.exe
  [3] engine        uv run --with pyinstaller pyinstaller --onedir -> desktop/release-bin/engine/omo-rpc
  [4] shell TS      tsc build:main (ESM) + build:preload (CJS)     -> desktop/dist/{main,preload}
  [5] packaging     electron-builder (nsis + zip)                 -> desktop/release/
  [6] size gates    engine dir + app payload + distributables

The lightweight package (scripts/build-lite.ps1) shares [1] [2] [4] and swaps the bundled engine
for the engine SOURCE plus setup-engine.ps1.

Usage
  powershell -ExecutionPolicy Bypass -File scripts\build-desktop.ps1
  powershell -ExecutionPolicy Bypass -File scripts\build-desktop.ps1 -SkipPackaging   # steps 1-4 + gates
  powershell -ExecutionPolicy Bypass -File scripts\build-desktop.ps1 -SkipEngineBundle

Exit codes
  0 = package produced
  1 = failure (build error or size gate violated)
  2 = staging only: electron-builder skipped (-SkipPackaging), no distributable produced

Size gates (see the note below - two of these are measured, not guessed)
  engine dir   <= 250 MB : the PyInstaller onedir tree. Measured 2026-09: 165.6 MB for
                           numpy + scipy, with zero torch/fastapi/uvicorn/matplotlib entries.
  app payload  <=  50 MB : Go backend + renderer + shell JS (what we control; catches dependency bloat).
  distributable<= 300 MB : the zip / nsis installer that actually ships.

NOTE: comments in this file are ASCII on purpose (docs/HANDOVER.md 6.19).
#>
[CmdletBinding()]
param(
    [string] $OutDir = '',
    [switch] $SkipFrontendBuild,
    [switch] $SkipGoBuild,
    [switch] $SkipEngineBundle,
    [switch] $SkipShellBuild,
    [switch] $SkipPackaging,
    [double] $EngineLimitMB = 250,
    [double] $PayloadLimitMB = 50,
    [double] $DistributableLimitMB = 300
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$desktopDir = Join-Path $repoRoot 'desktop'
if ($OutDir -eq '') { $OutDir = Join-Path $desktopDir 'release' }
$releaseBin = Join-Path $desktopDir 'release-bin'

$desktopPkg = Get-Content -LiteralPath (Join-Path $desktopDir 'package.json') -Raw -Encoding UTF8 |
    ConvertFrom-Json
$version = $desktopPkg.version

function Get-DirectorySizeMB {
    param([string] $Path)
    if (-not (Test-Path -LiteralPath $Path)) { return 0 }
    $sum = (Get-ChildItem -LiteralPath $Path -Recurse -File -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum).Sum
    if ($null -eq $sum) { return 0 }
    return [math]::Round($sum / 1MB, 2)
}

function Get-FileSizeMB {
    param([string] $Path)
    if (-not (Test-Path -LiteralPath $Path)) { return 0 }
    return [math]::Round((Get-Item -LiteralPath $Path).Length / 1MB, 2)
}

function Assert-SizeGate {
    param([string] $Label, [double] $ActualMB, [double] $LimitMB)
    Write-Host ("      {0}: {1} MB (limit {2} MB)" -f $Label, $ActualMB, $LimitMB)
    if ($ActualMB -gt $LimitMB) {
        throw ("Size gate failed: {0} is {1} MB, over the {2} MB limit. " -f $Label, $ActualMB, $LimitMB) +
            'If a bundled engine grew, check that torch / fastapi / matplotlib did not sneak in ' +
            '(they are excluded explicitly). Raise the limit only on purpose.'
    }
}

Write-Host '[1/6] renderer'
if ($SkipFrontendBuild) {
    Write-Host '      skipped (-SkipFrontendBuild)'
}
else {
    Push-Location (Join-Path $repoRoot 'frontend')
    try {
        & pnpm build
        if ($LASTEXITCODE -ne 0) { throw "pnpm build failed (exit $LASTEXITCODE)" }
    }
    finally { Pop-Location }
}
$distDir = Join-Path $repoRoot 'frontend/dist'
if (-not (Test-Path -LiteralPath (Join-Path $distDir 'index.html'))) {
    throw "renderer not built: $distDir\index.html missing (drop -SkipFrontendBuild)"
}

Write-Host '[2/6] Go backend'
New-Item -ItemType Directory -Force -Path $releaseBin, $OutDir | Out-Null
$backendExe = Join-Path $releaseBin 'omopredict-server.exe'
if ($SkipGoBuild) {
    Write-Host '      skipped (-SkipGoBuild)'
}
else {
    Push-Location (Join-Path $repoRoot 'server')
    try {
        $env:CGO_ENABLED = '0'   # glebarez/sqlite is pure Go
        & go build -o $backendExe ./cmd/omopredict
        if ($LASTEXITCODE -ne 0) { throw "go build failed (exit $LASTEXITCODE)" }
    }
    finally { Pop-Location }
}
if (-not (Test-Path -LiteralPath $backendExe)) { throw "backend not built: $backendExe missing" }

Write-Host '[3/6] engine sidecar (PyInstaller onedir)'
# --distpath $releaseBin yields $releaseBin/omo-rpc/{omo-rpc.exe,_internal}. electron-builder maps
# release-bin/omo-rpc -> resources/engine, so the exe ends up at resources/engine/omo-rpc.exe, which
# is exactly where the Go resolver looks (server/internal/task/engine_resolve.go findSidecar).
$engineTree = Join-Path $releaseBin 'omo-rpc'
if ($SkipEngineBundle) {
    Write-Host '      skipped (-SkipEngineBundle)'
}
else {
    $uv = Get-Command uv -ErrorAction SilentlyContinue
    if ($null -eq $uv) { throw 'uv is required to build the engine sidecar (https://docs.astral.sh/uv/).' }
    # --with pyinstaller keeps pyinstaller OUT of the project's dependency list (no uv.lock churn),
    # while still running PyInstaller inside the engine environment so numpy/scipy are discoverable.
    Push-Location (Join-Path $repoRoot 'engine')
    try {
        & $uv.Source run --project (Join-Path $repoRoot 'engine') --with pyinstaller -- pyinstaller `
            --noconfirm --onedir --name omo-rpc `
            --distpath $releaseBin --workpath (Join-Path $OutDir 'pyinstaller-build') `
            --specpath (Join-Path $OutDir 'pyinstaller-build') `
            --exclude-module torch --exclude-module matplotlib --exclude-module fastapi `
            --exclude-module uvicorn --exclude-module tkinter --exclude-module IPython `
            --exclude-module pytest --collect-submodules omo `
            (Join-Path $repoRoot 'engine/src/omo/rpc/__main__.py')
        if ($LASTEXITCODE -ne 0) { throw "pyinstaller failed (exit $LASTEXITCODE)" }
    }
    finally { Pop-Location }
}
$engineExe = Join-Path $engineTree 'omo-rpc.exe'
if (-not (Test-Path -LiteralPath $engineExe)) {
    Write-Warning "engine sidecar missing: $engineExe (drop -SkipEngineBundle to build it)"
}

Write-Host '[4/6] shell TypeScript (main = ESM, preload = CJS)'
if ($SkipShellBuild) {
    Write-Host '      skipped (-SkipShellBuild)'
}
else {
    Push-Location $desktopDir
    try {
        & pnpm build
        if ($LASTEXITCODE -ne 0) { throw "pnpm build failed (exit $LASTEXITCODE)" }
    }
    finally { Pop-Location }
}
$shellDist = Join-Path $desktopDir 'dist'
$mainJs = Join-Path $shellDist 'main/main.js'
$preloadDir = Join-Path $shellDist 'preload'
if (-not (Test-Path -LiteralPath $mainJs)) { throw "shell main not built: $mainJs missing" }
# Mark the preload directory as CommonJS: sandboxed preload scripts must be CJS, but this package
# is "type": "module" (see tsconfig.preload.json).
Set-Content -LiteralPath (Join-Path $preloadDir 'package.json') -Value '{ "type": "commonjs" }' -Encoding ASCII
Write-Host ("      main    : {0}" -f $mainJs)
Write-Host ("      preload : {0}" -f (Join-Path $preloadDir 'preload.js'))

Write-Host '[5/6] packaging (electron-builder)'
if ($SkipPackaging) {
    Write-Host '      skipped (-SkipPackaging)'
}
else {
    Push-Location $desktopDir
    try {
        & pnpm exec electron-builder --win nsis zip
        if ($LASTEXITCODE -ne 0) { throw "electron-builder failed (exit $LASTEXITCODE)" }
    }
    finally { Pop-Location }
}

Write-Host '[6/6] size gates'
Assert-SizeGate -Label 'engine dir' -ActualMB (Get-DirectorySizeMB $engineTree) -LimitMB $EngineLimitMB
$payloadMB = [math]::Round(
    (Get-DirectorySizeMB $distDir) +
    (Get-FileSizeMB $backendExe) +
    (Get-DirectorySizeMB $shellDist), 2)
Assert-SizeGate -Label 'app payload' -ActualMB $payloadMB -LimitMB $PayloadLimitMB

if ($SkipPackaging) {
    Write-Host ''
    Write-Host ("Summary: build inputs ready (payload {0} MB) but electron-builder was skipped;" -f $payloadMB)
    Write-Host '         no distributable was produced (that step needs the Electron binary).'
    exit 2
}

# Gate what actually ships, not the unpacked tree.
$artifacts = @(Get-ChildItem -LiteralPath $OutDir -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in @('.zip', '.exe') })
if ($artifacts.Count -eq 0) {
    Write-Warning "no distributable found in $OutDir; nothing to gate"
    exit 0
}
foreach ($artifact in $artifacts) {
    Assert-SizeGate -Label ("distributable " + $artifact.Name) -ActualMB ([math]::Round($artifact.Length / 1MB, 2)) -LimitMB $DistributableLimitMB
}

Write-Host ''
Write-Host ("Done. version {0}; artifacts in {1}" -f $version, $OutDir)
$artifacts | ForEach-Object { Write-Host ("  {0} ({1} MB)" -f $_.Name, [math]::Round($_.Length / 1MB, 2)) }
exit 0
