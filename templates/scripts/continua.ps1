<#
.SYNOPSIS
  Rebuilds SDLC working context and optionally writes the multi-agent lock.

.DESCRIPTION
  Reads .github/agent-state, graphify-out and the optional memory vault so an
  agent can resume the active slice without rebuilding context from raw code.
  By default it writes .github/agent-state/platform-context.json with a TTL lock.
  Use -NoLock for a read-only preview.
#>

[CmdletBinding()]
param(
  [ValidateSet('claude_code', 'codex', 'copilot', 'windsurf')]
  [string] $Platform = 'codex',
  [int] $TtlHours = 4,
  [switch] $NoLock,
  [string] $VaultPath = '',
  [switch] $Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Repo = Split-Path $PSScriptRoot -Parent
$AgentState = Join-Path $Repo '.github\agent-state'
$PlatformContext = Join-Path $AgentState 'platform-context.json'
$CurrentSlicePath = Join-Path $AgentState 'current-slice.md'
$PhaseStatusPath = Join-Path $AgentState 'phase-status.yaml'
$ActiveSlicesPath = Join-Path $AgentState 'active-slices.yaml'
$HandoffsDir = Join-Path $AgentState 'handoffs'
$GraphReportPath = Join-Path $Repo 'graphify-out\GRAPH_REPORT.md'

function Read-TextOrNull {
  param([string] $Path)
  if (Test-Path -LiteralPath $Path) {
    return (Get-Content -LiteralPath $Path -Raw)
  }
  return $null
}

function Get-Preview {
  param([string] $Text, [int] $Max = 700)
  if (-not $Text) { return $null }
  if ($Text.Length -le $Max) { return $Text.Trim() }
  return $Text.Substring(0, $Max).Trim()
}

function Get-LatestFile {
  param([string] $Root, [string] $Filter = '*.md')
  if (-not (Test-Path -LiteralPath $Root)) { return $null }
  $files = @(Get-ChildItem -LiteralPath $Root -Filter $Filter -File -Recurse |
    Where-Object { $_.Name -ne 'TEMPLATE.md' } |
    Sort-Object LastWriteTimeUtc -Descending)
  if ($files.Count -eq 0) { return $null }
  return $files[0]
}

if (-not $VaultPath) {
  $configPath = Join-Path $Repo 'scripts\obsidian-memory.config.local.json'
  if (Test-Path -LiteralPath $configPath) {
    try {
      $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
      if ($config.vaultRoot) { $VaultPath = [string] $config.vaultRoot }
    } catch {
      Write-Warning "No se pudo leer ${configPath}: $_"
    }
  }
}

$now = [datetime]::UtcNow
$expires = $now.AddHours($TtlHours)
$currentSlice = Read-TextOrNull -Path $CurrentSlicePath
$phaseStatus = Read-TextOrNull -Path $PhaseStatusPath
$activeSlices = Read-TextOrNull -Path $ActiveSlicesPath
$graphReport = Read-TextOrNull -Path $GraphReportPath
$latestHandoff = Get-LatestFile -Root $HandoffsDir
$latestVaultCheckpoint = if ($VaultPath) { Get-LatestFile -Root $VaultPath } else { $null }

$sliceId = 'unknown'
$slicePhase = 'unknown'
if ($currentSlice -and $currentSlice -match '`([^`]+)`') {
  $sliceId = $Matches[1]
}
if ($currentSlice -and $currentSlice -match '(F\d+(?:\.\d+)?)') {
  $slicePhase = $Matches[1]
}

$result = [ordered]@{
  status = 'ok'
  project = '{{project.slug}}'
  generated_at = $now.ToString('yyyy-MM-ddTHH:mm:ssZ')
  platform = $Platform
  lock_written = (-not $NoLock)
  lock = [ordered]@{
    owner_platform = $Platform
    locked_at = $now.ToString('yyyy-MM-ddTHH:mm:ssZ')
    expires_at = $expires.ToString('yyyy-MM-ddTHH:mm:ssZ')
    ttl_hours = $TtlHours
  }
  current_slice = [ordered]@{
    id = $sliceId
    phase = $slicePhase
    preview = Get-Preview -Text $currentSlice
  }
  active_slices_preview = Get-Preview -Text $activeSlices
  phase_status_preview = Get-Preview -Text $phaseStatus
  latest_handoff = if ($latestHandoff) { $latestHandoff.FullName } else { $null }
  graph_report = [ordered]@{
    path = $GraphReportPath
    exists = [bool] $graphReport
    preview = Get-Preview -Text $graphReport
  }
  vault_checkpoint = if ($latestVaultCheckpoint) { $latestVaultCheckpoint.FullName } else { $null }
}

if (-not $NoLock) {
  if (-not (Test-Path -LiteralPath $AgentState)) {
    New-Item -ItemType Directory -Path $AgentState -Force | Out-Null
  }
  $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $PlatformContext -Encoding UTF8
}

if ($Json) {
  $result | ConvertTo-Json -Depth 8
  exit 0
}

Write-Host ''
Write-Host 'CONTINUA - SDLC context resume'
Write-Host "Project: {{project.slug}}"
Write-Host "Platform: $Platform"
Write-Host "Slice: $sliceId ($slicePhase)"
Write-Host "Latest handoff: $($result.latest_handoff)"
Write-Host "Vault checkpoint: $($result.vault_checkpoint)"
Write-Host "Graph report: $($result.graph_report.exists)"
if ($NoLock) {
  Write-Host 'Lock: preview only'
} else {
  Write-Host "Lock: written until $($result.lock.expires_at)"
}
