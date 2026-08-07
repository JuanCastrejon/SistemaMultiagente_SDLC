// ---------------------------------------------------------------------------
// P14 (ADR 0007): documentacion generada desde el contrato, no escrita a
// mano. Una prosa que describe umbrales diverge del contrato real la primera
// vez que alguien edita quality-contract.yaml y se olvida de actualizarla —
// el mismo problema de dos fuentes de verdad que P6 cerro para superficies.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderQualityDocs } from "../src/quality-docs.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "sdlc.js");

// --- unidad: renderQualityDocs ----------------------------------------------
const contract = {
  enforcement: "observe",
  tiers: { core: { description: "dinero" } },
  surfaces: [{ id: "s", path: "packages/s", tier: "core", money_path: true, has_ui: false }],
  probes: [{ id: "coverage", command: "validate:coverage", format: "istanbul-summary", emits: "coverage/coverage-summary.json" }],
  gates: [
    { id: "F8.gate-a", phase: "F8", metric: "coverage.changed_lines_pct", op: "gte", mode: "ratchet", thresholds: { core: 90 }, provenance: "decision-de-equipo" },
    { id: "F10.gate-b", phase: "F10", metric: "dependencies.violations", op: "eq", mode: "ratchet", threshold: 0, provenance: "decision-de-equipo" }
  ]
};
const phaseContract = {
  phases: [
    { id: "F8", quality_gates: ["F8.gate-a"] },
    { id: "F14", quality_gates: ["F8.gate-a", "F10.gate-b"] }
  ]
};
const markdown = renderQualityDocs({ contract, phaseContract });

assert.match(markdown, /F8\.gate-a/);
assert.match(markdown, /F10\.gate-b/);
assert.match(markdown, /core=90/);
assert.match(markdown, /No editar a mano/);
// F8 declara su propio gate; F14 hereda ambos (ninguno tiene phase:"F14").
const f14Row = markdown.split("\n").find((line) => line.startsWith("| F14"));
assert.ok(f14Row, "debe listar F14 en la tabla de gates por fase");
assert.match(f14Row, /ninguno/, "F14 no tiene gates propios");
assert.match(f14Row, /F8\.gate-a.*F10\.gate-b|F10\.gate-b.*F8\.gate-a/);
const f8Row = markdown.split("\n").find((line) => line.startsWith("| F8"));
assert.match(f8Row, /F8\.gate-a/);

console.log("quality-docs unit: PASS");

// --- E2E: sdlc quality-docs sobre un install real --------------------------
const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-quality-docs-")), "consumidor");
fs.mkdirSync(target, { recursive: true });
execFileSync("node", [cli, "install", "--target", target, "--mode", "greenfield", "--project-name", "Demo", "--json"], {
  cwd: repoRoot,
  encoding: "utf8"
});
const result = JSON.parse(
  execFileSync("node", [cli, "quality-docs", "--target", target, "--json"], { cwd: repoRoot, encoding: "utf8" })
);
assert.equal(result.status, "ok");
const generatedPath = path.join(target, result.path);
assert.ok(fs.existsSync(generatedPath));
const generated = fs.readFileSync(generatedPath, "utf8");
assert.match(generated, /F8\.changed-lines-coverage/);
// F14 (del phase-contract real, P7) hereda F8/F10; no tiene gates propios.
const installedF14Row = generated.split("\n").find((line) => line.startsWith("| F14"));
assert.ok(installedF14Row);
assert.match(installedF14Row, /F10\.dependency-violations/);

console.log("quality-docs cli e2e: PASS");
