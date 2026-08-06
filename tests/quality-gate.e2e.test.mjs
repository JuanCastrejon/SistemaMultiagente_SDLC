import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "sdlc.js");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-quality-"));

function runCli(args) {
  return spawnSync("node", [cli, ...args], { cwd: repoRoot, encoding: "utf8" });
}

// --- consumidor de mentira, pero con probe y adapter REALES ----------------
const target = path.join(tempRoot, "consumidor");
fs.mkdirSync(path.join(target, "packages", "dominio", "src"), { recursive: true });
fs.mkdirSync(path.join(target, "scripts", "quality-adapters"), { recursive: true });
fs.writeFileSync(path.join(target, "packages", "dominio", "src", "index.ts"), "export const x = 1;\n", "utf8");

// El probe: un script del consumidor que produce un reporte nativo.
fs.writeFileSync(
  path.join(target, "scripts", "probe-coverage.mjs"),
  [
    "import fs from 'node:fs';",
    "fs.mkdirSync('coverage', { recursive: true });",
    "fs.writeFileSync('coverage/coverage-summary.json', JSON.stringify({",
    "  total: { lines: { pct: 93, covered: 40, total: 43 } },",
    "  changed: { pct: 91, total: 22 }",
    "}));"
  ].join("\n"),
  "utf8"
);

// El adapter: traduce el reporte nativo a metricas normalizadas. Vive en el
// CONSUMIDOR, no en el engine.
fs.writeFileSync(
  path.join(target, "scripts", "quality-adapters", "istanbul-summary.mjs"),
  [
    "export function parse(raw) {",
    "  const report = JSON.parse(raw);",
    "  return {",
    "    coverage: {",
    "      lines_pct: report.total.lines.pct,",
    "      changed_lines_pct: report.changed.pct,",
    "      changed_lines_total: report.changed.total",
    "    }",
    "  };",
    "}"
  ].join("\n"),
  "utf8"
);

fs.writeFileSync(
  path.join(target, "package.json"),
  JSON.stringify(
    {
      name: "consumidor-quality",
      packageManager: "npm@11.9.0",
      scripts: { "validate:coverage": "node scripts/probe-coverage.mjs" }
    },
    null,
    2
  ),
  "utf8"
);

function writeContract(extra = {}) {
  const contract = {
    version: 1,
    enforcement: "observe",
    tiers: { core: { description: "dominio" } },
    surfaces: [{ id: "dominio", path: "packages/dominio", tier: "core", money_path: true }],
    probes: [
      {
        id: "coverage",
        command: "validate:coverage",
        emits: "coverage/coverage-summary.json",
        format: "istanbul-summary",
        timeout_ms: 60000,
        when_absent: "warn"
      }
    ],
    gates: [
      {
        id: "F9.changed-lines",
        phase: "F9",
        metric: "coverage.changed_lines_pct",
        op: "gte",
        mode: "observe",
        thresholds: { core: 90 },
        min_denominator: { metric: "coverage.changed_lines_total", value: 1 },
        provenance: "decision-de-equipo"
      }
    ],
    ...extra
  };
  fs.writeFileSync(path.join(target, "quality-contract.yaml"), YAML.stringify(contract), "utf8");
  return contract;
}
writeContract();

// --- 1. --run ejecuta, mide y ANEXA evidencia ------------------------------
const runResult = runCli(["quality-gate", "--target", target, "--slice", "slice-a", "--phase", "F9", "--run", "--json"]);
assert.equal(runResult.status, 0, runResult.stderr);
const runPayload = JSON.parse(runResult.stdout);
assert.equal(runPayload.status, "ok");
assert.equal(runPayload.tier, "core");
assert.equal(runPayload.advisory, true, "una corrida local nunca es autoritativa");
assert.equal(runPayload.probes[0].status, "ok");
assert.ok(runPayload.probes[0].report_sha256, "el probe debe dejar el hash del reporte que produjo");
assert.equal(runPayload.evaluated[0].status, "pass");
assert.equal(runPayload.evaluated[0].actual, 91);

const evidenceFile = path.join(target, ".github", "agent-state", "evidence", "slice-a", "F9.yaml");
assert.ok(fs.existsSync(evidenceFile), "la evidencia la escribe el harness, no el agente");
const evidence = YAML.parse(fs.readFileSync(evidenceFile, "utf8"));
assert.equal(evidence.quality_metrics.source, "harness");
assert.ok(evidence.quality_metrics.tree_hash, "sin hash de arbol la frescura no es verificable");
assert.equal(evidence.quality_metrics.metrics.coverage.changed_lines_pct, 91);
assert.equal(evidence.validators_run.length, 1);

// --- 2. append-only: la segunda corrida no borra la primera ----------------
const firstTreeHash = evidence.quality_metrics.tree_hash;
runCli(["quality-gate", "--target", target, "--slice", "slice-a", "--phase", "F9", "--run", "--json"]);
const evidence2 = YAML.parse(fs.readFileSync(evidenceFile, "utf8"));
assert.ok(Array.isArray(evidence2.history) && evidence2.history.length === 1, "la medicion anterior se conserva");
assert.equal(evidence2.history[0].quality_metrics.tree_hash, firstTreeHash);

