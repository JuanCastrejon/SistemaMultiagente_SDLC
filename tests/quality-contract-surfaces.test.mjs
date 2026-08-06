// ---------------------------------------------------------------------------
// P6 (ADR 0007): quality-contract.yaml generado desde config.surfaces, no
// inventado. Antes, el template traia `apps/api`/`apps/web` como literales
// PROPIOS, desconectados de config.surfaces: un consumidor real (el piloto,
// dominio en packages/payment-core) terminaba con un contrato que declaraba
// superficies que no existen en su disco, y checkSurfaces las bloqueaba
// SIEMPRE por "surface-path-unresolved" sin importar que tan bien configurado
// estuviera config.json.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { loadQualityContract, checkSurfaces } from "../src/quality-adjudicate.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "sdlc.js");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-quality-surfaces-"));

function run(args) {
  return execFileSync("node", [cli, ...args], { cwd: repoRoot, encoding: "utf8" });
}

// --- 1. install de fabrica: el contrato refleja el default de config -------
const greenfield = path.join(tempRoot, "greenfield");
fs.mkdirSync(greenfield, { recursive: true });
run(["install", "--target", greenfield, "--mode", "greenfield", "--project-name", "Demo", "--json"]);

const installedContract = YAML.parse(fs.readFileSync(path.join(greenfield, "quality-contract.yaml"), "utf8"));
assert.equal(installedContract.surfaces.length, 2);
const backend = installedContract.surfaces.find((s) => s.id === "backend");
assert.equal(backend.path, "apps/api");
assert.equal(backend.tier, "core", "el default de fabrica declara tier explicito: paridad con lo que el template estatico traia antes de P6");
assert.equal(backend.money_path, false);
assert.equal(backend.has_ui, false);
const web = installedContract.surfaces.find((s) => s.id === "web");
assert.equal(web.tier, "standard");
assert.equal(web.has_ui, true);

// --- 2. el piloto real: superficie propia, no apps/api/apps/web ------------
const config = JSON.parse(fs.readFileSync(path.join(greenfield, ".sdlc", "config.json"), "utf8"));
config.surfaces = [
  { id: "payment-core", path: "packages/payment-core", owner: "payments-agent", tier: "core", moneyPath: true }
];
fs.writeFileSync(path.join(greenfield, ".sdlc", "config.json"), JSON.stringify(config, null, 2), "utf8");

const upgraded = JSON.parse(run(["upgrade", "--target", greenfield, "--accept-managed", ".sdlc/config.json", "--json"]));
assert.equal(upgraded.status, "ok", JSON.stringify(upgraded));

const regenerated = YAML.parse(fs.readFileSync(path.join(greenfield, "quality-contract.yaml"), "utf8"));
assert.equal(regenerated.surfaces.length, 1);
assert.equal(regenerated.surfaces[0].id, "payment-core");
assert.equal(regenerated.surfaces[0].path, "packages/payment-core");
assert.equal(regenerated.surfaces[0].tier, "core");
assert.equal(regenerated.surfaces[0].money_path, true);
assert.equal(regenerated.surfaces[0].has_ui, false);
assert.ok(
  !regenerated.surfaces.some((s) => s.path === "apps/api" || s.path === "apps/web"),
  "las superficies inventadas del template no deben sobrevivir a una superficie real declarada en config"
);

// El contrato regenerado sigue siendo valido y, si la superficie real existe
// en disco, checkSurfaces no la marca como fantasma.
fs.mkdirSync(path.join(greenfield, "packages", "payment-core"), { recursive: true });
fs.writeFileSync(path.join(greenfield, "packages", "payment-core", "index.js"), "export const x = 1;\n", "utf8");
const loaded = loadQualityContract(greenfield);
assert.ok(loaded.ok, JSON.stringify(loaded));
assert.equal(checkSurfaces(greenfield, loaded.contract).length, 0);

// --- 3. sin superficies declaradas: `[]` explicito, no un YAML invalido ----
config.surfaces = [];
fs.writeFileSync(path.join(greenfield, ".sdlc", "config.json"), JSON.stringify(config, null, 2), "utf8");
run(["upgrade", "--target", greenfield, "--accept-managed", ".sdlc/config.json", "--json"]);
const empty = YAML.parse(fs.readFileSync(path.join(greenfield, "quality-contract.yaml"), "utf8"));
assert.deepEqual(empty.surfaces, []);

console.log("quality-contract-surfaces: PASS");
