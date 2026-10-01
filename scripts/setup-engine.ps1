<#
OMOPredict - prepare the simulation engine (lightweight package).

The lightweight package ships the engine SOURCE only (no bundled Python environment),
so the user must install its dependencies once. After this script succeeds the desktop
app finds the engine through the D9 discovery chain (uv -> python on PATH).

Usage
  powershell -ExecutionPolicy Bypass -File scripts\setup-engine.ps1
  powershell -ExecutionPolicy Bypass -File scripts\setup-engine.ps1 -EngineDir <path> -Python <python.exe>
  powershell -ExecutionPolicy Bypass -File scripts\setup-engine.ps1 -SkipInstall   # verify only

Exit codes
  0 = engine ready (ping answered)
  1 = failed (the message says what to install)

NOTE: comments in this file are ASCII on purpose. On a Chinese-locale Windows, PowerShell 5.1
reads .ps1 files as GBK unless they carry a UTF-8 BOM; a CJK comment can then swallow the
following newline and silently comment out the next line of code (docs/HANDOVER.md 6.19).
#>
[CmdletBinding()]
param(
    [string] $EngineDir = '',
    [string] $Python = '',
    [switch] $SkipInstall
)

$ErrorActionPreference = 'Stop'

function Resolve-EngineDirectory {
    param([string] $Explicit)

    if ($Explicit -ne '') {
        $full = (Resolve-Path -LiteralPath $Explicit).Path
        if (-not (Test-Path -LiteralPath (Join-Path $full 'pyproject.toml'))) {
            throw "Not an engine project (pyproject.toml missing): $full"
        }
        return $full
    }

    # repo checkout (scripts/../engine) first, then the packaged layout (resources/engine)
    # NOTE: single-child Join-Path only - multiple positional children need PS 6+
    # (-AdditionalChildPath); forward slashes keep this working on both platforms.
    $candidates = @(
        (Join-Path $PSScriptRoot '../engine'),
        (Join-Path $PSScriptRoot '../resources/engine'),
        (Join-Path $PSScriptRoot 'resources/engine'),
        (Join-Path $PSScriptRoot 'engine')
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath (Join-Path $candidate 'pyproject.toml')) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    throw "Engine project not found. Pass -EngineDir <path to folder containing pyproject.toml>."
}

function Find-Python {
    foreach ($name in @('python', 'python3', 'py')) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if ($null -ne $cmd) { return $cmd.Source }
    }
    return ''
}

function Test-EnginePing {
    param([string[]] $Argv)

    $exe = $Argv[0]
    $rest = @()
    if ($Argv.Length -gt 1) { $rest = $Argv[1..($Argv.Length - 1)] }

    $payload = '{"jsonrpc":"2.0","id":1,"method":"ping","params":{}}'
    # The engine prints its banner to stderr. Under $ErrorActionPreference='Stop' any native
    # stderr output becomes a terminating error, so relax it here and read stdout only
    # (the JSON-RPC response is on stdout by protocol).
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = ($payload | & $exe @rest 2>$null | Out-String)
    }
    catch {
        # A missing/broken interpreter must not abort with a raw PowerShell error:
        # the whole point of this script is to explain what to install.
        $output = ''
    }
    finally {
        $ErrorActionPreference = $previous
    }
    return ($output -match '"status"\s*:\s*"ok"')
}

Write-Host '[1/3] locate engine project'
$projectDir = Resolve-EngineDirectory -Explicit $EngineDir
Write-Host "      engine : $projectDir"

Write-Host '[2/3] install dependencies'
$uvCommand = Get-Command uv -ErrorAction SilentlyContinue
$pythonExe = if ($Python -ne '') { $Python } else { Find-Python }
$argv = @()
$useUv = $false

if (-not $SkipInstall) {
    if ($null -ne $uvCommand) {
        Write-Host "      using uv : $($uvCommand.Source)"
        & $uvCommand.Source sync --frozen --project $projectDir
        if ($LASTEXITCODE -ne 0) { throw "uv sync failed (exit $LASTEXITCODE)" }
    }
    else {
        if ($pythonExe -eq '') {
            throw "No uv and no Python found. Install uv (recommended, https://docs.astral.sh/uv/) or Python 3.12+, then re-run."
        }
        Write-Host "      using pip : $pythonExe"
        Write-Host '      (if the download is slow: python -m pip install -e <engine> -i https://pypi.tuna.tsinghua.edu.cn/simple)'
        & $pythonExe -m pip install -e $projectDir
        if ($LASTEXITCODE -ne 0) { throw "pip install failed (exit $LASTEXITCODE)" }
    }
    Write-Host '      dependencies installed'
}
else {
    Write-Host '      skipped (-SkipInstall)'
}

# Build the same argv the Go side would build (D9), so verification covers the real path.
# An explicitly passed interpreter wins (that is also what the user just installed into).
$argv = @()
if ($Python -ne '') {
    $argv = @($Python, '-m', 'omo.rpc')
}
elseif ($null -ne $uvCommand) {
    $argv = @($uvCommand.Source, 'run', '--frozen', '--project', $projectDir, 'python', '-m', 'omo.rpc')
}
elseif ($pythonExe -ne '') {
    $argv = @($pythonExe, '-m', 'omo.rpc')
}

Write-Host '[3/3] verify engine answers ping'
if ($argv.Length -gt 0 -and (Test-EnginePing -Argv $argv)) {
    Write-Host '      engine ready: ping ok'
    Write-Host ''
    Write-Host 'Done. Start the app; it will discover the engine automatically.'
    exit 0
}

# Every failure funnels here so the user always gets actionable text (never a raw stack trace).
Write-Host '      FAILED: the engine did not answer ping' -ForegroundColor Red
Write-Host ''
if ($argv.Length -eq 0) {
    Write-Host 'Cause: no Python interpreter and no uv were found on PATH.'
}
else {
    Write-Host ("Tried: " + [string]::Join(' ', $argv))
}
Write-Host ''
Write-Host 'What to check:'
Write-Host '  1) Install Python 3.12+ (https://www.python.org/downloads/) or uv (https://docs.astral.sh/uv/)'
Write-Host '     - during Python setup, tick "Add python.exe to PATH"'
Write-Host '  2) Install the engine dependencies: re-run this script WITHOUT -SkipInstall'
Write-Host '  3) Verify by hand (Ctrl+C to quit):'
if ($argv.Length -gt 0) {
    Write-Host ("       " + [string]::Join(' ', $argv))
}
else {
    Write-Host '       python -m omo.rpc'
}
Write-Host '  4) If the download is slow, use a mirror:'
Write-Host '       python -m pip install -e <engine dir> -i https://pypi.tuna.tsinghua.edu.cn/simple'
exit 1
