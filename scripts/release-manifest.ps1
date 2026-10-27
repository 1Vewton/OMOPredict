<#
OMOPredict - build a SHA256 checksum manifest for release artifacts (docs/desktop.md T9/G6).

Every release ships a manifest so a download can be verified independently of the CDN. This script
is deliberately tiny and dependency-free (`Get-FileHash`), and it is the same script CI uses, so a
human reproducing a release locally runs exactly the code that produced the published manifest.

Usage
  powershell -ExecutionPolicy Bypass -File scripts\release-manifest.ps1
  powershell -ExecutionPolicy Bypass -File scripts\release-manifest.ps1 -InputDir desktop\release -OutDir dist\release
  powershell -ExecutionPolicy Bypass -File scripts\release-manifest.ps1 -InputDir desktop\release -OutDir dist\release -Include "desktop\release\lite\*.zip"
  powershell -ExecutionPolicy Bypass -File scripts\release-manifest.ps1 -Verify
  powershell -ExecutionPolicy Bypass -File scripts\release-manifest.ps1 -Verify -Checksums <path> -Include "desktop\release\lite\*.zip"

Selection
  Only direct children of -InputDir whose extension is in -Extensions (a shippable allowlist:
  .zip/.exe/.msi/.dmg/.pkg/.AppImage/.deb/.rpm/.tar.gz) are hashed. That keeps electron-builder
  bookkeeping (builder-debug.yml, builder-effective-config.yaml, *.blockmap) out of the manifest,
  and a new kind of junk cannot slip in the way it would with a deny-list.
  -Include adds files from elsewhere (wildcards allowed), which is how the lightweight zip - built
  into a different directory - gets covered. Pass the same -Include to -Verify.

Outputs (in -OutDir)
  SHA256SUMS.txt                sha256sum-compatible: "<64 hex>  <file name>"
  omopredict-<version>.json     machine-readable manifest (version, commit, per-file sha256/size)

Exit codes
  0 = manifest written (or -Verify confirmed every file)
  1 = failure (no artifacts, hash mismatch in -Verify, unreadable manifest)

