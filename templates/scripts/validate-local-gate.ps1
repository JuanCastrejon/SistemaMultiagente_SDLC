param(
  [string] $ChangeName = "",
  [switch] $SkipInstall,
  [switch] $SkipBootstrap,
  [switch] $Strict
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$PackageManager = $null  # resuelto tras definir Resolve-PackageManager
$NotConfiguredScripts = @()

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

function Resolve-PackageManager {
  # El gate no asume pnpm. Orden de resolucion:
  #   1. campo packageManager de package.json (estandar corepack)
  #   2. lockfile presente en el repo
  #   3. pnpm como default historico
  $definitions = @{
    pnpm = @{ Name = "pnpm"; Exe = "corepack"; Run = @("pnpm", "run"); Exec = @("pnpm", "exec"); Install = @("pnpm", "install", "--frozen-lockfile"); Version = @("pnpm", "--version") }
    npm  = @{ Name = "npm";  Exe = "npm";      Run = @("run");         Exec = @("exec", "--");   Install = @("ci");                            Version = @("--version") }
    yarn = @{ Name = "yarn"; Exe = "corepack"; Run = @("yarn", "run"); Exec = @("yarn", "exec"); Install = @("yarn", "install", "--immutable"); Version = @("yarn", "--version") }
    bun  = @{ Name = "bun";  Exe = "bun";      Run = @("run");         Exec = @("x");            Install = @("install", "--frozen-lockfile");   Version = @("--version") }
  }

  $packagePath = Join-Path $RepoRoot "package.json"
  if (Test-Path $packagePath) {
    $packageJson = Get-Content -Raw $packagePath | ConvertFrom-Json
    if ($null -ne $packageJson.packageManager) {
      $declared = ([string] $packageJson.packageManager).Split("@")[0].Trim().ToLowerInvariant()
      if ($definitions.ContainsKey($declared)) {
        $resolved = $definitions[$declared]
        $resolved.Source = "packageManager"
        return $resolved
      }
    }
  }

  foreach ($pair in @(
      @{ Lockfile = "pnpm-lock.yaml";     Manager = "pnpm" },
      @{ Lockfile = "yarn.lock";          Manager = "yarn" },
      @{ Lockfile = "bun.lockb";          Manager = "bun"  },
      @{ Lockfile = "package-lock.json";  Manager = "npm"  }
    )) {
    if (Test-Path (Join-Path $RepoRoot $pair.Lockfile)) {
      $resolved = $definitions[$pair.Manager]
      $resolved.Source = $pair.Lockfile
      return $resolved
    }
  }

  $fallback = $definitions["pnpm"]
  $fallback.Source = "default"
  return $fallback
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

function Invoke-OptionalPackageScript {
  param(
    [Parameter(Mandatory = $true)][hashtable] $Scripts,
    [Parameter(Mandatory = $true)][string] $ScriptName,
    [string[]] $Arguments = @(),
    [int[]] $AllowedExitCodes = @(0)
  )

  if ($Scripts.ContainsKey($ScriptName)) {
    $exe = $PackageManager.Exe
    $runArgs = @($PackageManager.Run) + @($ScriptName)
    if ($Arguments.Count -gt 0) {
      # npm y pnpm requieren el separador -- para pasar argumentos al script.
      $runArgs = $runArgs + @("--") + $Arguments
    }
    $commandText = "$exe $($runArgs -join ' ')"
    Invoke-GateStep $ScriptName $commandText {
      & $exe @runArgs
    } $AllowedExitCodes
    return
  }

  # Ningun `validate:*` lo entrega el framework: son scripts del consumidor. Un
  # -Strict que lanza por su ausencia hace inusable el gate obligatorio en
  # cualquier repo que no los tenga todos. Se registran como NOT_CONFIGURED,
  # igual que hace `sdlc verdict`, y se resumen al final.
  $script:NotConfiguredScripts += $ScriptName
  Write-Warning "Script no configurado: $ScriptName. El consumidor no lo declara en package.json."
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

$PackageManager = Resolve-PackageManager

Push-Location $RepoRoot
try {
  $scripts = Read-PackageScripts
  $dependencyNames = Read-PackageDependencyNames
  $bootstrapScript = Join-Path $RepoRoot "scripts/bootstrap-agent-skills.ps1"

  $pmExe = $PackageManager.Exe
  $pmVersionArgs = @($PackageManager.Version)
  Invoke-GateStep "$($PackageManager.Name) version (detectado por $($PackageManager.Source))" "$pmExe $($pmVersionArgs -join ' ')" {
    & $pmExe @pmVersionArgs
  }

  if (-not $SkipInstall) {
    $pmInstallArgs = @($PackageManager.Install)
    Invoke-GateStep "$($PackageManager.Name) install" "$pmExe $($pmInstallArgs -join ' ')" {
      & $pmExe @pmInstallArgs
    } -Suggestion "Usar -SkipInstall solo para iteracion local; antes de merge ejecutar sin ese flag si cambio el lockfile."
  }

  Invoke-OptionalPackageScript $scripts "validate"
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
    Invoke-OptionalPackageScript $scripts $scriptName
  }

  if ($ChangeName.Trim().Length -gt 0) {
    # .mjs es el artefacto que instala el framework; .js se acepta por
    # compatibilidad con consumidores que lo escribieron a mano antes.
    $enhancedResearchScript = @("scripts/validate-enhanced-research.mjs", "scripts/validate-enhanced-research.js") |
      Where-Object { Test-Path (Join-Path $RepoRoot $_) } |
      Select-Object -First 1

    if ($scripts.ContainsKey("validate:enhanced-research")) {
      Invoke-OptionalPackageScript $scripts "validate:enhanced-research" @($ChangeName)
    }
    elseif ($enhancedResearchScript) {
      Invoke-GateStep "validate-enhanced-research $ChangeName" "node $enhancedResearchScript $ChangeName" {
        node (Join-Path $RepoRoot $enhancedResearchScript) $ChangeName
      }
    }
    elseif ($Strict) {
      throw "No existe validate:enhanced-research ni scripts/validate-enhanced-research.mjs para ChangeName=$ChangeName."
    }
    else {
      Write-Warning "validate:enhanced-research ausente. Omitido en modo portable para ChangeName=$ChangeName."
    }
  }

  if (-not $SkipBootstrap) {
    Invoke-OptionalFileStep "bootstrap-agent-skills" "scripts/bootstrap-agent-skills.ps1" {
      pwsh -NoProfile -ExecutionPolicy Bypass -File $bootstrapScript
    } "pwsh -NoProfile -ExecutionPolicy Bypass -File $bootstrapScript"

    # Los mirrors deben quedar descubribles por Codex despues del bootstrap.
    Invoke-OptionalFileStep "validate-codex-skills" "scripts/validate-codex-skills.mjs" {
      node (Join-Path $RepoRoot "scripts/validate-codex-skills.mjs")
    } "node scripts/validate-codex-skills.mjs"
  }

  if ($dependencyNames -contains "sistema-multiagente-sdlc") {
    $govArgs = @($PackageManager.Exec) + @("sdlc", "governance-check", "--target", ".", "--json")
    Invoke-GateStep "sdlc governance-check" "$pmExe $($govArgs -join " ")" {
      & $pmExe @govArgs
    }

    $toolsArgs = @($PackageManager.Exec) + @("sdlc", "tools-doctor", "--target", ".", "--profile", "full", "--json")
    Invoke-GateStep "sdlc tools-doctor full" "$pmExe $($toolsArgs -join " ")" {
      & $pmExe @toolsArgs
    } @(0, 2)
  }
  elseif ($Strict) {
    throw "Dependencia sistema-multiagente-sdlc ausente; no se pueden ejecutar sdlc governance-check/tools-doctor en modo -Strict."
  }
  else {
    Write-Warning "Dependencia sistema-multiagente-sdlc ausente. Omitidos sdlc governance-check/tools-doctor en modo portable."
  }

  Write-Host ""
  if ($NotConfiguredScripts.Count -gt 0) {
    Write-Host "Scripts no configurados en este consumidor ($($NotConfiguredScripts.Count)): $($NotConfiguredScripts -join ', ')"
    Write-Host "No bloquean el gate: el framework no los entrega, son contrato del consumidor."
  }
  Write-Host "Local gate OK. -Strict exige los artefactos que instala el framework; los validate:* del consumidor se reportan como no configurados."
}
finally {
  Pop-Location
}
