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
  ".github/agent-state/quality-baseline.yaml",
  ".github/workflows/",
  "vitest.config",
  "stryker.conf",
  ".dependency-cruiser",
  "eslint.config"
];

// Rutas que el guard protege SIEMPRE, sin importar que diga locked-paths.txt
// ni ningun otro archivo de configuracion. Sin esto, la ruta mas barata para
// desactivar el guard entero no es tocar una ruta protegida (eso se detecta):
// es reescribir el script del guard, vaciar su propia lista de rutas
// protegidas, o agregarse a mano a su propia allowlist. Ninguna de esas tres
// cosas dejaria rastro si el guard no se incluyera a si mismo en su alcance.
const ALWAYS_LOCKED = [
  "scripts/validate-spec-boundary.mjs",
  ".sdlc/locked-paths.txt",
  ".github/agent-state/spec-boundary-allowlist.yaml"
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

// `lockedFile` EXTIENDE la proteccion, nunca la reemplaza. Antes, un
// locked-paths.txt custom sustituia DEFAULT_LOCKED entero: un consumidor que
// queria agregar una ruta propia perdia sin darse cuenta la proteccion de
// quality-contract.yaml, phase-contract.yaml y el resto -- el mismo modo de
// fallo por vacio silencioso que el resto del gauntlet combate. ALWAYS_LOCKED
// tampoco se puede excluir desde este archivo bajo ninguna circunstancia.
function loadLockedPatterns(lockedFile) {
  const custom = fs.existsSync(lockedFile)
    ? fs
        .readFileSync(lockedFile, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
    : [];
  return [...new Set([...ALWAYS_LOCKED, ...DEFAULT_LOCKED, ...custom])];
}

// Lee un archivo desde la rama base REMOTA, nunca del checkout. Si no existe
// alli (o `git show` falla por cualquier motivo), devuelve null: quien llama
// debe interpretarlo como "sin contenido", nunca caer al checkout.
function readFromBase(base, filePath) {
  try {
    return execFileSync("git", ["show", `${base}:${filePath}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

// Se parsea sin dependencia de YAML: solo lineas `- path: <ruta>`.
function parseAllowlistEntries(raw) {
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*-?\s*path:\s*(.+?)\s*$/))
    .filter(Boolean)
    .map((match) => match[1].replace(/^["']|["']$/g, ""));
}

// El allowlist se lee SIEMPRE de la rama base, NUNCA del checkout evaluado.
//
// Esta es la asimetria que hace que el guard funcione, y no es simetrica con
// `loadLockedPatterns` a proposito: `locked-paths.txt` solo puede EXTENDER la
// proteccion (es union con ALWAYS_LOCKED y DEFAULT_LOCKED), asi que leerlo del
// checkout es inofensivo -- lo peor que puede hacer un atacante es protegerse
// mas. El allowlist hace exactamente lo contrario: EXCLUYE de proteccion.
//
// Leerlo del checkout permitia este ataque, reproducido empiricamente antes de
// este fix, en UN SOLO commit:
//   1. reescribir un archivo protegido (ej. openspec/specs/algo/spec.md);
//   2. en el mismo commit, agregar al allowlist dos entradas: una que autoriza
//      ese archivo y otra que autoriza el propio allowlist (autorreferencial).
// El guard reportaba `status: ok, violations: []` con ambos archivos en
// `allowed`: el evaluado se estaba firmando su propio permiso. Que CI trajera
// el SCRIPT del guard desde origin no ayudaba, porque el script confiable
// seguia leyendo los DATOS del checkout atacante-controlado.
//
// Leyendolo de la base, una entrada nueva no tiene efecto en el PR que la
// introduce: solo cuenta despues de estar mergeada en la rama de integracion,
// que es precisamente el gate humano que este control existe para forzar. El
// allowlist sigue ademas en ALWAYS_LOCKED, asi que tocarlo se reporta como
// violacion y exige la revision humana de la plataforma.
function loadAllowlist(base, allowlistFile) {
  return parseAllowlistEntries(readFromBase(base, allowlistFile));
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
// Commits del branch MAS working tree, staged Y sin trackear: `git diff` por
// si solo es ciego a un archivo nuevo que nunca se agrego al indice. Sin la
// linea de `status`, crear `.sdlc/locked-paths.txt` o un spec nuevo sin hacer
// `git add` pasaba el guard en silencio -- el mismo modo de fallo por vacio
// que el resto del gauntlet, aplicado al propio guard.
const changed = [
  ...git(["diff", "--name-only", `${mergeBase}...HEAD`]).split(/\r?\n/),
  ...git(["diff", "--name-only"]).split(/\r?\n/),
  ...git(["diff", "--name-only", "--cached"]).split(/\r?\n/),
  ...git(["status", "--porcelain", "--untracked-files=all"])
    .split(/\r?\n/)
    .filter((line) => line.startsWith("?? "))
    .map((line) => line.slice(3))
]
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((value, index, all) => all.indexOf(value) === index);

const lockedPatterns = loadLockedPatterns(options.lockedFile);
// `base`, no el checkout: ver el comentario largo en loadAllowlist.
const allowlist = loadAllowlist(base, options.allowlist);
result.locked = lockedPatterns;
result.allowlistSource = `${base}:${options.allowlist}`;
result.allowlistEntries = allowlist.length;

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
