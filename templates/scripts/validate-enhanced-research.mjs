#!/usr/bin/env node
// Gate de investigacion enriquecida.
//
// Regla: un slice que toca rutas de PRODUCTO debe tener un change OpenSpec
// (activo o archivado). Los cambios puramente operativos (gobernanza, scripts,
// docs de agentes) no lo exigen, porque no alteran capacidades del producto.
//
// Uso: node scripts/validate-enhanced-research.mjs <change-name>
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const changeName = process.argv[2] ?? '';

if (!/^[a-z0-9][a-z0-9._-]*$/i.test(changeName)) {
  console.error(`Enhanced research: ChangeName invalido: "${changeName}"`);
  process.exit(1);
}

const changeDir = path.join('openspec', 'changes', changeName);
const archiveDir = path.join('openspec', 'changes', 'archive');
const integrationBranch = '{{gitFlow.integrationBranch}}';

function hasArchivedChange() {
  if (!fs.existsSync(archiveDir)) return false;
  const suffix = `-${changeName}`;
  return fs
    .readdirSync(archiveDir, { withFileTypes: true })
    .some((entry) => entry.isDirectory() && entry.name.endsWith(suffix));
}

function gitChangedFiles() {
  const candidates = [
    ['diff', '--name-only', `${integrationBranch}...HEAD`],
    ['diff', '--name-only', 'HEAD~1...HEAD'],
  ];

  for (const args of candidates) {
    try {
      return execFileSync('git', args, { encoding: 'utf8' })
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      // Rama de integracion ausente (clone shallow, repo nuevo): probar el siguiente.
    }
  }

  return [];
}

// Rutas operativas: gobernanza y andamiaje del propio SDLC. Cambiarlas no
// modifica capacidades del producto, asi que no exigen change OpenSpec.
const OPERATIONAL_FILES = new Set(['.gitignore', 'package.json', 'pnpm-lock.yaml']);
const OPERATIONAL_PREFIXES = [
  '.github/',
  '.sdlc/',
  '.claude/',
  '.agents/',
  '.windsurf/',
  'scripts/',
  'docs/agents/',
  'docs/guides/',
  'phases/',
];

function isOperationalPath(filePath) {
  return (
    OPERATIONAL_FILES.has(filePath) ||
    OPERATIONAL_PREFIXES.some((prefix) => filePath.startsWith(prefix))
  );
}

const changedFiles = gitChangedFiles();
const hasOpenSpecChange = fs.existsSync(changeDir) || hasArchivedChange();
const nonOperationalFiles = changedFiles.filter((filePath) => !isOperationalPath(filePath));

if (!hasOpenSpecChange && nonOperationalFiles.length > 0) {
  console.error(
    `Enhanced research FAIL: el change "${changeName}" toca rutas de producto sin ${changeDir}:`,
  );
  for (const filePath of nonOperationalFiles) console.error(`- ${filePath}`);
  console.error('Cree el change OpenSpec o limite el slice a rutas operativas.');
  process.exit(1);
}

console.log(
  hasOpenSpecChange
    ? `Enhanced research OK: ${fs.existsSync(changeDir) ? changeDir : 'change archivado'} existe.`
    : `Enhanced research OK: cambio solo operativo (${changedFiles.length} archivos).`,
);
