param(
  [string] $ChangeName = "",
  [switch] $SkipInstall,
  [switch] $SkipBootstrap
)

$ErrorActionPreference = "Stop"

function Invoke-GateStep {
  param(
    [Parameter(Mandatory = $true)][string] $Name,
    [Parameter(Mandatory = $true)][scriptblock] $Command,
    [int[]] $AllowedExitCodes = @(0)
  )

  Write-Host ""
  Write-Host "==> $Name"
  & $Command
  $exitCode = if ($null -eq $global:LASTEXITCODE) { 0 } else { $global:LASTEXITCODE }
  if ($AllowedExitCodes -notcontains $exitCode) {
    throw "Gate step failed: $Name (exit=$exitCode)"
  }
  $global:LASTEXITCODE = 0
}

Invoke-GateStep "pnpm version" { corepack pnpm --version }

if (-not $SkipInstall) {
  Invoke-GateStep "pnpm install --frozen-lockfile" { corepack pnpm install --frozen-lockfile }
}

Invoke-GateStep "validate:control-plane" { corepack pnpm run validate:control-plane }
Invoke-GateStep "validate:drift" { corepack pnpm run validate:drift }
Invoke-GateStep "validate:slice-traceability" { corepack pnpm run validate:slice-traceability }
Invoke-GateStep "validate:surface-traceability" { corepack pnpm run validate:surface-traceability }
Invoke-GateStep "validate:semantic-guardrails" { corepack pnpm run validate:semantic-guardrails }
Invoke-GateStep "validate:active-slices" { corepack pnpm run validate:active-slices }
Invoke-GateStep "validate:adr-integrity" { corepack pnpm run validate:adr-integrity }
Invoke-GateStep "validate:openspec" { corepack pnpm run validate:openspec }

if ($ChangeName.Trim().Length -gt 0) {
  Invoke-GateStep "validate-enhanced-research $ChangeName" {
    node scripts/validate-enhanced-research.js $ChangeName
  }
}

if (-not $SkipBootstrap) {
  Invoke-GateStep "bootstrap-agent-skills" {
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap-agent-skills.ps1
  }
}

Invoke-GateStep "sdlc governance-check" {
  corepack pnpm exec sdlc governance-check --target . --json
}

Invoke-GateStep "sdlc tools-doctor full" {
  corepack pnpm exec sdlc tools-doctor --target . --profile full --json
} @(0, 2)

Write-Host ""
Write-Host "Local gate OK. qa-security-review debe revisar esta evidencia antes de push/PR."
