// ---------------------------------------------------------------------------
// P3 (ADR 0007): el arbitro re-ejecuta lo que package.json declara para cada
// probe, sin ninguna garantia de que ese script siga siendo el que se
// revisó. `command_sha256` ancla el texto literal del script en
// quality-contract.yaml (ruta protegida por el guard de P2): cambiarlo sin
// pasar por revision humana bloquea, sin importar el modo del gate.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { checkProbeAnchors } from "../src/quality-adjudicate.js";
import { sha256Text } from "../src/file-utils.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "sdlc.js");

function runCli(args) {
  return spawnSync("node", [cli, ...args], { cwd: repoRoot, encoding: "utf8" });
}

// --- unidad: checkProbeAnchors ---------------------------------------------
const unitDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-probe-anchor-unit-"));
const scriptText = "node scripts/run-tests.mjs";
fs.writeFileSync(path.join(unitDir, "package.json"), JSON.stringify({ scripts: { "validate:coverage": scriptText } }), "utf8");
const hash = sha256Text(scriptText);

const unpinned = checkProbeAnchors(unitDir, { probes: [{ id: "coverage", command: "validate:coverage" }] });
assert.equal(unpinned.length, 1);
assert.equal(unpinned[0].code, "probe-command-unpinned");
assert.equal(unpinned[0].level, "warning");
assert.equal(unpinned[0].actual, hash, "debe sugerir el hash exacto a anclar");

const pinnedOk = checkProbeAnchors(unitDir, { probes: [{ id: "coverage", command: "validate:coverage", command_sha256: hash }] });
assert.equal(pinnedOk.length, 0, "anclado y sin cambios: nada que reportar");

const drifted = checkProbeAnchors(unitDir, {
  probes: [{ id: "coverage", command: "validate:coverage", command_sha256: "0".repeat(64) }]
});
assert.equal(drifted.length, 1);
assert.equal(drifted[0].code, "probe-script-drift");
assert.equal(drifted[0].level, "error");

const missing = checkProbeAnchors(unitDir, {
  probes: [{ id: "deps", command: "validate:deps", command_sha256: "1".repeat(64) }]
});
assert.equal(missing.length, 1);
assert.equal(missing[0].code, "probe-script-missing-pinned");
assert.equal(missing[0].level, "error");

console.log("probe-anchor unit: PASS");

// --- E2E: sdlc quality-gate --run bloquea el drift, sin importar el gate ---
const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-probe-anchor-e2e-")), "consumidor");
fs.mkdirSync(path.join(target, "src"), { recursive: true });
fs.mkdirSync(path.join(target, "scripts"), { recursive: true });
fs.writeFileSync(path.join(target, "src", "index.js"), "export const x = 1;\n", "utf8");
fs.writeFileSync(
  path.join(target, "scripts", "probe.mjs"),
  "import fs from 'node:fs';\nfs.mkdirSync('reports', { recursive: true });\nfs.writeFileSync('reports/probe.json', '{}');\n",
  "utf8"
);

function writePackageJson(scriptCommand) {
  const scripts = scriptCommand ? { "validate:probe": scriptCommand } : {};
  fs.writeFileSync(
    path.join(target, "package.json"),
    JSON.stringify({ name: "consumidor-probe-anchor", packageManager: "npm@11.9.0", scripts }, null, 2),
    "utf8"
  );
}

function writeContract(commandSha256) {
  const probe = { id: "probe", command: "validate:probe", emits: "reports/probe.json", format: "istanbul-summary", when_absent: "warn" };
  if (commandSha256) probe.command_sha256 = commandSha256;
  const contract = {
    version: 1,
    enforcement: "observe",
    tiers: { core: { description: "unico tier de esta prueba" } },
    surfaces: [{ id: "s", path: "src", tier: "core" }],
    probes: [probe],
    gates: []
  };
  fs.writeFileSync(path.join(target, "quality-contract.yaml"), YAML.stringify(contract), "utf8");
}

const goodScript = "node scripts/probe.mjs";
const pinnedHash = sha256Text(goodScript);

// 1. Anclado y sin cambios: corre limpio, sin hallazgos de anclaje.
writePackageJson(goodScript);
writeContract(pinnedHash);
const ok = JSON.parse(runCli(["quality-gate", "--target", target, "--slice", "s1", "--phase", "F8", "--run", "--json"]).stdout);
assert.equal(ok.status, "ok", JSON.stringify(ok));
assert.ok(!ok.surfaceFindings.some((f) => f.code.startsWith("probe-script")));
assert.equal(ok.probes[0].command_sha256_actual, pinnedHash, "el hash real queda visible en cada corrida, anclado o no");

// 2. El script cambia sin actualizar el ancla: bloquea, aunque el gate este
// en observe (no hay ni un gate declarado en este contrato: el bloqueo sale
// SOLO del anclaje, no de ningun umbral).
writePackageJson("node scripts/probe.mjs --coverage=100");
const drift = JSON.parse(runCli(["quality-gate", "--target", target, "--slice", "s2", "--phase", "F8", "--run", "--json"]).stdout);
assert.equal(drift.status, "blocked");
assert.ok(drift.surfaceFindings.some((f) => f.code === "probe-script-drift"));

// 3. El script desaparece del todo sin retirar el ancla: tambien bloquea. No
// alcanza con que el probe "no este configurado": si estaba anclado, su
// desaparicion es sospechosa por si sola.
writePackageJson(null);
const missingRun = JSON.parse(runCli(["quality-gate", "--target", target, "--slice", "s3", "--phase", "F8", "--run", "--json"]).stdout);
assert.equal(missingRun.status, "blocked");
assert.ok(missingRun.surfaceFindings.some((f) => f.code === "probe-script-missing-pinned"));

// 4. Sin anclar: `doctor` avisa (no bloquea) y sugiere el hash exacto.
writePackageJson(goodScript);
writeContract(null);
const doctorOut = JSON.parse(runCli(["doctor", "--target", target, "--json"]).stdout);
const unpinnedFinding = doctorOut.findings.find((f) => f.code === "probe-command-unpinned");
assert.ok(unpinnedFinding, "doctor debe avisar de probes sin anclar sin necesitar una corrida completa");
assert.equal(unpinnedFinding.level, "warning");
assert.equal(unpinnedFinding.actual, pinnedHash);

console.log("probe-anchor e2e: PASS");