// El hash del arbol cambia cuando cambia el codigo evaluado.
fs.writeFileSync(path.join(target, "packages", "dominio", "src", "index.ts"), "export const x = 2;\n", "utf8");
runCli(["quality-gate", "--target", target, "--slice", "slice-a", "--phase", "F9", "--run", "--json"]);
const evidence3 = YAML.parse(fs.readFileSync(evidenceFile, "utf8"));
assert.notEqual(evidence3.quality_metrics.tree_hash, firstTreeHash);

// --- 3. --from-evidence adjudica sin ejecutar y se marca advisory ----------
const fromEvidence = runCli([
  "quality-gate", "--target", target, "--slice", "slice-a", "--phase", "F9", "--from-evidence", "--json"
]);
assert.equal(fromEvidence.status, 0);
const fromPayload = JSON.parse(fromEvidence.stdout);
assert.equal(fromPayload.advisory, true);
assert.equal(fromPayload.evaluated[0].status, "pass");

// --- 4. NO-VACUIDAD end to end --------------------------------------------
// El probe deja de reportar lineas cambiadas: el gate ya no puede juzgar.
fs.writeFileSync(
  path.join(target, "scripts", "probe-coverage.mjs"),
  [
    "import fs from 'node:fs';",
    "fs.mkdirSync('coverage', { recursive: true });",
    "fs.writeFileSync('coverage/coverage-summary.json', JSON.stringify({",
    "  total: { lines: { pct: 93, covered: 40, total: 43 } },",
    "  changed: { pct: 100, total: 0 }",
    "}));"
  ].join("\n"),
  "utf8"
);
const vacuousRun = runCli(["quality-gate", "--target", target, "--slice", "slice-b", "--phase", "F9", "--run", "--json"]);
const vacuousPayload = JSON.parse(vacuousRun.stdout);
assert.equal(vacuousPayload.vacuous.length, 1, "100% sobre 0 lineas cambiadas no puede ser un PASS");
assert.equal(vacuousPayload.evaluated[0].status, "vacuous");
assert.equal(vacuousPayload.status, "warning");

// En modo block, el mismo gate vacuo bloquea y con --exit-code sale 2.
writeContract({
  gates: [
    {
      id: "F9.changed-lines",
      phase: "F9",
      metric: "coverage.changed_lines_pct",
      op: "gte",
      mode: "block",
      thresholds: { core: 90 },
      min_denominator: { metric: "coverage.changed_lines_total", value: 1 },
      provenance: "decision-de-equipo"
    }
  ]
});
const blockedRun = runCli([
  "quality-gate", "--target", target, "--slice", "slice-c", "--phase", "F9", "--run", "--exit-code", "--json"
]);
assert.equal(blockedRun.status, 2);
assert.equal(JSON.parse(blockedRun.stdout).status, "blocked");

// --- 5. superficie inexistente: el falso verde mas barato ------------------
writeContract({
  surfaces: [{ id: "fantasma", path: "packages/no-existe", tier: "core" }]
});
const ghost = runCli(["quality-gate", "--target", target, "--slice", "slice-d", "--phase", "F9", "--run", "--json"]);
const ghostPayload = JSON.parse(ghost.stdout);
assert.ok(
  ghostPayload.surfaceFindings.some((finding) => finding.code === "surface-path-unresolved"),
  "una superficie que no existe en disco debe detectarse antes de medir"
);
assert.equal(ghostPayload.status, "blocked");

// --- 6. probe no declarado por el consumidor ------------------------------
writeContract({
  probes: [
    {
      id: "mutation",
      command: "validate:mutation",
      emits: "reports/mutation.json",
      format: "stryker",
      when_absent: "warn"
    }
  ],
  gates: []
});
const missingProbe = runCli(["quality-gate", "--target", target, "--slice", "slice-e", "--phase", "F9", "--run", "--json"]);
const missingPayload = JSON.parse(missingProbe.stdout);
assert.equal(missingPayload.probes[0].status, "not-configured");
assert.equal(missingPayload.probes[0].exit_code, null);

// --- 7. evidencia manipulada a mano: se detecta el olor -------------------
const handWritten = path.join(target, ".github", "agent-state", "evidence", "slice-f", "F9.yaml");
fs.mkdirSync(path.dirname(handWritten), { recursive: true });
fs.writeFileSync(
  handWritten,
  YAML.stringify({
    phase: "F9",
    slice: "slice-f",
    agent_id: "un-agente",
    started_at: new Date().toISOString(),
    outputs: [],
    validators_run: [],
    quality_metrics: {
      measured_at: new Date().toISOString(),
      metrics: { coverage: { changed_lines_pct: 100, changed_lines_total: 999 } },
      probes: []
    }
  }),
  "utf8"
);
const smelly = runCli([
  "quality-gate", "--target", target, "--slice", "slice-f", "--phase", "F9", "--from-evidence", "--json"
]);
const smellyPayload = JSON.parse(smelly.stdout);
const smellCodes = smellyPayload.surfaceFindings.map((finding) => finding.code);
assert.ok(smellCodes.includes("evidence-source-unset"));
assert.ok(smellCodes.includes("evidence-without-tree-hash"));
assert.ok(smellCodes.includes("metrics-without-probes"));

console.log("quality-gate e2e: PASS");
