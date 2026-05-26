param(
  [string] $ChangeName = "",
  [switch] $SkipInstall,
  [switch] $SkipBootstrap,
  [switch] $Strict
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

function Invoke-GateStep {
  param(
    [Parameter(Mandatory = $true)][string] $Name,
    [Parameter(Mandatory = $true)][string] $CommandText,
    [Parameter(Mandatory = $true)][scriptblock] $Command,
    [int[]] $AllowedExitCodes = @(0),
    [string] $Suggestion = ""
  )

  Write-Host ""
  Write-Host "==> $Name"
  Write-Host "    $CommandText"
  & $Command
  $exitCode = if ($null -eq $global:LASTEXITCODE) { 0 } else { $global:LASTEXITCODE }
  if ($AllowedExitCodes -notcontains $exitCode) {
    $message = "Gate step failed: $Name (exit=$exitCode). Command: $CommandText"
    if ($Suggestion.Trim().Length -gt 0) {
      $message = "$message. Sugerencia: $Suggestion"
    }
    throw $message
  }
  $global:LASTEXITCODE = 0
}

function Read-PackageScripts {
  $packagePath = Join-Path $RepoRoot "package.json"
  if (-not (Test-Path $packagePath)) {
    return @{}
  }

  $packageJson = Get-Content -Raw $packagePath | ConvertFrom-Json
  if ($null -eq $packageJson.scripts) {
    return @{}
  }

  $scripts = @{}
  foreach ($property in $packageJson.scripts.PSObject.Properties) {
    $scripts[$property.Name] = [string] $property.Value
  }
  return $scripts
}

function Read-PackageDependencyNames {
  $packagePath = Join-Path $RepoRoot "package.json"
  if (-not (Test-Path $packagePath)) {
    return @()
  }

  $packageJson = Get-Content -Raw $packagePath | ConvertFrom-Json
  $names = New-Object System.Collections.Generic.List[string]
  foreach ($section in @("dependencies", "devDependencies", "optionalDependencies")) {
    $deps = $packageJson.$section
    if ($null -ne $deps) {
      foreach ($property in $deps.PSObject.Properties) {
        $names.Add($property.Name)
      }
    }
  }
  return $names
}

function Invoke-OptionalPnpmScript {
  param(
    [Parameter(Mandatory = $true)][hashtable] $Scripts,
    [Parameter(Mandatory = $true)][string] $ScriptName,
    [string[]] $Arguments = @(),
    [int[]] $AllowedExitCodes = @(0)
  )

  if ($Scripts.ContainsKey($ScriptName)) {
    $suffix = if ($Arguments.Count -gt 0) { " $($Arguments -join ' ')" } else { "" }
    if ($Arguments.Count -gt 0) {
      Invoke-GateStep $ScriptName "corepack pnpm run $ScriptName$suffix" {
        corepack pnpm run $ScriptName @Arguments
      } $AllowedExitCodes
    }
    else {
      Invoke-GateStep $ScriptName "corepack pnpm run $ScriptName" {
        corepack pnpm run $ScriptName
      } $AllowedExitCodes
    }
    return
  }

  $message = "Script npm ausente: $ScriptName"
  if ($Strict) {
    throw "$message. En modo -Strict debe existir en package.json."
  }
  Write-Warning "$message. Omitido en modo portable."
}

function Invoke-OptionalFileStep {
  param(
    [Parameter(Mandatory = $true)][string] $Name,
    [Parameter(Mandatory = $true)][string] $RelativePath,
    [Parameter(Mandatory = $true)][scriptblock] $Command,
    [string] $CommandText
  )

  $absolutePath = Join-Path $RepoRoot $RelativePath
  if (Test-Path $absolutePath) {
    Invoke-GateStep $Name $CommandText $Command
    return
  }

  $message = "Archivo ausente: $RelativePath"
  if ($Strict) {
    throw "$message. En modo -Strict debe existir."
  }
  Write-Warning "$message. Omitido en modo portable."
}

Push-Location $RepoRoot
try {
  $scripts = Read-PackageScripts
  $dependencyNames = Read-PackageDependencyNames
  $bootstrapScript = Join-Path $RepoRoot "scripts/bootstrap-agent-skills.ps1"

  Invoke-GateStep "pnpm version" "corepack pnpm --version" { corepack pnpm --version }

  if (-not $SkipInstall) {
    Invoke-GateStep "pnpm install --frozen-lockfile" "corepack pnpm install --frozen-lockfile" {
      corepack pnpm install --frozen-lockfile
    } -Suggestion "Usar -SkipInstall solo para iteracion local; antes de merge ejecutar sin ese flag si cambio el lockfile."
  }

  Invoke-OptionalPnpmScript $scripts "validate"
  foreach ($scriptName in @(
    "validate:control-plane",
    "validate:drift",
    "validate:slice-traceability",
    "validate:surface-traceability",
    "validate:semantic-guardrails",
    "validate:active-slices",
    "validate:adr-integrity",
    "validate:openspec"
  )) {
    Invoke-OptionalPnpmScript $scripts $scriptName
  }

  if ($ChangeName.Trim().Length -gt 0) {
    if ($scripts.ContainsKey("validate:enhanced-research")) {
      Invoke-OptionalPnpmScript $scripts "validate:enhanced-research" @($ChangeName)
    }
    elseif (Test-Path (Join-Path $RepoRoot "scripts/validate-enhanced-research.js")) {
      Invoke-GateStep "validate-enhanced-research $ChangeName" "node scripts/validate-enhanced-research.js $ChangeName" {
        node (Join-Path $RepoRoot "scripts/validate-enhanced-research.js") $ChangeName
      }
    }
    elseif ($Strict) {
      throw "No existe validate:enhanced-research ni scripts/validate-enhanced-research.js para ChangeName=$ChangeName."
    }
    else {
      Write-Warning "validate:enhanced-research ausente. Omitido en modo portable para ChangeName=$ChangeName."
    }
  }

  if (-not $SkipBootstrap) {
    Invoke-OptionalFileStep "bootstrap-agent-skills" "scripts/bootstrap-agent-skills.ps1" {
      pwsh -NoProfile -ExecutionPolicy Bypass -File $bootstrapScript
    } "pwsh -NoProfile -ExecutionPolicy Bypass -File $bootstrapScript"
  }

  if ($dependencyNames -contains "sistema-multiagente-sdlc") {
    Invoke-GateStep "sdlc governance-check" "corepack pnpm exec sdlc governance-check --target . --json" {
      corepack pnpm exec sdlc governance-check --target . --json
    }

    Invoke-GateStep "sdlc tools-doctor full" "corepack pnpm exec sdlc tools-doctor --target . --profile full --json" {
      corepack pnpm exec sdlc tools-doctor --target . --profile full --json
    } @(0, 2)
  }
  elseif ($Strict) {
    throw "Dependencia sistema-multiagente-sdlc ausente; no se pueden ejecutar sdlc governance-check/tools-doctor en modo -Strict."
  }
  else {
    Write-Warning "Dependencia sistema-multiagente-sdlc ausente. Omitidos sdlc governance-check/tools-doctor en modo portable."
  }

  Write-Host ""
  Write-Host "Local gate OK. En modo portable, los checks ausentes se omiten con warning; usar -Strict para repos maduros."
}
finally {
  Pop-Location
}
