<#
OMOPredict - build the LIGHTWEIGHT desktop package (user supplies Python).

Layout produced (docs/desktop.md D9):

  OMOPredict-lite-<version>-win-x64.zip
    OMOPredict.exe + <electron shell files>
    resources/
      dist/                 <- frontend/dist (renderer, shared with the full package)
      engine/               <- engine SOURCE (pyproject.toml, src/, uv.lock, ...)
      omopredict-server.exe <- Go backend (shared with the full package)
      app.asar              <- desktop build output (from electron-builder)
    setup-engine.ps1
    README.txt

The shell itself is produced by electron-builder (`build-desktop.ps1` / `pnpm exec electron-builder`).
This script takes that win-unpacked tree, adds the engine source + setup script, enforces the size
gate and zips it.

Usage
  powershell -ExecutionPolicy Bypass -File scripts\build-lite.ps1
  powershell -ExecutionPolicy Bypass -File scripts\build-lite.ps1 -AllowMissingShell   # staging + gates only

Exit codes
  0 = package produced
  1 = failure (build error or size gate violated)
  2 = staging only: shell tree missing and -AllowMissingShell was passed (no zip produced)

Size gates
  App payload       <= 50 MB  - Go backend + renderer + engine source + scripts. This is the
                                tight guard: it is what WE control, and it is where torch /
                                fastapi / matplotlib leakage shows up (torch alone is hundreds of MB).
  Lite package zip  <= 150 MB - payload + the Electron runtime. Electron is ~110 MB compressed on
                                its own, so the package figure is dominated by a constant we do not
                                control. DECISION (2026-09): the lightweight package keeps the
                                embedded Electron runtime, so this limit was raised from the
                                original 50 MB. Measured: payload ~27.5 MB staged / ~14 MB zipped
                                (Go backend 26.4 + renderer 0.61 + engine source 0.48).
  Engine source dir <= 90 MB  - catches a bundled engine environment leaking in.

NOTE: comments in this file are ASCII on purpose (docs/HANDOVER.md 6.19).
#>
[CmdletBinding()]
param(
    [string] $ShellDir = '',
    [string] $OutDir = '',
    [switch] $AllowMissingShell,
    [switch] $SkipFrontendBuild,
    [switch] $SkipGoBuild,
    [switch] $NoZip,
    [double] $PayloadLimitMB = 50,
    [double] $PackageLimitMB = 150,
    [double] $EngineLimitMB = 90
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if ($OutDir -eq '') { $OutDir = Join-Path $repoRoot 'desktop/release' }
if ($ShellDir -eq '') { $ShellDir = Join-Path $OutDir 'win-unpacked' }

$desktopPkg = Get-Content -LiteralPath (Join-Path $repoRoot 'desktop/package.json') -Raw -Encoding UTF8 |
    ConvertFrom-Json
$version = $desktopPkg.version
$staging = Join-Path $OutDir 'lite-staging'
$zipPath = Join-Path $OutDir ("OMOPredict-lite-{0}-win-x64.zip" -f $version)

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
    # Get-Item, not Get-ChildItem -Recurse -File: the latter returns a single file TWICE under
    # Windows PowerShell 5.1 (we once read a 26.4 MB binary as 52.8 MB that way).
    if (-not (Test-Path -LiteralPath $Path)) { return 0 }
    return [math]::Round((Get-Item -LiteralPath $Path).Length / 1MB, 2)
}

function Assert-SizeGate {
    param([string] $Label, [double] $ActualMB, [double] $LimitMB)
    Write-Host ("      {0}: {1} MB (limit {2} MB)" -f $Label, $ActualMB, $LimitMB)
    if ($ActualMB -gt $LimitMB) {
        $message = ("Size gate failed: {0} is {1} MB, over the {2} MB limit. " -f $Label, $ActualMB, $LimitMB) +
            'For the app payload / engine dir this usually means an optional dependency ' +
            '(torch / fastapi / matplotlib) leaked in. Raise the limit only on purpose ' +
            '(see the SIZE GATES note at the top of this script).'
        throw $message
    }
}

Write-Host '[1/5] renderer'
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
    throw "renderer not built: $distDir\index.html missing (drop -SkipFrontendBuild, or run 'pnpm build' in frontend/)"
}

Write-Host '[2/5] Go backend'
$backendExe = Join-Path $OutDir 'omopredict-server.exe'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
if ($SkipGoBuild) {
    Write-Host '      skipped (-SkipGoBuild)'
}
else {
    Push-Location (Join-Path $repoRoot 'server')
    try {
        $env:CGO_ENABLED = '0'   # glebarez/sqlite is pure Go; keeps the binary self-contained
        & go build -o $backendExe ./cmd/omopredict
        if ($LASTEXITCODE -ne 0) { throw "go build failed (exit $LASTEXITCODE)" }
    }
    finally { Pop-Location }
}
if (-not (Test-Path -LiteralPath $backendExe)) {
    throw "backend not built: $backendExe missing (drop -SkipGoBuild)"
}

