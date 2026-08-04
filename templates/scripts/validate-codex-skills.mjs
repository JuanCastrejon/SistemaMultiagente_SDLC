#!/usr/bin/env node
// Valida que los mirrors de skills sean descubribles por Codex.
//
// Codex lee el PRIMER bloque YAML de SKILL.md como definicion de la skill. Si un
// mirror antepone metadata de gestion (managed: true), tapa el frontmatter real
// y la skill deja de descubrirse. Este validador exige que en los tres mirrors:
//   1. el primer bloque sea el frontmatter real (name coincidente + description),
//   2. la metadata de gestion viva al final como comentarios HTML,
//   3. el hash de source y el cuerpo UTF-8 coincidan con el canonico.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const repo = process.cwd();
const manifestPath = path.join(repo, 'scripts', 'agent-skills.manifest.json');

if (!fs.existsSync(manifestPath)) {
  console.error(`Codex skill validation failed: no existe ${path.relative(repo, manifestPath)}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const skills = manifest.repoGovernedSkills ?? [];
const failures = [];
const mirrorRoots = ['.agents', '.claude', '.windsurf'];

function readFirstFrontmatter(text) {
  const normalized = text.replace(/^﻿/, '');
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match?.[1] ?? null;
}

function fieldValue(frontmatter, field) {
  const match = frontmatter.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  return match?.[1]?.trim().replace(/^["']|["']$/g, '') ?? '';
}

function normalizedBody(text) {
  let normalized = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trimEnd();
  const legacy = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (legacy && /^managed:\s*true$/m.test(legacy[1])) {
    normalized = normalized.slice(legacy[0].length);
  }
  return normalized
    .replace(
      /\n+<!-- sdlc-managed: true -->\n<!-- sdlc-source: .*? -->\n<!-- sdlc-source-sha256: [a-f0-9]+ -->\n<!-- sdlc-body-sha256: [a-f0-9]+ -->\s*$/,
      '',
    )
    .trim();
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function descriptionFromMarkdown(text, fallback) {
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('```') || trimmed.startsWith('---')) {
      continue;
    }
    return trimmed.replaceAll('"', "'");
  }
  return fallback;
}

function expectedMirrorBody(skill, sourceText) {
  const body = sourceText.replace(/^﻿/, '').trimEnd();
  const frontmatter = readFirstFrontmatter(body);
  if (frontmatter && /^name:\s*\S+/m.test(frontmatter) && /^description:\s*\S+/m.test(frontmatter)) {
    return body;
  }
  const fallback = `Skill gobernada por el repo: ${skill}.`;
  return [
    '---',
    `name: ${skill}`,
    `description: "${descriptionFromMarkdown(body, fallback)}"`,
    '---',
    '',
    body,
  ].join('\n');
}

for (const skill of skills) {
  const canonicalPath = path.join(repo, '.github', 'skills', skill, 'SKILL.md');
  if (!fs.existsSync(canonicalPath)) {
    failures.push(`${skill}: missing canonical .github skill`);
    continue;
  }
  const canonicalText = fs.readFileSync(canonicalPath, 'utf8').replace(/^﻿/, '');
  const canonicalBody = normalizedBody(expectedMirrorBody(skill, canonicalText));
  const canonicalHash = sha256(canonicalText);

  for (const mirrorRoot of mirrorRoots) {
    const skillPath = path.join(repo, mirrorRoot, 'skills', skill, 'SKILL.md');
    if (!fs.existsSync(skillPath)) {
      failures.push(`${skill}: missing ${mirrorRoot} mirror`);
      continue;
    }

    const text = fs.readFileSync(skillPath, 'utf8');
    const frontmatter = readFirstFrontmatter(text);
    if (!frontmatter) {
      failures.push(`${skill}: ${mirrorRoot} first block is not YAML frontmatter`);
      continue;
    }

    if (/^managed:\s*true$/m.test(frontmatter)) {
      failures.push(`${skill}: ${mirrorRoot} first frontmatter is managed metadata, not the skill definition`);
    }

    const name = fieldValue(frontmatter, 'name');
    if (name !== skill) {
      failures.push(`${skill}: ${mirrorRoot} expected name "${skill}", got "${name || '<missing>'}"`);
    }

    const description = fieldValue(frontmatter, 'description');
    if (!description) {
      failures.push(`${skill}: ${mirrorRoot} missing first-frontmatter description`);
    }

    if (!/<!-- sdlc-managed: true -->/.test(text)) {
      failures.push(`${skill}: ${mirrorRoot} missing trailing sdlc-managed metadata`);
    }

    const sourceHash = text.match(/<!-- sdlc-source-sha256: ([a-f0-9]+) -->/)?.[1];
    if (sourceHash !== canonicalHash) {
      failures.push(`${skill}: ${mirrorRoot} source hash differs from canonical`);
    }

    if (normalizedBody(text) !== canonicalBody) {
      failures.push(`${skill}: ${mirrorRoot} body differs from canonical UTF-8 content`);
    }
  }
}

if (failures.length > 0) {
  console.error(`Codex skill validation failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Codex skill validation OK: ${skills.length} canonical skills and ${skills.length * mirrorRoots.length} UTF-8 mirrors are equivalent.`,
);