NOTE: comments in this file are ASCII on purpose (docs/HANDOVER.md 6.19).
#>
[CmdletBinding()]
param(
    [string] $InputDir = '',
    [string] $OutDir = '',
    [string] $Version = '',
    [string] $Checksums = '',
    [string] $Product = 'OMOPredict',
    [switch] $Verify,
    # Extra files to include even when they sit outside -InputDir (wildcards allowed).
    [string[]] $Include = @(),
    # Which extensions count as shippable artifacts (things a user downloads and runs).
    # An allowlist, so electron-builder's bookkeeping files cannot leak into the manifest.
    [string[]] $Extensions = @('.zip', '.exe', '.msi', '.dmg', '.pkg', '.AppImage', '.deb', '.rpm', '.tar.gz')
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if ($InputDir -eq '') { $InputDir = Join-Path $repoRoot 'desktop/release' }
if (-not (Test-Path -LiteralPath $InputDir)) {
    # Not an error on a fresh clone: just say what to run.
    Write-Host ("[manifest] nothing to do: {0} does not exist" -f $InputDir)
    Write-Host '[manifest] build a package first (scripts\build-lite.ps1 or scripts\build-desktop.ps1)'
    exit 1
}
$InputDir = (Resolve-Path -LiteralPath $InputDir).Path
if ($OutDir -eq '') { $OutDir = Join-Path $repoRoot 'dist/release' }

function Get-Version {
    if ($Version -ne '') { return $Version }
    # Prefer the desktop package version: it is the version of what we ship.
    $desktopPkg = Join-Path $repoRoot 'desktop/package.json'
    if (Test-Path -LiteralPath $desktopPkg) {
        try {
            $parsed = Get-Content -LiteralPath $desktopPkg -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($parsed.version) { return [string] $parsed.version }
        }
        catch { }
    }
    $engineToml = Join-Path $repoRoot 'engine/pyproject.toml'
    if (Test-Path -LiteralPath $engineToml) {
        $line = Select-String -LiteralPath $engineToml -Pattern '^version\s*=\s*"([^"]+)"' |
            Select-Object -First 1
        if ($null -ne $line) { return $line.Matches[0].Groups[1].Value }
    }
    return '0.0.0'
}

function Get-Commit {
    try {
        $sha = & git -C $repoRoot rev-parse HEAD 2>$null
        if ($LASTEXITCODE -eq 0 -and $sha) { return ([string] $sha).Trim() }
    }
    catch { }
    return ''
}

# Artifacts are direct children only: a release directory may also hold unpacked trees
# (e.g. win-unpacked/) that must never be hashed into the manifest.
#
# Selection is an ALLOWLIST of shipping extensions rather than a deny-list of known junk: a
# release directory also collects electron-builder bookkeeping (builder-debug.yml,
# builder-effective-config.yaml, ...) which must not end up in the manifest, and new junk would
# silently slip through a deny-list. -Include adds files from outside $Dir explicitly.
function Get-Artifacts {
    param([string] $Dir, [string[]] $Extra, [string[]] $Extensions)
    $allowed = @($Extensions | ForEach-Object { $_.ToLowerInvariant() })
    $files = @(Get-ChildItem -LiteralPath $Dir -File -ErrorAction SilentlyContinue |
        Where-Object { $allowed -contains $_.Extension.ToLowerInvariant() })
    foreach ($item in $Extra) {
        # -Include may contain wildcards (electron-builder's output names are not fully predictable)
        $hits = @(Get-Item -Path $item -ErrorAction SilentlyContinue)
        if ($hits.Count -eq 0) {
            Write-Warning ("-Include matched nothing, skipped: {0}" -f $item)
            continue
        }
        foreach ($hit in $hits) {
            if ($hit.PSIsContainer) { continue }
            if (-not ($files | Where-Object { $_.FullName -eq $hit.FullName })) {
                $files += $hit
            }
        }
    }
    return $files
}

# ---- verify mode ------------------------------------------------------------
if ($Verify) {
    if ($Checksums -eq '') { $Checksums = Join-Path $OutDir 'SHA256SUMS.txt' }
    if (-not (Test-Path -LiteralPath $Checksums)) {
        Write-Host ("[manifest] cannot verify: {0} not found" -f $Checksums)
        exit 1
    }
    Write-Host ("[manifest] verifying against {0}" -f $Checksums)
    # Build a name -> path lookup: -InputDir first, then anything matched by -Include. Without
    # this, a manifest that covers files from both places could never be verified back, which is
    # exactly the shape the release job produces (full package + lightweight zip).
    $lookup = @{}
    Get-ChildItem -LiteralPath $InputDir -File -ErrorAction SilentlyContinue | ForEach-Object {
        $lookup[$_.Name] = $_.FullName
    }
    foreach ($item in $Include) {
        foreach ($hit in @(Get-Item -Path $item -ErrorAction SilentlyContinue)) {
            if (-not $hit.PSIsContainer -and -not $lookup.ContainsKey($hit.Name)) {
                $lookup[$hit.Name] = $hit.FullName
            }
        }
    }
    $checked = 0
    $bad = 0
    foreach ($line in Get-Content -LiteralPath $Checksums -Encoding UTF8) {
        if ($line.Trim().Length -eq 0) { continue }
        # sha256sum format is "<hash>  <name>"; accept single-space too.
        $parts = $line.Trim() -split '\s+', 2
        if ($parts.Count -ne 2) {
            Write-Host ("  !! unparsable line: " + $line)
            $bad++
            continue
        }
        $expected = $parts[0].ToLower()
        $name = $parts[1].Trim()
        $target = $lookup[$name]
        if ($null -eq $target -or -not (Test-Path -LiteralPath $target)) {
            Write-Host ("  MISSING  " + $name)
            $bad++
            continue
        }
        $actual = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLower()
        $checked++
        if ($actual -eq $expected) {
            Write-Host ("  OK       " + $name)
        }
        else {
            Write-Host ("  MISMATCH " + $name)
            Write-Host ("           expected " + $expected)
            Write-Host ("           actual   " + $actual)
            $bad++
        }
    }
    Write-Host ''
    if ($bad -gt 0) {
        Write-Host ("[manifest] FAILED: {0} problem(s) across {1} file(s)" -f $bad, $checked) -ForegroundColor Red
        exit 1
    }
    Write-Host ("[manifest] OK: {0} file(s) verified" -f $checked) -ForegroundColor Green
    exit 0
}

# ---- generate mode ----------------------------------------------------------
$artifacts = @(Get-Artifacts -Dir $InputDir -Extra $Include -Extensions $Extensions)
if ($artifacts.Count -eq 0) {
    Write-Host ("[manifest] no artifacts found in {0}" -f $InputDir)
    Write-Host '[manifest] expected a .zip / .exe / .tar.gz produced by the packaging scripts'
    exit 1
}

$resolvedVersion = Get-Version
$commit = Get-Commit

if (-not (Test-Path -LiteralPath $OutDir)) {
    $null = New-Item -ItemType Directory -Force -Path $OutDir
}

Write-Host ("[manifest] version {0}; {1} artifact(s)" -f $resolvedVersion, $artifacts.Count)

$entries = @()
$sumLines = @()
foreach ($file in ($artifacts | Sort-Object Name)) {
    $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLower()
    $sizeMB = [math]::Round($file.Length / 1MB, 2)
    $shortHash = $hash.Substring(0, 16) + '...'
    # Format arguments must be one array: a bare comma list binds differently under -f and used to
    # fail with "Index must be ... less than the size of the argument list".
    Write-Host ("  {0,-40} {1}  ({2} MB)" -f @($file.Name, $shortHash, $sizeMB))
    # Two spaces is the format sha256sum -c and sha256sum --check expect.
    $sumLines += ($hash + '  ' + $file.Name)
    $entries += [ordered]@{
        name   = $file.Name
        sha256 = $hash
        size   = $file.Length
        size_mb = $sizeMB
    }
}

$sumsPath = Join-Path $OutDir 'SHA256SUMS.txt'
# LF-only and no BOM: the file is consumed by sha256sum on Linux/macOS.
$sumText = ($sumLines -join "`n") + "`n"
[System.IO.File]::WriteAllText($sumsPath, $sumText, (New-Object System.Text.UTF8Encoding($false)))

$manifest = [ordered]@{
    product     = $Product
    version     = $resolvedVersion
    commit      = $commit
    generated   = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    generator   = 'scripts/release-manifest.ps1'
    artifacts   = $entries
}
$manifestPath = Join-Path $OutDir ('{0}-{1}.json' -f $Product.ToLower(), $resolvedVersion)
$manifestJson = $manifest | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($manifestPath, ($manifestJson + "`n"), (New-Object System.Text.UTF8Encoding($false)))

Write-Host ''
Write-Host ("[manifest] wrote {0}" -f $sumsPath)
Write-Host ("[manifest] wrote {0}" -f $manifestPath)
Write-Host ("[manifest] verify with: powershell -File scripts\release-manifest.ps1 -Verify -Checksums ""{0}""" -f $sumsPath)
exit 0
