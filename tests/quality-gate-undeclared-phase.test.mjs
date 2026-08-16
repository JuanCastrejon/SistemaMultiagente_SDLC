// ---------------------------------------------------------------------------
// Regresion: una fase SIN `quality_gates` declarado en phase-contract.yaml no
// debe HEREDAR gates de otras fases. El fallback historico (evaluar todos los
// gates y filtrar por fase propia) existe para que un consumidor con contrato
// v1 siga adjudicando sus gates de fase; con el loop de herencia leyendo la
// lista con fallback aplicado, cualquier fase sin declaracion exigia evidencia
// legible de F8/F9/F10 (`inherited-evidence-missing`) y quedaba bloqueada para
// siempre — contradiciendo el propio phase-contract v2, que documenta que
// "sin quality_gates, la fase no adjudica calidad".
//
// Encontrado en adopcion real (FacturacionDian, 2026-08-16): el slice activo
// en F1 no podia poner quality-verify en verde aunque F1 no mide nada.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "sdlc.js");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-undeclared-phase-"));
const target = path.join(tempRoot, "consumidor");

function run(args) {
  return execFileSync("node", [cli, ...args], { cwd: repoRoot, encoding: "utf8" });
}

fs.mkdirSync(target, { recursive: true });
run(["install", "--target", target, "--mode", "greenfield", "--project-name", "Demo", "--json"]);
{
  // Superficies reales en disco y clasificadas sin riesgos: igual que hace un
  // consumidor real desde 2.0.0 (ver phase-inheritance.test.mjs).
  const configPath = path.join(target, ".sdlc", "config.json");
  const installed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const sinRiesgos = { moneyPath: false, regulatedData: false, securityCritical: false, stateMachineCritical: false };
  installed.surfaces = [
    { id: "backend", path: "apps/api", owner: "api-agent", tier: "core", ...sinRiesgos }
  ];
  fs.writeFileSync(configPath, JSON.stringify(installed, null, 2), "utf8");
  run(["upgrade", "--target", target, "--accept-managed", ".sdlc/config.json", "--json"]);
}
for (const args of [
  ["init", "--quiet"],
  ["config", "user.email", "test@example.com"],
  ["config", "user.name", "Test"],
  ["add", "-A"],
  ["commit", "--quiet", "-m", "consumidor instalado"],
  ["update-ref", "refs/remotes/origin/develop", "HEAD"]
]) {
  execFileSync("git", args, { cwd: target });
}
fs.mkdirSync(path.join(target, "apps", "api"), { recursive: true });
fs.writeFileSync(path.join(target, "apps", "api", "index.ts"), "export const api = 1;\n", "utf8");

const slice = "slice-f1";

// F1 SIN declarar quality_gates (el phase-contract instalado no las declara
// para F1). El contrato de calidad trae gates de F8/F9/F10; NINGUNA evidencia
// de esas fases existe. Antes del fix: inherited-evidence-missing x3 y exit 2.
const result = JSON.parse(
  run(["quality-gate", "--target", target, "--slice", slice, "--phase", "F1", "--run", "--exit-code", "--json"])
);

const surfaceCodes = (result.findings ?? result.surfaceFindings ?? []).map((finding) => finding.code);
assert.equal(result.status, "ok", `status esperado ok; surfaceFindings: ${JSON.stringify(result.findings)}`);
assert.ok(
  !surfaceCodes.includes("inherited-evidence-missing"),
  `no debe heredar gates sin declaracion explicita; findings: ${JSON.stringify(result.findings)}`
);
assert.ok(
  !Array.isArray(result.inherited) || result.inherited.length === 0,
  `no debe reportar gates heredados para fase sin declaracion; inherited: ${JSON.stringify(result.inherited)}`
);
// El fallback propio de fase se conserva: F1 no tiene gates propios que
// evaluar, pero el comando no se cae y adjudica vacio en orden.
assert.equal(result.violations.length, 0, `sin violaciones: ${JSON.stringify(result.violations)}`);

// Sanity inverso: F8 (que SI declara quality_gates en el contrato instalado)
// sigue adjudicando su gate propio y tampoco hereda de otras fases. Sin
// --exit-code: el estado blocked/ok de F8 depende del ratchet y su baseline,
// que no es lo que esta regresion prueba.
const f8 = JSON.parse(
  run(["quality-gate", "--target", target, "--slice", slice, "--phase", "F8", "--run", "--json"])
);
const f8SurfaceCodes = (f8.findings ?? f8.surfaceFindings ?? []).map((finding) => finding.code);
assert.ok(
  !f8SurfaceCodes.includes("inherited-evidence-missing"),
  `F8 tampoco hereda gates de otras fases; findings: ${JSON.stringify(f8.findings)}`
);
assert.ok(
  f8.evaluated.some((gate) => gate.id === "F8.changed-lines-coverage"),
  "F8 sigue evaluando su propio gate declarado"
);

console.log("OK: fase sin quality_gates no hereda gates de otras fases; F8 conserva su gate propio.");
