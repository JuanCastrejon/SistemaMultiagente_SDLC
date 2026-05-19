<#
.SYNOPSIS
  Mirrors repo-governed skills from .github/skills into agent-specific folders.

.DESCRIPTION
  .github/skills is the canonical source. This script creates managed mirrors in
  .claude/skills, .agents/skills and .windsurf/skills. External skill install is
  disabled by default; use -InstallExternal to opt in.
#>

# opt-in:external
[CmdletBinding()]
param(
  [switch] $SkipExternalInstall,
  [switch] $InstallExternal,
  [switch] $Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path $PSScriptRoot -Parent
$SourceRoot = Join-Path $RepoRoot '.github\skills'
$ManifestPath = Join-Path $PSScriptRoot 'agent-skills.manifest.json'
$MirrorRoots = @(
  Join-Path $RepoRoot '.claude\skills'
  Join-Path $RepoRoot '.agents\skills'
  Join-Path $RepoRoot '.windsurf\skills'
)

function Get-TextSha256 {
  param([string] $Text)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    return [System.BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function Read-Manifest {
  if (-not (Test-Path -LiteralPath $ManifestPath)) {
    return [pscustomobject]@{ repoGovernedSkills = @(); externalCollections = @() }
  }
  return Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
}

function Write-Mirror {
  param(
    [string] $SkillName,
    [string] $SourcePath,
    [string] $TargetRoot
  )
  $sourceText = Get-Content -LiteralPath $SourcePath -Raw
  $hash = Get-TextSha256 -Text $sourceText
  $targetDir = Join-Path $TargetRoot $SkillName
  $targetPath = Join-Path $targetDir 'SKILL.md'
  $mirrorText = @(
    '---'
    'managed: true'
    "source: .github/skills/$SkillName/SKILL.md"
    "source_sha256: $hash"
    '---'
    ''
    $sourceText.TrimEnd()
    ''
  ) -join "`n"

  if (Test-Path -LiteralPath $targetPath) {
    $existing = Get-Content -LiteralPath $targetPath -Raw
    if ($existing -notmatch 'managed:\s*true') {
      return [ordered]@{ target = $targetPath; status = 'skipped'; reason = 'unmanaged file exists' }
    }
    if ($existing -match 'source_sha256:\s*([a-f0-9]+)' -and $Matches[1] -ne $hash) {
      return [ordered]@{ target = $targetPath; status = 'skipped'; reason = 'managed mirror has local drift' }
    }
  }

  if (-not (Test-Path -LiteralPath $targetDir)) {
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
  }
  $mirrorText | Set-Content -LiteralPath $targetPath -Encoding UTF8
  return [ordered]@{ target = $targetPath; status = 'written'; reason = $null }
}

$manifest = Read-Manifest
if (-not (Test-Path -LiteralPath $SourceRoot)) {
  throw "Canonical skill source not found: $SourceRoot"
}

$skills = @(Get-ChildItem -LiteralPath $SourceRoot -Directory | Sort-Object Name)
if ($manifest.repoGovernedSkills.Count -gt 0) {
  $allowed = [System.Collections.Generic.HashSet[string]]::new([string[]] $manifest.repoGovernedSkills)
  $skills = @($skills | Where-Object { $allowed.Contains($_.Name) })
}

$results = @()
foreach ($skill in $skills) {
  $sourcePath = Join-Path $skill.FullName 'SKILL.md'
  if (-not (Test-Path -LiteralPath $sourcePath)) { continue }
  foreach ($root in $MirrorRoots) {
    $results += Write-Mirror -SkillName $skill.Name -SourcePath $sourcePath -TargetRoot $root
  }
}

$external = [ordered]@{ attempted = $false; installed = @(); skipped = @() }
if ($InstallExternal -and -not $SkipExternalInstall) {
  $external.attempted = $true
  $npx = Get-Command -Name npx -ErrorAction SilentlyContinue
  if (-not $npx) { throw 'npx no encontrado; no se pueden instalar skills externas.' }
  foreach ($collection in @($manifest.externalCollections)) {
    foreach ($skill in @($collection.skills)) {
      $external.installed += $skill.name
      & $npx.Source --yes $collection.source add $skill.name
    }
  }
} else {
  foreach ($collection in @($manifest.externalCollections)) {
    foreach ($skill in @($collection.skills)) { $external.skipped += $skill.name }
  }
}

$payload = [ordered]@{
  status = 'ok'
  source = $SourceRoot
  mirrors = $results
  external = $external
}

if ($Json) {
  $payload | ConvertTo-Json -Depth 8
} else {
  $written = @($results | Where-Object { $_.status -eq 'written' }).Count
  $skipped = @($results | Where-Object { $_.status -eq 'skipped' }).Count
  Write-Host "bootstrap-agent-skills: written=$written skipped=$skipped external_attempted=$($external.attempted)"
}
