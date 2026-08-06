// ---------------------------------------------------------------------------
// P2 (ADR 0007): el guard de frontera de especificacion debe protegerse a si
// mismo. Tres huecos reales, los tres explotables sin dejar rastro:
//
// 1. Un locked-paths.txt custom REEMPLAZABA la lista default entera (en vez
//    de extenderla): agregar una ruta propia tiraba sin querer la proteccion
//    de quality-contract.yaml y el resto.
// 2. El script del guard, su propia config y su propia allowlist no estaban
//    en ninguna lista: reescribirlos no se detectaba.
// 3. `git diff` es ciego a archivos nuevos que nunca se agregaron al indice:
//    crear un spec o una config protegida sin `git add` pasaba en silencio.
//
// (1) y (2) por si solas no alcanzan si el codigo que se ejecuta es el que el
// PR corrompio -- por eso el fix real en CI (quality-verify.yml) corre la
// copia del guard que vive en la rama de integracion, no la del checkout del
// PR. Este test reproduce exactamente ese patron: SIEMPRE ejecuta la copia
// confiable (origin/main), nunca la corrompida del working tree.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guardSource = path.join(repoRoot, "templates", "scripts", "validate-spec-boundary.mjs");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-spec-boundary-"));
const target = path.join(tempRoot, "consumidor");
const trustedCopy = path.join(tempRoot, "trusted-guard.mjs");

function git(args) {
  return execFileSync("git", args, { cwd: target, encoding: "utf8" });
}
// Mismo patron que el fix de CI: la copia que se EJECUTA sale de origin/main,
// nunca del working tree del "PR" (que en los casos de abajo esta corrompido
// a proposito). El resto de las opciones (locked-paths.txt, la allowlist) SI
// se leen del working tree, porque eso es seguro: solo pueden sumar rutas.
function runTrustedGuard() {
  fs.writeFileSync(trustedCopy, git(["show", "origin/main:scripts/validate-spec-boundary.mjs"]), "utf8");
  const result = spawnSync("node", [trustedCopy, "--base", "origin/main", "--json"], { cwd: target, encoding: "utf8" });
  assert.equal(result.status === 0 || result.status === 2, true, `guard crasheo: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

// --- consumidor real: guard instalado, contrato real, remoto simulado ------
fs.mkdirSync(path.join(target, "scripts"), { recursive: true });
fs.mkdirSync(path.join(target, ".github", "agent-state"), { recursive: true });
fs.copyFileSync(guardSource, path.join(target, "scripts", "validate-spec-boundary.mjs"));
fs.writeFileSync(path.join(target, "quality-contract.yaml"), "version: 1\n", "utf8");
fs.writeFileSync(path.join(target, "src.js"), "export const x = 1;\n", "utf8");

git(["init", "--quiet"]);
git(["config", "user.email", "test@example.com"]);
git(["config", "user.name", "Test"]);
git(["add", "."]);
git(["commit", "--quiet", "-m", "base"]);
// El guard resuelve la base contra una ref REMOTA a proposito (una rama local
// se puede reescribir); se simula sin remoto real apuntando el ref al HEAD.
// Esta ref queda FIJA: representa la rama de integracion protegida, y ningun
// caso de abajo la vuelve a mover.
git(["update-ref", "refs/remotes/origin/main", "HEAD"]);

// --- 1. caso base: tocar una ruta protegida por defecto se detecta ----------
fs.writeFileSync(path.join(target, "quality-contract.yaml"), "version: 2\n", "utf8");
const baseline = runTrustedGuard();
assert.equal(baseline.status, "blocked");
assert.ok(baseline.violations.some((v) => v.path === "quality-contract.yaml"));
git(["checkout", "--", "quality-contract.yaml"]);

// --- 2. el PR neutraliza su propia copia del guard: la copia confiable igual
// lo detecta, porque scripts/validate-spec-boundary.mjs esta en ALWAYS_LOCKED
// y quien juzga es origin/main, no el checkout corrompido.
fs.writeFileSync(path.join(target, "scripts", "validate-spec-boundary.mjs"), "process.exit(0);\n", "utf8");
const selfEdit = runTrustedGuard();
assert.equal(selfEdit.status, "blocked");
assert.ok(
  selfEdit.violations.some((v) => v.path === "scripts/validate-spec-boundary.mjs"),
  "neutralizar la copia local del guard no debe evitar que la copia confiable lo detecte"
);
git(["checkout", "--", "scripts/validate-spec-boundary.mjs"]);

// --- 3. auto-proteccion: la propia allowlist tambien esta protegida --------
fs.writeFileSync(
  path.join(target, ".github", "agent-state", "spec-boundary-allowlist.yaml"),
  "- path: quality-contract.yaml\n",
  "utf8"
);
const allowlistEdit = runTrustedGuard();
assert.equal(allowlistEdit.status, "blocked");
assert.ok(
  allowlistEdit.violations.some((v) => v.path === ".github/agent-state/spec-boundary-allowlist.yaml"),
  "declararse la propia excepcion no puede ser gratis: el cambio a la allowlist requiere revision humana tambien"
);
git(["clean", "-fd", ".github"]);

// --- 4. el bug real: un locked-paths.txt custom NO puede vaciar defaults ---
// Se comitea (no solo se escribe) porque asi llegaria en un PR real; ademas
// prueba de paso que un archivo NUEVO Y STAGEADO se ve.
fs.mkdirSync(path.join(target, ".sdlc"), { recursive: true });
fs.writeFileSync(path.join(target, ".sdlc", "locked-paths.txt"), "docs/algo-propio.md\n", "utf8");
fs.writeFileSync(path.join(target, "quality-contract.yaml"), "version: 3\n", "utf8");
const withCustomList = runTrustedGuard();
assert.equal(withCustomList.status, "blocked");
assert.ok(
  withCustomList.violations.some((v) => v.path === "quality-contract.yaml"),
  "un locked-paths.txt custom debe EXTENDER la proteccion default, no reemplazarla"
);
assert.ok(
  withCustomList.violations.some((v) => v.path === ".sdlc/locked-paths.txt"),
  "el propio locked-paths.txt esta en ALWAYS_LOCKED: crearlo sin comitearlo no lo esconde"
);
git(["checkout", "--", "quality-contract.yaml"]);
fs.rmSync(path.join(target, ".sdlc", "locked-paths.txt"));

// --- 5. archivo nuevo protegido, NUNCA agregado al indice ------------------
// `git diff` (con o sin --cached) es ciego a esto: solo `git status
// --porcelain` lo ve. Antes del fix, crear un spec sin `git add` pasaba
// limpio.
fs.mkdirSync(path.join(target, "openspec", "specs"), { recursive: true });
fs.writeFileSync(path.join(target, "openspec", "specs", "nuevo.md"), "# spec\n", "utf8");
const untracked = runTrustedGuard();
assert.equal(untracked.status, "blocked");
assert.ok(
  untracked.violations.some((v) => v.path === "openspec/specs/nuevo.md"),
  "un archivo nuevo sin git add en una ruta protegida no puede ser invisible para el guard"
);
fs.rmSync(path.join(target, "openspec"), { recursive: true });

// --- 6. sin cambios en rutas protegidas: pasa limpio -----------------------
fs.writeFileSync(path.join(target, "src.js"), "export const x = 2;\n", "utf8");
const clean = runTrustedGuard();
assert.equal(clean.status, "ok");
assert.equal(clean.violations.length, 0);

console.log("spec-boundary-guard: PASS");
