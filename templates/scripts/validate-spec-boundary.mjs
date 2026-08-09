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
  // El ledger de lecciones lo escribe el propio evaluado y guarda sus errores.
  // Sin protegerlo, borrar el historial de las piedras con las que uno tropezo
  // es un `rm` que nadie ve — la memoria institucional que el ADR 025 pide se
  // evapora justo cuando conviene que exista.
  ".github/agent-state/lessons.yaml",
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

// Cuatro decisiones de esta funcion, todas por hallazgos reproducidos en la
// auditoria adversarial sobre la lista `changed` que alimenta el guard:
//
// 1. `core.quotePath=false`: por defecto git entrecomilla y escapa en octal
//    cualquier ruta con byte no-ASCII (`"openspec/specs/facturaci\303\263n/..."`).
//    `matchesPattern` compara con startsWith, asi que la comilla inicial rompia
//    el prefijo y el archivo quedaba fuera del guard. En un framework cuyo
//    corpus entero esta en espanol, un solo directorio con tilde bastaba.
// 2. `maxBuffer` amplio: el default de Node es 1 MiB y `execFileSync` lanza
//    ENOBUFS al superarlo. Con el catch de abajo tragandose el error, un PR
//    grande dejaba el diff en CERO rutas y el guard seguia como si nada.
// 3. El fallo se DEVUELVE, no se traga: quien llama decide. Para los diffs, no
//    poder medir no puede parecerse a no tener nada que reportar.
// 4. Sin `allowFailure`, un error es un error. `resolveBase` si lo usa, porque
//    ahi probar refs que no existen es el modo normal de operar.
function git(args, { allowFailure = false } = {}) {
  try {
    const stdout = execFileSync("git", ["-c", "core.quotePath=false", ...args], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    });
    return { ok: true, stdout: stdout.trim(), error: null };
  } catch (error) {
    return { ok: allowFailure, stdout: "", error };
  }
}

// Azucar para los sitios donde solo interesa el texto y el fallo ya se manejo.
function gitText(args) {
  return git(args, { allowFailure: true }).stdout;
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
    if (gitText(["rev-parse", "--verify", "--quiet", candidate])) return candidate;
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
  const result = git(["show", `${base}:${filePath}`], { allowFailure: true });
  // Ausente en la base = sin excepciones. Nunca se cae al checkout.
  return result.error ? null : result.stdout;
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
  // Antes esto era `skipped` con exit 0: verde. El propio detail admitia que
  // "no puede comparar contra nada verificable" y aun asi devolvia exito —
  // el patron "no se pudo medir se ve igual que todo bien" que el ADR 0007
  // prohibe, en el control que sostiene todos los demas. Un guard que no
  // puede hacer su trabajo bloquea; desbloquearlo es una decision humana.
  result.status = "blocked";
  result.code = "spec-boundary-base-unresolvable";
  result.detail =
    "no hay rama base remota resoluble; el guard no puede comparar contra nada verificable. Verificar que el checkout traiga la rama de integracion (fetch-depth: 0) y que gitFlow.integrationBranch coincida con la rama real.";
  console.log(options.json ? JSON.stringify(result, null, 2) : `spec-boundary: ${result.detail}`);
  process.exit(2);
}

const mergeBase = gitText(["merge-base", base, "HEAD"]) || base;
// Commits del branch MAS working tree, staged Y sin trackear: `git diff` por
// si solo es ciego a un archivo nuevo que nunca se agrego al indice. Sin la
// linea de `status`, crear `.sdlc/locked-paths.txt` o un spec nuevo sin hacer
// `git add` pasaba el guard en silencio -- el mismo modo de fallo por vacio
// que el resto del gauntlet, aplicado al propio guard.
// `--no-renames` NO es cosmetico. Con la deteccion de renames que git trae
// activa por defecto, `--name-only` imprime SOLO la ruta destino de un par
// renombrado y la ruta ORIGEN desaparece de la salida. Eso permitia sacar
// cualquier archivo protegido de su ruta protegida sin dejar rastro:
// `git mv openspec/specs/algo/spec.md notas/archivo.md` daba `status: ok,
// violations: 0` — reproducido. Vaciaba el control entero, incluida su propia
// autoproteccion: los tres archivos de ALWAYS_LOCKED se podian mover igual.
// Con `--no-renames`, git reporta el par como borrado + alta y ambas rutas
// entran a `changed`.
const diffSources = [
  ["diff", "--no-renames", "--name-only", `${mergeBase}...HEAD`],
  ["diff", "--no-renames", "--name-only"],
  ["diff", "--no-renames", "--name-only", "--cached"]
];

const collected = [];
const diffFailures = [];
for (const args of diffSources) {
  const result = git(args);
  if (!result.ok) {
    // No poder medir NO puede parecerse a no tener nada que reportar: esa es
    // la regla de no-vacuidad del ADR 0007 aplicada al propio guard. Antes,
    // un `git()` que se tragaba el error dejaba el diff en cero rutas y el
    // guard seguia en verde — autoinfligible por el evaluado con solo hacer
    // el PR lo bastante grande para desbordar el buffer.
    diffFailures.push({ command: `git ${args.join(" ")}`, detail: result.error?.message ?? "fallo desconocido" });
    continue;
  }
  collected.push(...result.stdout.split(/\r?\n/));
}

const statusResult = git(["status", "--porcelain", "--untracked-files=all"]);
if (!statusResult.ok) {
  diffFailures.push({ command: "git status --porcelain", detail: statusResult.error?.message ?? "fallo desconocido" });
} else {
  collected.push(
    ...statusResult.stdout
      .split(/\r?\n/)
      .filter((line) => line.startsWith("?? "))
      .map((line) => line.slice(3))
  );
}

const changed = collected
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

result.filesCompared = changed.length;
if (diffFailures.length > 0) {
  // Un comando de git que fallo significa que el guard NO pudo ver parte del
  // cambio. Reportarlo como `ok` seria exactamente el falso verde por
  // denominador vacio que este framework existe para impedir.
  result.status = "blocked";
  result.diffFailures = diffFailures;
  result.detail = "el guard no pudo enumerar el cambio completo: no se puede afirmar que no toca rutas protegidas";
} else if (result.violations.length > 0) {
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
