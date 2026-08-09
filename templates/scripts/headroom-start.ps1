<#
.SYNOPSIS
  Starts the headroom context proxy and verifies its health endpoint.

.DESCRIPTION
  headroom acts as a proxy between the agent and the Anthropic API. This script
  starts it when it is not already running and waits until the health endpoint
  answers.

  Critical rule: if the proxy does not become healthy, this script does NOT
  clear ANTHROPIC_BASE_URL. Silently bypassing the proxy would send traffic
  directly to Anthropic without the user knowing. The failure is recorded in
  $env:APPDATA\headroom\health-last-fail.txt (or ~/.headroom on non-Windows)
  and the script exits with code 1 so the error stays visible.
#>

# opt-in:external
[CmdletBinding()]
param(
  [string] $BaseUrl = 'http://127.0.0.1:8787',
  [int] $Retries = 10,
  [int] $DelaySeconds = 2,
  [switch] $Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$healthUrl = "$($BaseUrl.TrimEnd('/'))/health"

function Test-HeadroomHealth {
  param([string] $Url)
  try {
    $response = Invoke-WebRequest -Uri $Url -TimeoutSec 3 -UseBasicParsing
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 400
  }
  catch {
    return $false
  }
}

function Get-HeadroomStateDir {
  if ($IsWindows -and $env:APPDATA) { return (Join-Path $env:APPDATA 'headroom') }
  return (Join-Path $HOME '.headroom')
}

$result = [ordered]@{
  status = 'unknown'
  health_url = $healthUrl
  started = $false
  already_running = $false
  attempts = 0
}

if (Test-HeadroomHealth -Url $healthUrl) {
  $result.status = 'ok'
  $result.already_running = $true
  if ($Json) { $result | ConvertTo-Json -Depth 5 } else { Write-Host "headroom ya responde en $healthUrl" }
  exit 0
}

$headroomCommand = Get-Command headroom -ErrorAction SilentlyContinue
if ($null -eq $headroomCommand) {
  $result.status = 'missing'
  $message = "headroom no esta instalado. Instalarlo con: npm install -g headroom"
  if ($Json) { $result | ConvertTo-Json -Depth 5 } else { Write-Warning $message }
  exit 1
}

Start-Process -FilePath $headroomCommand.Source -ArgumentList @('proxy', '--no-telemetry') -WindowStyle Hidden | Out-Null
$result.started = $true

for ($attempt = 1; $attempt -le $Retries; $attempt++) {
  $result.attempts = $attempt
  if (Test-HeadroomHealth -Url $healthUrl) {
    $result.status = 'ok'
    if ($Json) { $result | ConvertTo-Json -Depth 5 } else { Write-Host "headroom saludable en $healthUrl (intento $attempt)" }
    exit 0
  }
  Start-Sleep -Seconds $DelaySeconds
}

$stateDir = Get-HeadroomStateDir
if (-not (Test-Path -LiteralPath $stateDir)) {
  New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
}
$failLog = Join-Path $stateDir 'health-last-fail.txt'
$timestamp = (Get-Date).ToString('o')
Set-Content -LiteralPath $failLog -Value "$timestamp headroom no respondio en $healthUrl tras $Retries intentos." -Encoding utf8

$result.status = 'unhealthy'
$result.fail_log = $failLog

if ($Json) {
  $result | ConvertTo-Json -Depth 5
}
else {
  Write-Warning "headroom no respondio en $healthUrl tras $Retries intentos. Registro: $failLog"
  Write-Warning "No se limpia ANTHROPIC_BASE_URL: un bypass silencioso es peor que un fallo visible."
}
exit 1
