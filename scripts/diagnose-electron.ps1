<#
OMOPredict - Electron launch diagnostics (T11 helper).

Answers one question first: is the window you are running in INSIDE the DSH sandbox, or outside it?
Those two cases produce the SAME symptom (exit code 0x80000003, no output), so the symptom alone
cannot tell them apart. This script prints the environment facts plus a small launch matrix.

Usage
  powershell -ExecutionPolicy Bypass -File scripts\diagnose-electron.ps1

Paste the whole output back. Nothing here modifies the repository.

NOTE: comments in this file are ASCII on purpose (docs/HANDOVER.md 6.19).
#>
[CmdletBinding()]
param(
    [int] $TimeoutMs = 20000
)

$ErrorActionPreference = 'Continue'

$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$electron = Join-Path $repo 'desktop/node_modules/electron/dist/electron.exe'
$versionFile = Join-Path $repo 'desktop/node_modules/electron/dist/version'

Write-Host '=== 1. where am I running? ==='
Write-Host ("  UserInteractive        : " + [System.Environment]::UserInteractive)
Write-Host ("  SessionId              : " + (Get-Process -Id $PID).SessionId)
Write-Host ("  ELECTRON_RUN_AS_NODE   : '" + $env:ELECTRON_RUN_AS_NODE + "'   (empty = NOT in the harness env)")
Write-Host ("  DSH_* variables        : " + [bool](Get-ChildItem Env: -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'DSH_*' -or $_.Name -like 'OMO_DSH*' }))
Write-Host ("  my PID                 : " + $PID)

# The parent chain is the decisive evidence. A genuine desktop window is launched by explorer.exe;
# if the chain leads back to the DSH harness (node/dsh/uv/agent), this window is a CHILD of the
# harness and stays confined even though its environment looks clean.
Write-Host '  process chain (self -> parent -> grandparent):'
$cursor = $PID
for ($depth = 0; $depth -lt 3; $depth++) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$cursor" -ErrorAction SilentlyContinue
    if (-not $proc) { break }
    $cmd = [string]$proc.CommandLine
    if ($cmd.Length -gt 90) { $cmd = $cmd.Substring(0, 90) + '...' }
    Write-Host ("    [{0}] {1} (pid {2})  {3}" -f $depth, $proc.Name, $proc.ProcessId, $cmd)
    if (-not $proc.ParentProcessId -or $proc.ParentProcessId -eq 0) { break }
    $cursor = $proc.ParentProcessId
}
Write-Host ("  electron dist version  : " + (Get-Content -LiteralPath $versionFile -ErrorAction SilentlyContinue))
Write-Host '  how to read this:'
Write-Host '    * chain reaches explorer.exe       -> genuine desktop window: you ARE outside the sandbox'
Write-Host '    * chain leads to node/dsh/agent    -> this window is a CHILD of the harness: still confined'
Write-Host '    * ELECTRON_RUN_AS_NODE non-empty   -> harness env (a clean cmd from the Start menu has it empty)'

Write-Host ''
Write-Host '=== 2. a minimal Electron app (no OMOPredict code involved) ==='
$mini = Join-Path $env:TEMP 'omo-electron-mini'
New-Item -ItemType Directory -Force -Path $mini | Out-Null
Set-Content -LiteralPath (Join-Path $mini 'package.json') -Encoding ASCII -Value '{ "name": "omo-mini", "version": "0.0.0", "main": "main.js" }'
$miniMain = @'
const { app } = require('electron')
console.log('[mini] main script loaded; electron =', process.versions.electron)
app.whenReady().then(() => { console.log('[mini] READY: app.whenReady resolved'); app.exit(0) })
setTimeout(() => { console.error('[mini] TIMEOUT: whenReady never resolved'); app.exit(3) }, 10000)
'@
Set-Content -LiteralPath (Join-Path $mini 'main.js') -Value $miniMain -Encoding ASCII

function Invoke-Case {
    param([string] $Label, [string[]] $Argv)
    $out = Join-Path $env:TEMP 'omo-diag.out'
    $err = Join-Path $env:TEMP 'omo-diag.err'
    Remove-Item $out, $err -ErrorAction SilentlyContinue
    $proc = Start-Process -FilePath $electron -ArgumentList $Argv -PassThru -Wait `
        -RedirectStandardOutput $out -RedirectStandardError $err
    $proc.Refresh()
    $code = $proc.ExitCode
    $hex = ''
    if ($code -lt 0) { $hex = ' (' + ('0x{0:X8}' -f ([int64]$code -band 0xFFFFFFFFL)) + ')' }
    $o = @(Get-Content $out -ErrorAction SilentlyContinue | Where-Object { $_.Trim().Length -gt 0 })
    $first = ''
    if ($o.Count -gt 0) { $first = $o[0]; if ($first.Length -gt 70) { $first = $first.Substring(0, 70) } }
    Write-Host ("  {0,-34} exit={1}{2}  out='{3}'" -f $Label, $code, $hex, $first)
}

Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Invoke-Case '--version' @('--version')
Invoke-Case '--version --no-sandbox' @('--version', '--no-sandbox')
Invoke-Case 'mini' @($mini)
Invoke-Case 'mini --no-sandbox' @($mini, '--no-sandbox')
Invoke-Case 'mini --no-sandbox --disable-gpu' @($mini, '--no-sandbox', '--disable-gpu')

Write-Host ''
Write-Host '=== 3. how to read the matrix ==='
Write-Host '  IN the sandbox (reference signature, measured 2026-10):'
Write-Host '    --version                        exit=-2147483645 (0x80000003), no output'
Write-Host '    --version --no-sandbox           exit=0, prints v44.4.5'
Write-Host '    mini                             exit=-2147483645 (0x80000003), no output'
Write-Host '    mini --no-sandbox                exit=-1073741819 (0xC0000005), prints [mini] main script loaded'
Write-Host '  If your matrix matches that, you are still inside the sandbox.'
Write-Host '  If --version --no-sandbox does NOT print v44.4.5 outside the sandbox, the binary'
Write-Host '  itself is not runnable in your session (security software / policy / session type).'
