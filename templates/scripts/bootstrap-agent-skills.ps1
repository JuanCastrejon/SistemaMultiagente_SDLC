<#
.SYNOPSIS
  Mirrors repo-governed skills from .github/skills into agent-specific folders.

.DESCRIPTION
  .github/skills is the canonical source. This script creates managed mirrors in
  .claude/skills, .agents/skills and .windsurf/skills. External skill install is
  disabled by default; use -InstallExternal to opt in.

  Codex discovers skills from the FIRST YAML frontmatter block of SKILL.md, so
  mirrors keep the real skill frontmatter (name, description) first and write the
  managed metadata as trailing HTML comments.
#>

# opt-in:external
[CmdletBinding()]
param(
  [switch] $SkipExternalInstall,
  [switch] $InstallExternal,
  [switch] $Json,
  [switch] $Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path $PSScriptRoot -Parent
$SourceRoot = Join-Path $RepoRoot '.github\skills'
$ManifestPath = Join-Path $PSScriptRoot 'agent-skills.manifest.json'
$MirrorRoots = @(
  Join-Path $RepoRoot '.claude\skills'
  Join-Path $RepoRoot '.agents\skills'
  Join-Path $RepoRoot '.windsurf\skills'
)

function Get-TextSha256 {
  param([string] $Text)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    return [System.BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function Get-BodyHash {
  # Hash de la identidad del cuerpo del mirror, robusto a CRLF/LF y a saltos
  # de linea de cabecera/cola anadidos por Set-Content. Permite distinguir
  # "el source canonico cambio" de "el mirror fue editado a mano".
  param([string] $BodyText)
  return Get-TextSha256 -Text ($BodyText.Replace("`r", '').Trim())
}

function Get-MirrorBodyText {
  param([string] $Text)

  $normalized = $Text.Replace("`r", '').TrimStart([char]0xFEFF).TrimEnd()

  # Legacy mirrors used a managed YAML block before the canonical skill
  # frontmatter. Strip only that wrapper, not the skill's own frontmatter.
  if ($normalized -match '(?s)^---\n(?<header>.*?)\n---\n?') {
    $header = $Matches['header']
    if ($header -match 'managed:\s*true') {
      return [regex]::Replace($normalized, '(?s)^---\n.*?\n---\n?', '', 1)
    }
  }

  # Codex discovers skills from the first YAML frontmatter block. Managed
  # metadata therefore lives in trailing HTML comments so the native frontmatter
  # remains the first block in every mirror.
  return [regex]::Replace(
    $normalized,
    '(?s)\n+<!-- sdlc-managed: true -->\n<!-- sdlc-source: .*? -->\n<!-- sdlc-source-sha256: [a-f0-9]+ -->\n<!-- sdlc-body-sha256: [a-f0-9]+ -->\s*$',
    ''
  )
}

function Get-FirstFrontmatter {
  param([string] $Text)

  $normalized = $Text.Replace("`r", '').TrimStart([char]0xFEFF)
  if ($normalized -match '(?s)^---\n(?<frontmatter>.*?)\n---\n?') {
    return $Matches['frontmatter']
  }
  return $null
}

function Get-DescriptionFromMarkdown {
  param(
    [string] $Text,
    [string] $Fallback
  )

  $lines = @($Text.Replace("`r", '').Split("`n"))
  foreach ($line in $lines) {
    $trimmed = $line.Trim()
    if ($trimmed.Length -eq 0) { continue }
    if ($trimmed.StartsWith('#')) { continue }
    if ($trimmed.StartsWith('```')) { continue }
    if ($trimmed.StartsWith('---')) { continue }
    return $trimmed.Replace('"', "'")
  }
  return $Fallback
}

function Ensure-SkillFrontmatter {
  param(
    [string] $SkillName,
    [string] $SourceText
  )

  $body = $SourceText.TrimEnd()
  $frontmatter = Get-FirstFrontmatter -Text $body
  if (($null -ne $frontmatter) -and ($frontmatter -match '(?m)^name:\s*\S+') -and ($frontmatter -match '(?m)^description:\s*\S+')) {
    return $body
  }

  $description = Get-DescriptionFromMarkdown -Text $body -Fallback "Skill gobernada por el repo: $SkillName."
  return @(
    '---'
    "name: $SkillName"
    "description: ""$description"""
    '---'
    ''
    $body
  ) -join "`n"
}

function Test-ManagedMirrorForSkill {
  param(
    [string] $Text,
    [string] $SkillName
  )

  $escapedSkillName = [regex]::Escape($SkillName)
  return (
    $Text -match '(managed:\s*true|sdlc-managed:\s*true)' -or
    $Text -match "source:\s*\.github/skills/$escapedSkillName/SKILL\.md" -or
    $Text -match "sdlc-source:\s*\.github/skills/$escapedSkillName/SKILL\.md"
  )
}

function Write-Utf8NoBom {
  # Escritura explicita UTF-8 sin BOM: Windows PowerShell 5.1 y PowerShell 7
  # difieren en el default de Set-Content y producian mirrors distintos para
  # tildes y otros caracteres no ASCII.
  param(
    [string] $Path,
    [string] $Text
  )
  $encoding = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($Path, "$Text`n", $encoding)
}

function Read-Utf8Text {
  param([string] $Path)
  return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Read-Manifest {
  if (-not (Test-Path -LiteralPath $ManifestPath)) {
    return [pscustomobject]@{ repoGovernedSkills = @(); externalCollections = @() }
  }
  return Read-Utf8Text -Path $ManifestPath | ConvertFrom-Json
}

function Write-Mirror {
  param(
    [string] $SkillName,
    [string] $SourcePath,
    [string] $TargetRoot
  )
  $sourceText = Read-Utf8Text -Path $SourcePath
  $hash = Get-TextSha256 -Text $sourceText
  $targetDir = Join-Path $TargetRoot $SkillName
  $targetPath = Join-Path $targetDir 'SKILL.md'
  $body = Ensure-SkillFrontmatter -SkillName $SkillName -SourceText $sourceText
  $bodyHash = Get-BodyHash -BodyText $body
  $mirrorText = @(
    $body
    ''
    '<!-- sdlc-managed: true -->'
    "<!-- sdlc-source: .github/skills/$SkillName/SKILL.md -->"
    "<!-- sdlc-source-sha256: $hash -->"
    "<!-- sdlc-body-sha256: $bodyHash -->"
  ) -join "`n"

  if ((Test-Path -LiteralPath $targetPath) -and (-not $Force)) {
    $existing = Read-Utf8Text -Path $targetPath
    if (-not (Test-ManagedMirrorForSkill -Text $existing -SkillName $SkillName)) {
      return [ordered]@{ target = $targetPath; status = 'skipped'; reason = 'unmanaged file exists' }
    }
    # Drift real solo si el CUERPO actual del mirror difiere del body_sha256 que
    # se registro al escribirlo. Si coincide, el mirror esta intacto y es seguro
    # sobrescribir aunque el source canonico haya cambiado (source_sha256 != $hash).
    # Mirrors legacy sin body_sha256 se re-sellan (caen al write).
    if ($existing -match '(?:body_sha256|sdlc-body-sha256):\s*([a-f0-9]+)') {
      $recordedBodyHash = $Matches[1]
      $existingBody = Get-MirrorBodyText -Text $existing
      $existingBodyHash = Get-BodyHash -BodyText $existingBody
      if (($existingBodyHash -ne $recordedBodyHash) -and ($existingBodyHash -ne $bodyHash)) {
        return [ordered]@{ target = $targetPath; status = 'skipped'; reason = 'managed mirror has local drift' }
      }
    }
  }

  if (-not (Test-Path -LiteralPath $targetDir)) {
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
  }
  Write-Utf8NoBom -Path $targetPath -Text $mirrorText
  return [ordered]@{ target = $targetPath; status = 'written'; reason = $null }
}

$manifest = Read-Manifest
if (-not (Test-Path -LiteralPath $SourceRoot)) {
  throw "Canonical skill source not found: $SourceRoot"
}

$skills = @(Get-ChildItem -LiteralPath $SourceRoot -Directory | Sort-Object Name)
if ($manifest.repoGovernedSkills.Count -gt 0) {
  $allowed = [System.Collections.Generic.HashSet[string]]::new([string[]] $manifest.repoGovernedSkills)
  $skills = @($skills | Where-Object { $allowed.Contains($_.Name) })
}

$results = @()
foreach ($skill in $skills) {
  $sourcePath = Join-Path $skill.FullName 'SKILL.md'
  if (-not (Test-Path -LiteralPath $sourcePath)) { continue }
  foreach ($root in $MirrorRoots) {
    $results += Write-Mirror -SkillName $skill.Name -SourcePath $sourcePath -TargetRoot $root
  }
}

$external = [ordered]@{ attempted = $false; installed = @(); skipped = @() }
if ($InstallExternal -and -not $SkipExternalInstall) {
  $external.attempted = $true
  $npx = Get-Command -Name npx -ErrorAction SilentlyContinue
  if (-not $npx) { throw 'npx no encontrado; no se pueden instalar skills externas.' }
  foreach ($collection in @($manifest.externalCollections)) {
    foreach ($skill in @($collection.skills)) {
      $external.installed += $skill.name
      & $npx.Source --yes $collection.source add $skill.name
    }
  }
} else {
  foreach ($collection in @($manifest.externalCollections)) {
    foreach ($skill in @($collection.skills)) { $external.skipped += $skill.name }
  }
}

$crossResults = @()
if ($manifest.PSObject.Properties.Name -contains 'crossMirrorSkills') {
  $repoRootFull = [IO.Path]::GetFullPath($RepoRoot)
  $sep = [IO.Path]::DirectorySeparatorChar

  foreach ($entry in @($manifest.crossMirrorSkills)) {
    $fromRootRel = $entry.fromRoot
    if ($fromRootRel -match '^[a-zA-Z]:' -or $fromRootRel -match '^\\\\' -or $fromRootRel -match '(^|[/\\])\.\.([/\\]|$)') {
      Write-Warning "[cross-mirror] fromRoot '$fromRootRel' no es ruta relativa segura — omitida."
      continue
    }
    $fromRoot = [IO.Path]::GetFullPath((Join-Path $RepoRoot $fromRootRel.Replace('/', $sep)))
    if (-not $fromRoot.StartsWith($repoRootFull, [StringComparison]::OrdinalIgnoreCase)) {
      Write-Warning "[cross-mirror] fromRoot '$fromRootRel' resuelve fuera del repo — omitida."
      continue
    }
    foreach ($toRootRel in @($entry.toRoots)) {
      if ($toRootRel -match '^[a-zA-Z]:' -or $toRootRel -match '^\\\\' -or $toRootRel -match '(^|[/\\])\.\.([/\\]|$)') {
        Write-Warning "[cross-mirror] toRoot '$toRootRel' no es ruta relativa segura — omitida."
        continue
      }
      $toRoot = [IO.Path]::GetFullPath((Join-Path $RepoRoot $toRootRel.Replace('/', $sep)))
      if (-not $toRoot.StartsWith($repoRootFull, [StringComparison]::OrdinalIgnoreCase)) {
        Write-Warning "[cross-mirror] toRoot '$toRootRel' resuelve fuera del repo — omitida."
        continue
      }
      foreach ($skillName in @($entry.skills)) {
        $srcPath = Join-Path (Join-Path $fromRoot $skillName) 'SKILL.md'
        $targetDir = Join-Path $toRoot $skillName
        $targetPath = Join-Path $targetDir 'SKILL.md'
        if (-not (Test-Path -LiteralPath $srcPath)) {
          $crossResults += [ordered]@{ target = $targetPath; status = 'skipped'; reason = 'source not found' }
          continue
        }
        if (Test-Path -LiteralPath $targetPath) {
          $existing = Read-Utf8Text -Path $targetPath
          if ($existing -notmatch 'cross-mirror:\s*true') {
            $crossResults += [ordered]@{ target = $targetPath; status = 'skipped'; reason = 'unmanaged file exists' }
            continue
          }
        }
        $sourceText = Read-Utf8Text -Path $srcPath
        if (-not (Test-Path -LiteralPath $targetDir)) {
          New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
        }
        $mirrorText = @(
          '---'
          'cross-mirror: true'
          "from: $($entry.fromRoot)/$skillName/SKILL.md"
          '---'
          ''
          $sourceText.TrimEnd()
          ''
        ) -join "`n"
        Write-Utf8NoBom -Path $targetPath -Text $mirrorText
        $crossResults += [ordered]@{ target = $targetPath; status = 'written'; reason = $null }
      }
    }
  }
}

$payload = [ordered]@{
  status = 'ok'
  source = $SourceRoot
  mirrors = $results
  external = $external
  crossMirror = $crossResults
}

if ($Json) {
  $payload | ConvertTo-Json -Depth 8
} else {
  $written = @($results | Where-Object { $_.status -eq 'written' }).Count
  $skipped = @($results | Where-Object { $_.status -eq 'skipped' }).Count
  $crossWritten = @($crossResults | Where-Object { $_.status -eq 'written' }).Count
  $crossSkipped = @($crossResults | Where-Object { $_.status -eq 'skipped' }).Count
  Write-Host "bootstrap-agent-skills: written=$written skipped=$skipped external_attempted=$($external.attempted) cross_written=$crossWritten cross_skipped=$crossSkipped"
}
