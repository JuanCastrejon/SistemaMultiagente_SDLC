#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Guard de frontera de especificacion (ADR 0007)
//
// El gauntlet entero se apoya en una suposicion: que la especificacion contra
// la que se juzga al agente no la escribe el agente. Sin este guard, la ruta de
// menor resistencia para pasar cualquier gate es reescribir el criterio.
//
// Que hace: compara el diff contra la rama de integracion REMOTA y falla si
// toca rutas protegidas sin que exista una excepcion declarada.
//
// Que NO hace, y conviene decirlo: no puede probar por si solo que la firma
// humana existio. Eso lo aporta el review de la plataforma. Este script es la
// mitad barata del control; la otra mitad es una regla de proteccion de rama.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_LOCKED = [
  "openspec/specs/",
  "openspec/changes/*/specs/",
  "openspec/changes/*/acceptance/",
  "quality-contract.yaml",
  "phase-contract.yaml",
  ".github/workflows/",
  "vitest.config",
  "stryker.conf",
  ".dependency-cruiser",
  "eslint.config"
];

function parseArgs(argv) {
  const options = { base: null, lockedFile: ".sdlc/locked-paths.txt", allowlist: ".github/agent-state/spec-boundary-allowlist.yaml", json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") options.json = true;
    else if (token === "--base") options.base = argv[++index];
    else if (token === "--locked") options.lockedFile = argv[++index];
    else if (token === "--allowlist") options.allowlist = argv[++index];
  }
  return options;
}

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function resolveBase(explicit) {
  const candidates = [
    explicit,
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : null,
    "origin/develop",
    "origin/main"
  ].filter(Boolean);
  for (const candidate of candidates) {
    // Se resuelve contra la ref REMOTA a proposito: una rama local puede
    // reescribirse para que el diff parezca vacio.
    if (git(["rev-parse", "--verify", "--quiet", candidate])) return candidate;
  }
  return null;
}

function loadLockedPatterns(lockedFile) {
  if (!fs.existsSync(lockedFile)) return DEFAULT_LOCKED;
  return fs
    .readFileSync(lockedFile, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function loadAllowlist(allowlistFile) {
  if (!fs.existsSync(allowlistFile)) return [];
  // Se lee sin dependencia de YAML: solo lineas `- path: <ruta>`.
  return fs
    .readFileSync(allowlistFile, "utf8")
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*-?\s*path:\s*(.+?)\s*$/))
    .filter(Boolean)
    .map((match) => match[1].replace(/^["']|["']$/g, ""));
}

function matchesPattern(filePath, pattern) {
  if (pattern.includes("*")) {
    const regex = new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")}`);
    return regex.test(filePath);
  }
  return filePath === pattern || filePath.startsWith(pattern);
}

const options = parseArgs(process.argv.slice(2));
const base = resolveBase(options.base);
const result = { status: "ok", base, locked: [], violations: [], allowed: [] };

if (!base) {
  result.status = "skipped";
  result.detail = "no hay rama base remota resoluble; el guard no puede comparar contra nada verificable";
  console.log(options.json ? JSON.stringify(result, null, 2) : `spec-boundary: ${result.detail}`);
  process.exit(0);
}

const mergeBase = git(["merge-base", base, "HEAD"]) || base;
// Commits del branch MAS working tree y staged: en CI solo hay commits, pero en
// local el guard tiene que ver el cambio antes de que exista un commit, que es
// justo cuando sirve para algo.
const changed = [
  ...git(["diff", "--name-only", `${mergeBase}...HEAD`]).split(/\r?\n/),
  ...git(["diff", "--name-only"]).split(/\r?\n/),
  ...git(["diff", "--name-only", "--cached"]).split(/\r?\n/)
]
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((value, index, all) => all.indexOf(value) === index);

const lockedPatterns = loadLockedPatterns(options.lockedFile);
const allowlist = loadAllowlist(options.allowlist);
result.locked = lockedPatterns;

for (const file of changed) {
  const pattern = lockedPatterns.find((candidate) => matchesPattern(file, candidate));
  if (!pattern) continue;
  if (allowlist.includes(file)) {
    result.allowed.push({ path: file, pattern });
    continue;
  }
  result.violations.push({ path: file, pattern });
}

if (result.violations.length > 0) {
  result.status = "blocked";
  result.detail = "el diff toca especificacion o configuracion de gates sin excepcion declarada";
}

if (options.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`spec-boundary contra ${base} (merge-base ${mergeBase.slice(0, 12)})`);
  console.log(`archivos comparados: ${changed.length}`);
  if (result.allowed.length > 0) {
    console.log(`excepciones declaradas: ${result.allowed.map((entry) => entry.path).join(", ")}`);
  }
  if (result.violations.length > 0) {
    console.log("VIOLACIONES:");
    for (const violation of result.violations) {
      console.log(`  - ${violation.path} (protegido por ${violation.pattern})`);
    }
    console.log("");
    console.log("Si el cambio es legitimo, debe pasar por revision humana y quedar");
    console.log("declarado en .github/agent-state/spec-boundary-allowlist.yaml.");
  } else {
    console.log("Sin cambios en rutas protegidas.");
  }
}

process.exitCode = result.status === "blocked" ? 2 : 0;
