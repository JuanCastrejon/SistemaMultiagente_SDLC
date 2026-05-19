<#
.SYNOPSIS
  Registers a Windows scheduled task for the memory sync pipeline.

.DESCRIPTION
  Default mode is dry-run. Use -Apply to register the task.
#>

# opt-in:external
[CmdletBinding()]
param(
  [switch] $DryRun,
  [switch] $Apply,
  [string] $TaskName = '{{project.slug}}-sdlc-memory-sync',
  [string] $ScheduleTime = '22:00',
  [switch] $Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptRoot = $PSScriptRoot
$SyncScriptPath = Join-Path $ScriptRoot 'sync-claude-obsidian.ps1'
$IsDryRun = -not $Apply
if ($DryRun) { $IsDryRun = $true }

$plan = [ordered]@{
  status = 'ok'
  dry_run = $IsDryRun
  task_name = $TaskName
  schedule_time = $ScheduleTime
  script = $SyncScriptPath
}

if ($IsDryRun) {
  if ($Json) { $plan | ConvertTo-Json -Depth 5 } else { Write-Host "register-claude-sync-task: dry-run task=$TaskName time=$ScheduleTime" }
  exit 0
}

if (-not $IsWindows) {
  throw 'Register-ScheduledTask is only available on Windows. Use dry-run on non-Windows systems.'
}
if (-not (Test-Path -LiteralPath $SyncScriptPath)) {
  throw "Sync script not found: $SyncScriptPath"
}

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$SyncScriptPath`" -Apply"
$trigger = New-ScheduledTaskTrigger -Daily -At $ScheduleTime
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Description 'Syncs repo-scoped multi-agent memory into the configured local vault.' -Force | Out-Null

$plan.registered = $true
if ($Json) { $plan | ConvertTo-Json -Depth 5 } else { Write-Host "register-claude-sync-task: registered $TaskName" }
