// ---------------------------------------------------------------------------
// P13 (ADR 0007, decision 9 del cierre): `sdlc adopt` reemplaza `npm link`
// para el consumidor maduro (el repo padre) que no quiere el scaffold
// completo de `sdlc install`. Aditivo puro: nunca sobreescribe lo que ya
// existe. `detectCliLinked()` es el mismo chequeo que `quality-verify.yml`
// hace en bash, ahora una funcion real y testeable.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { commandAdopt, detectCliLinked } from "../src/adopt.js";
import { validateConfigShape } from "../src/config-validator.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "sdlc.js");
const PACKAGE_NAME = "sistema-multiagente-sdlc";

function fixturePackage(dir, version) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: PACKAGE_NAME, version }, null, 2), "utf8");
}

// --- unidad: detectCliLinked debe resolver desde el TARGET, no desde el
// modulo del framework (P13: resolver desde el framework es ciego
// exactamente en el escenario de `npm link`, que es el que este chequeo
// existe para detectar). ----------------------------------------------
{
  // Sin la dependencia declarada en absoluto: declared debe ser false, nunca
  // un `linked` inventado.
  const noDepTarget = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-detect-nodep-"));
  const undeclaredResult = detectCliLinked(noDepTarget);
  assert.equal(undeclaredResult.declared, false);
  assert.equal(undeclaredResult.linked, null);

  // Paquete real instalado bajo target/node_modules (no symlink): declared
  // true, linked false.
  const installedTarget = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-detect-installed-"));
  fixturePackage(path.join(installedTarget, "node_modules", PACKAGE_NAME), "1.8.0");
  const installedResult = detectCliLinked(installedTarget);
  assert.equal(installedResult.declared, true);
  assert.equal(installedResult.linked, false);

  // Escenario `npm link`: target/node_modules/<paquete> es un symlink hacia
  // un working tree del framework fuera de node_modules. Este es exactamente
  // el caso que P13 rompia: resolver desde import.meta.url (el propio modulo
  // del framework, que no se depende a si mismo) revienta y cae al catch,
  // reportando declared:false en vez de declared:true, linked:true.
  const linkedTarget = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-detect-linked-"));
  const externalFrameworkDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-detect-external-fw-"));
  fixturePackage(externalFrameworkDir, "1.8.0-dev");
  fs.mkdirSync(path.join(linkedTarget, "node_modules"), { recursive: true });
  fs.symlinkSync(externalFrameworkDir, path.join(linkedTarget, "node_modules", PACKAGE_NAME), "junction");
  const linkedResult = detectCliLinked(linkedTarget);
  assert.equal(linkedResult.declared, true, "npm link debe seguir resolviendo la dependencia, no reportar declared:false");
  assert.equal(linkedResult.linked, true, "el symlink resuelve fuera de node_modules del target -> linked debe ser true");
}

console.log("adopt detectCliLinked unit: PASS");

// --- E2E: repo maduro, sin package.json -> error claro ----------------------
const noPackageJson = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-adopt-")), "sin-package-json");
fs.mkdirSync(noPackageJson, { recursive: true });
const noPackageJsonResult = commandAdopt({ target: noPackageJson });
assert.equal(noPackageJsonResult.exitCode, 1);
assert.match(noPackageJsonResult.payload.message, /package\.json/);

// --- E2E: repo maduro real, sin config previo -------------------------------
const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-adopt-")), "padre");
fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(
  path.join(target, "package.json"),
  JSON.stringify({ name: "repo-maduro-demo", version: "1.0.0" }, null, 2),
  "utf8"
);
execFileSync("git", ["init", "--quiet"], { cwd: target });
execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: target });
execFileSync("git", ["config", "user.name", "Test"], { cwd: target });
execFileSync("git", ["add", "."], { cwd: target });
execFileSync("git", ["commit", "--quiet", "-m", "base"], { cwd: target });

const adopted = commandAdopt({ target, "project-name": "RepoMaduroDemo" });
assert.equal(adopted.exitCode, 0, JSON.stringify(adopted.payload));
assert.ok(adopted.payload.created.some((entry) => entry.includes("package.json")));
assert.ok(adopted.payload.created.includes(".sdlc/config.json"));
assert.ok(adopted.payload.created.includes("quality-contract.yaml"));
assert.ok(adopted.payload.created.includes("phase-contract.yaml"));

