<#
.SYNOPSIS
  Runs the local memory sync pipeline.

.DESCRIPTION
  Default mode prints the plan only. Use -Apply to execute the converter.
  Use -InstallExtractor to opt into installing the optional extractor package.
#>

# opt-in:external
[CmdletBinding()]
param(
  [switch] $Apply,
  [switch] $InstallExtractor,
  [string] $ConfigPath = '',
  [switch] $Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptRoot = $PSScriptRoot
if (-not $ConfigPath) {
  $ConfigPath = Join-Path $ScriptRoot 'obsidian-memory.config.local.json'
}
$ProcessorPath = Join-Path $ScriptRoot 'claude-to-obsidian.py'

function Require-File {
  param([string] $Path, [string] $Description)
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Missing $Description at $Path"
  }
}

$steps = @(
  [ordered]@{ name = 'read-config'; path = $ConfigPath },
  [ordered]@{ name = 'run-converter'; path = $ProcessorPath }
)

if ($InstallExtractor) {
  $steps += [ordered]@{ name = 'install-optional-extractor'; command = 'python -m pip install --user claude-conversation-extractor' }
}

if (-not $Apply) {
  $result = [ordered]@{ status = 'ok'; dry_run = $true; steps = $steps }
  if ($Json) { $result | ConvertTo-Json -Depth 8 } else { Write-Host 'sync-claude-obsidian: dry-run plan emitted. Use -Apply to run.' }
  exit 0
}

Require-File -Path $ConfigPath -Description 'memory config'
Require-File -Path $ProcessorPath -Description 'converter script'

if ($InstallExtractor) {
  python -m pip install --user claude-conversation-extractor | Out-Host
}

$args = @($ProcessorPath, '--config', $ConfigPath, '--apply', '--json')
$converterOutput = & python @args
if ($LASTEXITCODE -ne 0) {
  throw "claude-to-obsidian.py exited with code $LASTEXITCODE"
}

$result = [ordered]@{
  status = 'ok'
  dry_run = $false
  converter = ($converterOutput | ConvertFrom-Json)
}

if ($Json) {
  $result | ConvertTo-Json -Depth 8
} else {
  Write-Host "sync-claude-obsidian: completed sources=$($result.converter.sources)"
}
