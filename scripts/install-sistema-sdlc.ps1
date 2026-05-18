param(
  [Parameter(Mandatory = $true)]
  [string]$Target,
  [ValidateSet('greenfield', 'legacy')]
  [string]$Mode = 'greenfield',
  [string]$ProjectName = '',
  [string]$ProjectSlug = '',
  [switch]$DryRun,
  [switch]$Json
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Path $PSScriptRoot -Parent
$argsList = @((Join-Path $repoRoot 'bin\sdlc.js'), 'install', '--target', $Target, '--mode', $Mode)

if ($ProjectName) { $argsList += @('--project-name', $ProjectName) }
if ($ProjectSlug) { $argsList += @('--project-slug', $ProjectSlug) }
if ($DryRun) { $argsList += '--dry-run' }
if ($Json) { $argsList += '--json' }

node @argsList
exit $LASTEXITCODE
