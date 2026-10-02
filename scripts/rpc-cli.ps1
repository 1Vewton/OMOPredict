<#
OMOPredict - manual stdio JSON-RPC debug client (docs/desktop.md T9).

Sends one or more JSON-RPC requests to a stdio endpoint and prints the responses. Use it when
the app misbehaves and you want to see the raw protocol traffic without the UI in the way.

Targets
  backend (default) - Go middleware in --stdio mode. Needs the same env the desktop shell sets:
                      OMO_AUTH_MODE=none and an OMO_DB_DSN. This script supplies sane defaults
                      (temp DB) unless you override them.
  engine            - the Python engine directly (python -m omo.rpc), useful to check the
                      engine in isolation.

Usage
  powershell -ExecutionPolicy Bypass -File scripts\rpc-cli.ps1
  powershell -ExecutionPolicy Bypass -File scripts\rpc-cli.ps1 -Method tasks.list
  powershell -ExecutionPolicy Bypass -File scripts\rpc-cli.ps1 -Method tasks.create -Params '{"kind":"simulate","layers":[{"material":"ITO","thickness_nm":40},{"material":"Ag","thickness_nm":10},{"material":"ITO","thickness_nm":40}]}'
  powershell -ExecutionPolicy Bypass -File scripts\rpc-cli.ps1 -Target engine -Method ping
  powershell -ExecutionPolicy Bypass -File scripts\rpc-cli.ps1 -Target backend -RequestFile req.jsonl

Exit codes
  0 = at least one response was received
  1 = usage/env problem, or no response within the timeout

Why .NET Process instead of PowerShell pipes: PowerShell does not stream a pipeline into a child
process, so the child's stdin stays open and it may never answer (docs/HANDOVER.md 6.16).

NOTE: comments in this file are ASCII on purpose (docs/HANDOVER.md 6.19).
#>
[CmdletBinding()]
param(
    [ValidateSet('backend', 'engine')]
    [string] $Target = 'backend',
    [string] $Method = 'ping',
    [string] $Params = '',
    [string] $RequestFile = '',
    [string] $Exe = '',
    [string] $DataDir = '',
    [int] $TimeoutSec = 30
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) 'omopredict-rpc-cli'
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
if ($DataDir -eq '') { $DataDir = $tempRoot }

function Resolve-Target {
    if ($Target -eq 'engine') {
        $python = Join-Path $repoRoot 'engine/.venv/Scripts/python.exe'
        if (-not (Test-Path -LiteralPath $python)) {
            $found = Get-Command python -ErrorAction SilentlyContinue
            if ($null -eq $found) { throw 'No engine interpreter found (expected engine/.venv or python on PATH).' }
            $python = $found.Source
        }
        return @{ File = $python; Args = @('-m', 'omo.rpc'); WorkDir = (Join-Path $repoRoot 'engine') }
    }

    if ($Exe -ne '') {
        if (-not (Test-Path -LiteralPath $Exe)) { throw "backend executable not found: $Exe" }
        return @{ File = $Exe; Args = @('--stdio'); WorkDir = $repoRoot }
    }

    foreach ($candidate in @('desktop/release/omopredict-server.exe', 'server/omopredict.exe', 'server/omopredict')) {
        $full = Join-Path $repoRoot $candidate
        if (Test-Path -LiteralPath $full) {
            return @{ File = $full; Args = @('--stdio'); WorkDir = $repoRoot }
        }
    }
    throw ("backend executable not found. Build it first:" + [Environment]::NewLine +
        '  cd server; go build -o omopredict.exe ./cmd/omopredict' + [Environment]::NewLine +
        'or pass -Exe <path>.')
}

# Build the request line(s).
$payload = @()
if ($RequestFile -ne '') {
    if (-not (Test-Path -LiteralPath $RequestFile)) { throw "request file not found: $RequestFile" }
    $payload = @(Get-Content -LiteralPath $RequestFile -Encoding UTF8 | Where-Object { $_.Trim().Length -gt 0 })
}
else {
    $paramsJson = if ($Params -eq '') { '{}' } else { $Params }
    # Validate early: a broken JSON string should not look like a backend failure.
    $null = $paramsJson | ConvertFrom-Json
    # Built by concatenation on purpose: a JSON literal inside -f would be read as format
    # placeholders ("Input string was not in a correct format").
    $payload = @('{"jsonrpc":"2.0","id":1,"method":"' + $Method + '","params":' + $paramsJson + '}')
}

