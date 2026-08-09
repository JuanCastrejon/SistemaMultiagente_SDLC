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
  # Banda de histeresis para graduar un agente a menor intervencion humana.
  # Un umbral unico produce freeze-flap: un agente recien graduado en el limite
  # se congela por ruido estadistico minimo. Por eso entrada y permanencia son
  # criterios distintos.
  #   >= GraduationThreshold  -> puede graduarse
  #   <  FreezeThreshold      -> freeze
  #   entre ambos             -> zona de observacion: no gradua, no congela
  [double] $GraduationThreshold = 0.80,
  [double] $FreezeThreshold = 0.75,
  # Denominador minimo: sin suficientes muestras no se puede afirmar nada.
  # Cero muestras NO es concordancia perfecta.
  [int] $MinSamples = 10,
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

# Sin muestras no hay concordancia que reportar. Devolver 1.0 aqui (el
# comportamiento anterior) hacia que un repo sin NINGUNA calibracion saliera
# 'ok' con agreement perfecto: el mismo falso verde por denominador vacio que
# los gates de calidad rechazan con min_denominator.
$agreement = if ($scored -gt 0) { [math]::Round($matches / $scored, 4) } else { $null }

$status =
  if ($scored -lt $MinSamples) { 'not-measured' }
  elseif ($agreement -ge $GraduationThreshold) { 'graduated' }
  elseif ($agreement -lt $FreezeThreshold) { 'freeze' }
  else { 'observation' }

$result = [ordered]@{
  status = $status
  calibration_dir = $CalibrationDir
  items = $items.Count
  scored = $scored
  matches = $matches
  agreement = $agreement
  min_samples = $MinSamples
  graduation_threshold = $GraduationThreshold
  freeze_threshold = $FreezeThreshold
  # Que significa cada estado, para que quien lo lea no tenga que adivinar.
  interpretation = switch ($status) {
    'not-measured' { "Solo $scored muestras (minimo $MinSamples). No se puede graduar ni congelar: falta evidencia." }
    'graduated'    { "Concordancia $agreement >= $GraduationThreshold. El agente puede operar con menor intervencion humana en su fase." }
    'freeze'       { "Concordancia $agreement < $FreezeThreshold. El agente vuelve a revision humana explicita." }
    default        { "Concordancia $agreement en zona de observacion [$FreezeThreshold, $GraduationThreshold). No gradua nuevos agentes y no congela a los ya graduados." }
  }
}

if ($Json) {
  $result | ConvertTo-Json -Depth 5
} else {
  $shown = if ($null -eq $agreement) { 'n/a' } else { $agreement }
  Write-Host "compute-calibration: status=$status agreement=$shown scored=$scored (min $MinSamples, graduacion $GraduationThreshold, freeze $FreezeThreshold)"
  Write-Host $result.interpretation
}

# Exit 2 solo en freeze: es el unico estado que exige accion inmediata.
# `not-measured` no es un fallo, es ausencia de datos, y hacerlo fallar
# obligaria a fabricar calibraciones para pasar el gate.
if ($status -eq 'freeze') { exit 2 }