const packageJsonAfter = JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8"));
assert.ok(packageJsonAfter.devDependencies["sistema-multiagente-sdlc"], "debe agregar la devDependency, nunca un link");

const config = JSON.parse(fs.readFileSync(path.join(target, ".sdlc", "config.json"), "utf8"));
assert.equal(config.mode, "legacy");
assert.deepEqual(config.surfaces, [], "adopt no inventa superficies de ejemplo sobre un repo maduro");
assert.equal(config.project.name, "RepoMaduroDemo");

// El config que adopt escribe debe pasar el propio validador del framework
// (P13: `governance.maintainers: []` violaba minItems:1 del schema -- adopt
// generaba un archivo que `sdlc doctor` reportaria como invalido).
assert.deepEqual(validateConfigShape(config), [], "el config generado por adopt debe ser valido segun sdlc.config.schema.json");

const contract = YAML.parse(fs.readFileSync(path.join(target, "quality-contract.yaml"), "utf8"));
assert.deepEqual(contract.surfaces, [], "sin superficies declaradas todavia, el contrato lo dice explicitamente");

console.log("adopt e2e (repo nuevo): PASS");

// --- E2E: file:/link: previo se migra, no se deja pasar como "ya declarada"
// (decision 9 abandona npm link; una declaracion file:/link: es el mismo
// problema con otro nombre) -------------------------------------------------
const linkedDepTarget = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-adopt-")), "consumidor-linkeado");
fs.mkdirSync(linkedDepTarget, { recursive: true });
fs.writeFileSync(
  path.join(linkedDepTarget, "package.json"),
  JSON.stringify({ name: "consumidor-linkeado", dependencies: { "sistema-multiagente-sdlc": "file:../../sistema-multiagente-sdlc" } }, null, 2),
  "utf8"
);
const migrated = commandAdopt({ target: linkedDepTarget });
assert.equal(migrated.exitCode, 0, JSON.stringify(migrated.payload));
assert.ok(
  migrated.payload.created.some((entry) => entry.startsWith("package.json") && entry.includes("file:")),
  "debe reportar la migracion del file:, no un skip silencioso"
);
const migratedPackageJson = JSON.parse(fs.readFileSync(path.join(linkedDepTarget, "package.json"), "utf8"));
assert.ok(!migratedPackageJson.dependencies?.["sistema-multiagente-sdlc"], "el file: en dependencies debe quedar eliminado");
assert.match(migratedPackageJson.devDependencies["sistema-multiagente-sdlc"], /^\^/, "debe quedar una version semver real, no file:/link:");

console.log("adopt e2e (migracion file:): PASS");

// --- E2E: aditivo puro -- correrlo de nuevo no pisa lo que ya existe -------
fs.writeFileSync(
  path.join(target, "quality-contract.yaml"),
  "version: 1\nenforcement: observe\ntiers: {}\nsurfaces: [{ id: \"checkout-core\", path: \"packages/checkout-core\", tier: \"core\", money_path: true, has_ui: false }]\nprobes: []\ngates: []\n",
  "utf8"
);
const handEdited = fs.readFileSync(path.join(target, "quality-contract.yaml"), "utf8");

const secondRun = commandAdopt({ target });
assert.equal(secondRun.exitCode, 0);
assert.ok(secondRun.payload.skipped.some((entry) => entry.includes("quality-contract.yaml")));
assert.ok(secondRun.payload.skipped.some((entry) => entry.includes(".sdlc/config.json")));
assert.equal(fs.readFileSync(path.join(target, "quality-contract.yaml"), "utf8"), handEdited, "adopt jamas pisa un archivo que ya existe");

console.log("adopt e2e (idempotente): PASS");

// --- CLI: sdlc adopt de punta a punta ---------------------------------------
const cliTarget = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-adopt-cli-")), "consumidor");
fs.mkdirSync(cliTarget, { recursive: true });
fs.writeFileSync(path.join(cliTarget, "package.json"), JSON.stringify({ name: "demo" }, null, 2), "utf8");
const cliRun = spawnSync("node", [cli, "adopt", "--target", cliTarget, "--json"], { cwd: repoRoot, encoding: "utf8" });
assert.equal(cliRun.status, 0, cliRun.stdout + cliRun.stderr);
const cliPayload = JSON.parse(cliRun.stdout);
assert.equal(cliPayload.status, "ok");
assert.ok(fs.existsSync(path.join(cliTarget, "quality-contract.yaml")));

console.log("adopt cli e2e: PASS");