# NOTE: the local is $endpoint, not $target: PowerShell variables are CASE-INSENSITIVE, so
# $target would assign the $Target parameter (which has a ValidateSet) and blow up.
$endpoint = Resolve-Target
$request = $payload -join [Environment]::NewLine

Write-Host ("target : {0}" -f $Target)
Write-Host ("exe    : {0} {1}" -f $endpoint.File, ($endpoint.Args -join ' '))
Write-Host ("request: {0}" -f $request)
Write-Host ''

# Windows PowerShell 5.1 runs on .NET Framework, where ProcessStartInfo has no ArgumentList
# (that is .NET Core 2.1+). Use the Arguments string and quote paths that contain spaces.
function Quote-Argument {
    param([string] $Value)
    if ($Value -match '[\s"]') { return '"' + ($Value -replace '"', '\"') + '"' }
    return $Value
}

$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = $endpoint.File
$startInfo.Arguments = (($endpoint.Args | ForEach-Object { Quote-Argument $_ }) -join ' ')
$startInfo.WorkingDirectory = $endpoint.WorkDir
$startInfo.UseShellExecute = $false
$startInfo.RedirectStandardInput = $true
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
$startInfo.StandardOutputEncoding = [System.Text.Encoding]::UTF8
$startInfo.StandardErrorEncoding = [System.Text.Encoding]::UTF8

# Environment: the Go side needs single-user mode + a DB; the engine needs nothing special.
$startInfo.EnvironmentVariables['OMO_AUTH_MODE'] = 'none'
$startInfo.EnvironmentVariables['OMO_ENGINE_TRANSPORT'] = 'stdio'
$startInfo.EnvironmentVariables['OMO_DB_DRIVER'] = 'sqlite'
$startInfo.EnvironmentVariables['OMO_DB_DSN'] = Join-Path $DataDir 'rpc-cli.db'
# Keep an engine command if the caller exported one (otherwise Go discovers it).
$engineCmd = $env:OMO_ENGINE_CMD
if ($engineCmd -and $engineCmd.Trim().Length -gt 0) {
    $startInfo.EnvironmentVariables['OMO_ENGINE_CMD'] = $engineCmd
}

$process = [System.Diagnostics.Process]::Start($startInfo)
$responses = New-Object System.Collections.Generic.List[string]

# Drain stderr in the background: the endpoint logs there and a full pipe would block it.
$stderrTask = $process.StandardError.ReadToEndAsync()

try {
    $process.StandardInput.Write($request + [Environment]::NewLine)
    $process.StandardInput.Flush()
}
catch {
    Write-Warning ("failed to write request: " + $_.Exception.Message)
}

$deadline = (Get-Date).AddSeconds($TimeoutSec)
while ($responses.Count -lt $payload.Count) {
    $remaining = [int][Math]::Max(0, ($deadline - (Get-Date)).TotalMilliseconds)
    if ($remaining -le 0) { break }
    $readTask = $process.StandardOutput.ReadLineAsync()
    if (-not $readTask.Wait($remaining)) { break }   # timeout: stop waiting
    if ($null -eq $readTask.Result) { break }        # stdout closed
    $responses.Add($readTask.Result)
}

# Close stdin so the endpoint exits the same way it does when the shell shuts down.
try {
    $process.StandardInput.Close()
}
catch { }
if (-not $process.WaitForExit(5000)) {
    Write-Warning 'endpoint did not exit after stdin closed; killing it'
    $process.Kill()
}

$stderrText = ''
if ($stderrTask.Wait(2000)) { $stderrText = $stderrTask.Result }
$stderrLines = @($stderrText -split '\r?\n' | Where-Object { $_.Length -gt 0 })

Write-Host '--- stderr (logs) ---'
if ($stderrLines.Count -eq 0) { Write-Host '(none)' } else { $stderrLines | ForEach-Object { Write-Host $_ } }
Write-Host ''
Write-Host '--- stdout (JSON-RPC) ---'
if ($responses.Count -eq 0) {
    Write-Host '(no response)'
    Write-Host ''
    Write-Host ("No response within {0}s. Check the stderr above." -f $TimeoutSec)
    exit 1
}
foreach ($line in $responses) {
    try {
        $line | ConvertFrom-Json | ConvertTo-Json -Depth 12
    }
    catch {
        Write-Host $line   # not JSON - show it raw so protocol pollution is visible
    }
}
Write-Host ''
Write-Host ("exit code: {0}" -f $process.ExitCode)
exit 0