Write-Host '[3/5] stage lightweight layout'
if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
New-Item -ItemType Directory -Force -Path $staging | Out-Null

$hasShell = Test-Path -LiteralPath $ShellDir
if ($hasShell) {
    Write-Host "      copying shell: $ShellDir"
    Copy-Item -LiteralPath $ShellDir -Destination $staging -Recurse -Force
}
else {
    if (-not $AllowMissingShell) {
        throw "shell tree not found: $ShellDir. Build it first (electron-builder), pass -ShellDir <win-unpacked>, " +
              'or pass -AllowMissingShell to produce staging only.'
    }
    Write-Warning "shell tree not found: $ShellDir -> staging only (package will NOT be runnable)"
}

$resourcesDir = Join-Path $staging 'resources'
New-Item -ItemType Directory -Force -Path $resourcesDir | Out-Null

# renderer (shared with the full package)
if ($hasShell -and (Test-Path -LiteralPath (Join-Path $resourcesDir 'dist'))) {
    Remove-Item -LiteralPath (Join-Path $resourcesDir 'dist') -Recurse -Force
}
Copy-Item -LiteralPath $distDir -Destination (Join-Path $resourcesDir 'dist') -Recurse -Force

# Go backend (shared with the full package)
Copy-Item -LiteralPath $backendExe -Destination (Join-Path $resourcesDir 'omopredict-server.exe') -Force

# engine SOURCE only - never the venv, caches or test artifacts
$engineSrc = Join-Path $repoRoot 'engine'
$engineDst = Join-Path $resourcesDir 'engine'
New-Item -ItemType Directory -Force -Path $engineDst | Out-Null
$engineIncludes = @('pyproject.toml', 'uv.lock', '.python-version', 'README.md', 'src')
foreach ($item in $engineIncludes) {
    $from = Join-Path $engineSrc $item
    if (Test-Path -LiteralPath $from) {
        Copy-Item -LiteralPath $from -Destination $engineDst -Recurse -Force
    }
    else {
        Write-Warning "engine item missing, skipped: $item"
    }
}
# strip caches that may have been copied along with src/
Get-ChildItem -LiteralPath $engineDst -Recurse -Directory -Filter '__pycache__' -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

# setup script + readme (only meaningful in the lightweight package)
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'setup-engine.ps1') -Destination $staging -Force
$readmeTemplate = Join-Path $repoRoot 'desktop/lite/README.txt'
if (Test-Path -LiteralPath $readmeTemplate) {
    # -Encoding UTF8 is required: Windows PowerShell 5.1 decodes UTF-8-without-BOM text as ANSI,
    # which would turn the Chinese README into mojibake inside the package (docs/HANDOVER.md 6.24).
    $readme = (Get-Content -LiteralPath $readmeTemplate -Raw -Encoding UTF8).Replace('{{VERSION}}', $version)
    Set-Content -LiteralPath (Join-Path $staging 'README.txt') -Value $readme -Encoding UTF8
}
else {
    Write-Warning "README template missing: $readmeTemplate"
}

Write-Host '[4/5] size gates'
# The payload is measured from its SOURCES (not by subtracting the shell from staging): it is the
# part we control and the part that regresses when an optional dependency leaks in.
$payloadMB = [math]::Round(
    (Get-DirectorySizeMB $distDir) +
    (Get-DirectorySizeMB $engineDst) +
    (Get-FileSizeMB $backendExe) +
    (Get-FileSizeMB (Join-Path $staging 'setup-engine.ps1')) +
    (Get-FileSizeMB (Join-Path $staging 'README.txt')), 2)
$stagingMB = Get-DirectorySizeMB $staging
Write-Host ("      staging total (incl. shell): {0} MB" -f $stagingMB)
Assert-SizeGate -Label 'app payload' -ActualMB $payloadMB -LimitMB $PayloadLimitMB
Assert-SizeGate -Label 'engine source dir' -ActualMB (Get-DirectorySizeMB $engineDst) -LimitMB $EngineLimitMB

Write-Host '[5/5] package'
if (-not $hasShell -or $NoZip) {
    Write-Host "      zip skipped (shell present: $hasShell, -NoZip: $([bool]$NoZip))"
    Write-Host ''
    Write-Host ("Summary: staging at {0} (payload {1} MB, total {2} MB) - NOT a runnable package yet." -f $staging, $payloadMB, $stagingMB)
    if (-not $hasShell) { exit 2 }
    exit 0
}

if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zipPath -CompressionLevel Optimal
$zipMB = [math]::Round((Get-Item -LiteralPath $zipPath).Length / 1MB, 2)
Assert-SizeGate -Label 'lite zip' -ActualMB $zipMB -LimitMB $PackageLimitMB

Write-Host ''
Write-Host ("Done: {0} ({1} MB; payload {2} MB)" -f $zipPath, $zipMB, $payloadMB)
exit 0
