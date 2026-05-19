<#
.SYNOPSIS
  Creates the optional Obsidian memory vault scaffold.

.DESCRIPTION
  Default mode is a dry-run plan. Use -Apply to create folders and starter
  notes. Obsidian registration is also opt-in and only updates the local
  Obsidian config when -RegisterObsidian is provided with -Apply.
#>

[CmdletBinding()]
param(
  [switch] $Apply,
  [switch] $RegisterObsidian,
  [string] $ConfigPath = '',
  [switch] $Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptRoot = $PSScriptRoot
if (-not $ConfigPath) {
  $ConfigPath = Join-Path $ScriptRoot 'obsidian-memory.config.local.json'
}

function Read-MemoryConfig {
  param([string] $Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    $example = Join-Path $ScriptRoot 'obsidian-memory.config.example.json'
    throw "Missing local config: $Path. Copy $example to obsidian-memory.config.local.json and adjust paths."
  }
  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Ensure-Directory {
  param([string] $Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

function Ensure-File {
  param([string] $Path, [string] $Content)
  if (-not (Test-Path -LiteralPath $Path)) {
    $dir = Split-Path -Path $Path -Parent
    Ensure-Directory -Path $dir
    $Content | Set-Content -LiteralPath $Path -Encoding UTF8
  }
}

function Resolve-ObsidianConfigPath {
  param($Config)
  if ($Config.obsidianConfigPath) {
    return [Environment]::ExpandEnvironmentVariables([string] $Config.obsidianConfigPath)
  }
  return Join-Path $env:APPDATA 'obsidian\obsidian.json'
}

function Register-ObsidianVault {
  param([string] $VaultRoot, [string] $ConfigPath, [string] $ProjectSlug)
  $dir = Split-Path -Path $ConfigPath -Parent
  Ensure-Directory -Path $dir
  $config = if (Test-Path -LiteralPath $ConfigPath) {
    Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  } else {
    [pscustomobject]@{ vaults = [pscustomobject]@{} }
  }
  if (-not $config.vaults) {
    $config | Add-Member -NotePropertyName vaults -NotePropertyValue ([pscustomobject]@{}) -Force
  }
  $vaultId = "{{project.slug}}"
  $vaultInfo = [pscustomobject]@{
    path = $VaultRoot
    ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    open = $false
  }
  $config.vaults | Add-Member -NotePropertyName $vaultId -NotePropertyValue $vaultInfo -Force
  $config | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ConfigPath -Encoding UTF8
}

$config = $null
try {
  $config = Read-MemoryConfig -Path $ConfigPath
} catch {
  if ($Apply) { throw }
  $plan = [ordered]@{
    status = 'config-missing'
    dry_run = $true
    config = $ConfigPath
    message = $_.Exception.Message
  }
  if ($Json) { $plan | ConvertTo-Json -Depth 5 } else { Write-Host "bootstrap-obsidian-vault: $($plan.message)" }
  exit 0
}

$projectSlug = if ($config.projectSlug) { [string] $config.projectSlug } else { '{{project.slug}}' }
$projectName = if ($config.projectName) { [string] $config.projectName } else { '{{project.name}}' }
$vaultRoot = [string] $config.vaultRoot
$projectRoot = Join-Path $vaultRoot $projectSlug
$paths = @(
  $vaultRoot,
  $projectRoot,
  (Join-Path $projectRoot 'sessions'),
  (Join-Path $projectRoot 'decisions'),
  (Join-Path $projectRoot 'architecture'),
  (Join-Path $projectRoot 'pipeline'),
  (Join-Path $projectRoot 'features'),
  (Join-Path $vaultRoot "graphify\$projectSlug")
)

$notes = [ordered]@{
  "index.md" = @"
---
project: $projectSlug
generated_by: bootstrap-obsidian-vault
---

# $projectName

## Navigation

- [[decisions/index|Decisions]]
- [[architecture/index|Architecture]]
- [[pipeline/index|Pipeline]]
- [[features/backlog|Backlog]]
- [[sessions/index|Sessions]]

## Operating rule

The repository remains the source of truth. This vault stores memory, checkpoints and graph-derived notes.
"@
  "decisions/index.md" = @"
# Decisions

Record durable decisions here and link back to repo docs, OpenSpec changes or issues.
"@
  "architecture/index.md" = @"
# Architecture

Capture architecture context, constraints and diagrams derived from the repo.
"@
  "pipeline/index.md" = @"
# Pipeline

Track SDLC automation, CI/CD, migrations and release evidence.
"@
  "features/backlog.md" = @"
# Backlog

Candidate work must be promoted to OpenSpec, docs or the issue tracker before implementation.
"@
  "sessions/index.md" = @"
# Sessions

Imported AI-session continuity notes land here.
"@
}

$result = [ordered]@{
  status = 'ok'
  dry_run = (-not $Apply)
  vault_root = $vaultRoot
  project_root = $projectRoot
  directories = $paths
  notes = @($notes.Keys)
  register_obsidian = [bool] ($Apply -and $RegisterObsidian)
}

if ($Apply) {
  foreach ($pathItem in $paths) { Ensure-Directory -Path $pathItem }
  foreach ($key in $notes.Keys) {
    Ensure-File -Path (Join-Path $projectRoot $key) -Content $notes[$key]
  }
  if ($RegisterObsidian) {
    $obsidianConfigPath = Resolve-ObsidianConfigPath -Config $config
    Register-ObsidianVault -VaultRoot $vaultRoot -ConfigPath $obsidianConfigPath -ProjectSlug $projectSlug
    $result.obsidian_config = $obsidianConfigPath
  }
}

if ($Json) {
  $result | ConvertTo-Json -Depth 8
} else {
  Write-Host "bootstrap-obsidian-vault: dry_run=$($result.dry_run) vault=$vaultRoot"
}
