<#
.SYNOPSIS
  Registers a Windows scheduled task that starts the headroom proxy at logon.

.DESCRIPTION
  Default mode is dry-run. Use -Apply to register the task.

  Without this task, Codex and VS Code/Copilot do not start headroom
  automatically; Claude Code does it through its SessionStart hook.
#>

# opt-in:external
[CmdletBinding()]
param(
  [switch] $DryRun,
  [switch] $Apply,
  [string] $TaskName = '{{project.slug}}-Headroom-Autostart',
  [switch] $Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptRoot = $PSScriptRoot
$StartScriptPath = Join-Path $ScriptRoot 'headroom-start.ps1'
$IsDryRun = -not $Apply
if ($DryRun) { $IsDryRun = $true }

$plan = [ordered]@{
  status = 'ok'
  dry_run = $IsDryRun
  task_name = $TaskName
  trigger = 'AtLogOn'
  script = $StartScriptPath
}

if ($IsDryRun) {
  if ($Json) { $plan | ConvertTo-Json -Depth 5 } else { Write-Host "register-headroom-task: dry-run task=$TaskName script=$StartScriptPath" }
  exit 0
}

if (-not $IsWindows) {
  throw 'Register-ScheduledTask is only available on Windows. Use dry-run on non-Windows systems.'
}
if (-not (Test-Path -LiteralPath $StartScriptPath)) {
  throw "headroom start script not found: $StartScriptPath"
}

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$StartScriptPath`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Description 'Starts the headroom context proxy at logon for the multi-agent SDLC harness.' -Force | Out-Null

$plan.status = 'registered'
if ($Json) { $plan | ConvertTo-Json -Depth 5 } else { Write-Host "register-headroom-task: registrado task=$TaskName" }
exit 0
