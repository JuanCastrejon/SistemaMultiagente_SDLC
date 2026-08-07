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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "sdlc.js");

// --- unidad: detectCliLinked --------------------------------------------
// Sin la dependencia declarada en absoluto (este mismo repo no se depende a
// si mismo): declared debe ser false, nunca un `linked` inventado.
const undeclaredResult = detectCliLinked();
assert.equal(undeclaredResult.declared, false);
assert.equal(undeclaredResult.linked, null);

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
  JSON.stringify({ name: "facturacion-dian", version: "1.0.0" }, null, 2),
  "utf8"
);
execFileSync("git", ["init", "--quiet"], { cwd: target });
execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: target });
execFileSync("git", ["config", "user.name", "Test"], { cwd: target });
execFileSync("git", ["add", "."], { cwd: target });
execFileSync("git", ["commit", "--quiet", "-m", "base"], { cwd: target });

const adopted = commandAdopt({ target, "project-name": "FacturacionDian" });
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
assert.equal(config.project.name, "FacturacionDian");

const contract = YAML.parse(fs.readFileSync(path.join(target, "quality-contract.yaml"), "utf8"));
assert.deepEqual(contract.surfaces, [], "sin superficies declaradas todavia, el contrato lo dice explicitamente");

console.log("adopt e2e (repo nuevo): PASS");

// --- E2E: aditivo puro -- correrlo de nuevo no pisa lo que ya existe -------
fs.writeFileSync(
  path.join(target, "quality-contract.yaml"),
  "version: 1\nenforcement: observe\ntiers: {}\nsurfaces: [{ id: \"payment-core\", path: \"packages/payment-core\", tier: \"core\", money_path: true, has_ui: false }]\nprobes: []\ngates: []\n",
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
