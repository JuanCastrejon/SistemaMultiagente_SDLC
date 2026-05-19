<#
.SYNOPSIS
  Computes calibration agreement from agent-state calibration files.

.DESCRIPTION
  Read-only by default. It scans .github/agent-state/calibration for JSON files
  containing items with expected/actual or reviewer_scores and returns a simple
  agreement score. If no files exist, it emits an empty but successful report.
#>

[CmdletBinding()]
param(
  [double] $KappaThreshold = 0.70,
  [string] $CalibrationDir = '',
  [switch] $Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path $PSScriptRoot -Parent
if (-not $CalibrationDir) {
  $CalibrationDir = Join-Path $RepoRoot '.github\agent-state\calibration'
}

function Read-CalibrationItems {
  param([string] $Root)
  $items = @()
  if (-not (Test-Path -LiteralPath $Root)) { return $items }
  foreach ($file in Get-ChildItem -LiteralPath $Root -Filter '*.json' -File -Recurse) {
    try {
      $json = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
      if ($json.items) {
        foreach ($item in @($json.items)) {
          $items += [ordered]@{ file = $file.FullName; item = $item }
        }
      }
    } catch {
      Write-Warning "Skipping invalid calibration file $($file.FullName): $_"
    }
  }
  return $items
}

$items = @(Read-CalibrationItems -Root $CalibrationDir)
$scored = 0
$matches = 0
foreach ($entry in $items) {
  $item = $entry.item
  if ($null -ne $item.expected -and $null -ne $item.actual) {
    $scored += 1
    if ([string] $item.expected -eq [string] $item.actual) { $matches += 1 }
  } elseif ($item.reviewer_scores -and $item.reviewer_scores.Count -gt 1) {
    $scores = @($item.reviewer_scores | ForEach-Object { [double] $_ })
    $avg = ($scores | Measure-Object -Average).Average
    $variance = (($scores | ForEach-Object { [math]::Pow($_ - $avg, 2) }) | Measure-Object -Average).Average
    $scored += 1
    if ($variance -le 0.05) { $matches += 1 }
  }
}

$agreement = if ($scored -gt 0) { [math]::Round($matches / $scored, 4) } else { 1.0 }
$result = [ordered]@{
  status = if ($agreement -ge $KappaThreshold) { 'ok' } else { 'review' }
  calibration_dir = $CalibrationDir
  items = $items.Count
  scored = $scored
  matches = $matches
  agreement = $agreement
  threshold = $KappaThreshold
}

if ($Json) {
  $result | ConvertTo-Json -Depth 5
} else {
  Write-Host "compute-calibration: agreement=$agreement threshold=$KappaThreshold scored=$scored"
}

if ($agreement -lt $KappaThreshold) { exit 2 }
