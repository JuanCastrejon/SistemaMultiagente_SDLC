<#
.SYNOPSIS
  Thin Windows wrapper for the Node-first continua runtime.
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

$ScriptRoot = $PSScriptRoot
$NodeScript = Join-Path $ScriptRoot 'continua.mjs'
if (-not (Test-Path -LiteralPath $NodeScript)) {
  throw "continua.mjs not found: $NodeScript"
}

$argsList = @($NodeScript, '--platform', $Platform, '--ttl-hours', [string]$TtlHours)
if ($NoLock) { $argsList += '--no-lock' }
if ($Json) { $argsList += '--json' }
if ($VaultPath) { $argsList += @('--vault-path', $VaultPath) }

& node @argsList
exit $LASTEXITCODE
