<#
.SYNOPSIS
  Publishes local SDLC issue drafts to GitHub and records F17 telemetry.

.DESCRIPTION
  Default mode is dry-run. Use -Apply to call gh, update local issue metadata
  and append telemetry.
#>

[CmdletBinding()]
param(
  [string] $Slug = '',
  [switch] $DryRun,
  [switch] $Apply,
  [string] $Repo = '',
  [string] $TelemetryPath = '',
  [switch] $Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path $PSScriptRoot -Parent
$IssuesLocal = Join-Path $RepoRoot '.github\agent-state\issues\local'
$AgentState = Join-Path $RepoRoot '.github\agent-state'
$PlatformContext = Join-Path $AgentState 'platform-context.json'
if (-not $TelemetryPath) {
  $TelemetryPath = Join-Path $AgentState 'telemetry\phase-transitions.jsonl'
}

$IsDryRun = -not $Apply
if ($DryRun) { $IsDryRun = $true }

function Resolve-RepoName {
  if ($Repo) { return $Repo }
  if ($IsDryRun) { return '{{project.organization}}/{{project.slug}}' }
  $gh = Get-Command -Name gh -ErrorAction SilentlyContinue
  if (-not $gh) { throw 'gh CLI no encontrado. Instale gh o ejecute con -DryRun.' }
  $resolved = gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>$null
  if (-not $resolved) { throw 'No se pudo resolver el repo. Use -Repo owner/name.' }
  return $resolved.Trim()
}

function Read-IssueMeta {
  param([string] $IssueDir)
  $metaPath = Join-Path $IssueDir 'meta.json'
  if (-not (Test-Path -LiteralPath $metaPath)) { throw "meta.json no encontrado en $IssueDir" }
  return Get-Content -LiteralPath $metaPath -Raw | ConvertFrom-Json
}

function Read-IssueBody {
  param([string] $IssueDir)
  $bodyPath = Join-Path $IssueDir 'body.md'
  if (Test-Path -LiteralPath $bodyPath) { return Get-Content -LiteralPath $bodyPath -Raw }
  return ''
}

function Emit-Telemetry {
  param([hashtable] $Event)
  if ($IsDryRun) { return }
  $dir = Split-Path -Path $TelemetryPath -Parent
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $Event | ConvertTo-Json -Compress | Add-Content -LiteralPath $TelemetryPath -Encoding UTF8
}

function Publish-OneIssue {
  param([System.IO.DirectoryInfo] $IssueDir, [string] $RepoName)
  $meta = Read-IssueMeta -IssueDir $IssueDir.FullName
  $body = Read-IssueBody -IssueDir $IssueDir.FullName
  $labels = if ($meta.labels) { [string]::Join(',', $meta.labels) } else { '' }
  $assignees = if ($meta.assignees) { [string]::Join(',', $meta.assignees) } else { '' }
  $number = $null

  if ($IsDryRun) {
    return [ordered]@{
      slug = $IssueDir.Name
      action = if ($meta.github_number) { 'update' } else { 'create' }
      title = $meta.title
      labels = $labels
      assignees = $assignees
      github_number = $meta.github_number
    }
  }

  $bodyFile = Join-Path $env:TEMP "publish-trace-$($IssueDir.Name).md"
  $body | Set-Content -LiteralPath $bodyFile -Encoding UTF8
  try {
    $args = @()
    if ($labels) { $args += @('--label', $labels) }
    if ($assignees) { $args += @('--assignee', $assignees) }
    if ($meta.milestone) { $args += @('--milestone', [string] $meta.milestone) }

    if ($meta.github_number) {
      $number = [int] $meta.github_number
      gh issue edit $number --repo $RepoName --body-file $bodyFile @args | Out-Null
    } else {
      $url = gh issue create --repo $RepoName --title $meta.title --body-file $bodyFile @args
      if ($url -match '/(\d+)$') {
        $number = [int] $Matches[1]
        $meta | Add-Member -NotePropertyName github_number -NotePropertyValue $number -Force
        $meta | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $IssueDir.FullName 'meta.json') -Encoding UTF8
      }
    }
  } finally {
    Remove-Item -LiteralPath $bodyFile -Force -ErrorAction SilentlyContinue
  }

  return [ordered]@{
    slug = $IssueDir.Name
    action = if ($meta.github_number) { 'update' } else { 'create' }
    title = $meta.title
    github_number = $number
  }
}

$repoName = Resolve-RepoName
$issueDirs = @()
if (Test-Path -LiteralPath $IssuesLocal) {
  if ($Slug) {
    $target = Join-Path $IssuesLocal $Slug
    if (-not (Test-Path -LiteralPath $target)) { throw "Slug no encontrado: $Slug" }
    $issueDirs = @(Get-Item -LiteralPath $target)
  } else {
    $issueDirs = @(Get-ChildItem -LiteralPath $IssuesLocal -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'meta.json') })
  }
}

$published = @()
$errors = @()
$timestamp = [datetime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
foreach ($dir in $issueDirs) {
  try {
    $item = Publish-OneIssue -IssueDir $dir -RepoName $repoName
    $published += $item
    Emit-Telemetry @{
      kind = 'phase_transition'
      ts = $timestamp
      slice = $dir.Name
      from_phase = 'F16'
      to_phase = 'F17'
      agent = 'publish-trace'
      platform = 'sdlc'
      model = 'n/a'
      outcome = 'success'
      notes = "issue published to $repoName"
    }
  } catch {
    $errors += "$($dir.Name): $_"
  }
}

if (-not $IsDryRun -and (Test-Path -LiteralPath $PlatformContext)) {
  try {
    $context = Get-Content -LiteralPath $PlatformContext -Raw | ConvertFrom-Json
    $context | Add-Member -NotePropertyName last_publish_trace -NotePropertyValue $timestamp -Force
    $context | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $PlatformContext -Encoding UTF8
  } catch {
    Write-Warning "No se pudo actualizar platform-context.json: $_"
  }
}

$result = [ordered]@{
  status = if ($errors.Count -gt 0) { 'error' } else { 'ok' }
  dry_run = $IsDryRun
  repo = $repoName
  processed = $published.Count
  published = $published
  errors = $errors
}

if ($Json) {
  $result | ConvertTo-Json -Depth 8
} else {
  Write-Host "publish-trace: repo=$repoName dry_run=$IsDryRun processed=$($published.Count) errors=$($errors.Count)"
  foreach ($item in $published) { Write-Host "  $($item.action): $($item.slug)" }
  foreach ($errorItem in $errors) { Write-Host "  error: $errorItem" }
}

if ($errors.Count -gt 0) { exit 1 }
