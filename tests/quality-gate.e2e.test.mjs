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

// --- 8. phase-contract v2: la fase adjudica los gates que declara ----------
// Repo instalado de verdad, para que exista phase-contract y agent-state.
const installed = path.join(tempRoot, "instalado");
fs.mkdirSync(installed, { recursive: true });
fs.writeFileSync(path.join(installed, "README.md"), "# demo\n", "utf8");
execFileSync("node", [cli, "install", "--target", installed, "--mode", "greenfield", "--project-name", "Demo", "--json"], {
  cwd: repoRoot,
  encoding: "utf8"
});

// El contrato instalado ya es v2 y F9 declara sus gates.
const phaseContract = fs.readFileSync(path.join(installed, "phase-contract.yaml"), "utf8");
assert.match(phaseContract, /^version: 2$/m);
assert.match(phaseContract, /quality_gates: \[F9\.mutation-survivors/);

// Las superficies del contrato instalado deben existir: si no, todo gate sobre
// ellas es vacuo y el adjudicador lo reporta como error (comportamiento
// correcto, verificado en el caso 5).
fs.mkdirSync(path.join(installed, "apps", "api"), { recursive: true });
fs.writeFileSync(path.join(installed, "apps", "api", "index.ts"), "export const api = 1;\n", "utf8");
fs.mkdirSync(path.join(installed, "apps", "web"), { recursive: true });
fs.writeFileSync(path.join(installed, "apps", "web", "index.ts"), "export const web = 1;\n", "utf8");

// F9 exige la evidencia de F8 como input: la cadena de fases se respeta.
const f9Dir = path.join(installed, ".github", "agent-state", "evidence", "slice-v2");
fs.mkdirSync(f9Dir, { recursive: true });
fs.writeFileSync(
  path.join(f9Dir, "F8.yaml"),
  YAML.stringify({
    phase: "F8",
    slice: "slice-v2",
    agent_id: "dev",
    started_at: new Date().toISOString(),
    outputs: [],
    validators_run: []
  }),
  "utf8"
);
fs.writeFileSync(
  path.join(f9Dir, "F9.yaml"),
  YAML.stringify({
    phase: "F9",
    slice: "slice-v2",
    agent_id: "qa",
    started_at: new Date().toISOString(),
    outputs: [],
    validators_run: [],
    quality_metrics: {
      measured_at: new Date().toISOString(),
      source: "harness",
      tree_hash: "abc123",
      probes: [{ id: "mutation", command: "validate:mutation", exit_code: 0, report_sha256: "deadbeef", status: "ok" }],
      metrics: { mutation: { survived: 3, total: 40, no_coverage: 0 } }
    }
  }),
  "utf8"
);

const v2Gate = JSON.parse(
  execFileSync("node", [cli, "phase-gate", "--target", installed, "--phase", "F9", "--slice", "slice-v2", "--json"], {
    cwd: repoRoot,
    encoding: "utf8"
  })
);
assert.equal(v2Gate.contractVersion, 2);
assert.ok(v2Gate.quality, "una fase con quality_gates debe adjudicar calidad");
assert.ok(!v2Gate.warnings.some((w) => w.startsWith("contract-version-outdated")));
// El gate del template esta en modo observe: informa, no bloquea.
assert.ok(v2Gate.warnings.some((warning) => warning.startsWith("quality-gate-failed")));
assert.equal(v2Gate.status, "ok");

// `status` incorpora el cuarto componente.
fs.writeFileSync(
  path.join(installed, ".github", "agent-state", "phase-status.yaml"),
  ["version: 1", 'current_slice: "slice-v2"', 'current_phase: "F9"'].join("\n"),
  "utf8"
);
const statusOut = JSON.parse(
  execFileSync("node", [cli, "status", "--target", installed, "--json"], { cwd: repoRoot, encoding: "utf8" })
);
assert.ok(statusOut.quality, "status debe exponer el componente quality");
assert.equal(statusOut.quality.advisory, true, "medido en local, nunca autoritativo");
assert.ok(statusOut.quality.evaluated.length > 0);

// --- 9. baseline: promocion, integridad y ratchet real ---------------------
// Repo nuevo, instalado de verdad para tener quality-baseline.yaml de fabrica.
const baselineTarget = path.join(tempRoot, "con-baseline");
fs.mkdirSync(baselineTarget, { recursive: true });
fs.writeFileSync(path.join(baselineTarget, "README.md"), "# demo\n", "utf8");
execFileSync("node", [cli, "install", "--target", baselineTarget, "--mode", "greenfield", "--project-name", "Baseline Demo", "--json"], {
  cwd: repoRoot,
  encoding: "utf8"
});

const baselineFile = path.join(baselineTarget, ".github", "agent-state", "quality-baseline.yaml");
// NO se instala por manifiesto (mismo tratamiento que .sdlc/session.json):
// evita managed-file-drift contra las promociones legitimas que lo reescriben.
assert.ok(!fs.existsSync(baselineFile), "antes de la primera promocion no existe fisicamente");

// Sin --source ci y sin --allow-local, promover se rechaza.
const refusedPromotion = runCli(["quality-baseline", "--target", baselineTarget, "--promote", "--slice", "slice-base", "--json"]);
assert.notEqual(refusedPromotion.status, 0);
assert.equal(JSON.parse(refusedPromotion.stdout).code, "baseline-promotion-requires-ci");

// Evidencia de F15 con metricas reales para promover.
const f15Dir = path.join(baselineTarget, ".github", "agent-state", "evidence", "slice-base");
fs.mkdirSync(f15Dir, { recursive: true });
fs.writeFileSync(
  path.join(f15Dir, "F15.yaml"),
  YAML.stringify({
    phase: "F15",
    slice: "slice-base",
    agent_id: "orquestador",
    started_at: new Date().toISOString(),
    outputs: [],
    validators_run: [],
    quality_metrics: {
      measured_at: new Date().toISOString(),
      source: "ci",
      tree_hash: "cafef00d",
      probes: [],
      metrics: { dependencies: { violations: 2, cycles: 0, modules_scanned: 12 }, coverage: { changed_lines_pct: 88, changed_lines_total: 15 } }
    }
  }),
  "utf8"
);

const promoted = JSON.parse(
  runCli(["quality-baseline", "--target", baselineTarget, "--promote", "--slice", "slice-base", "--allow-local", "--json"]).stdout
);
assert.equal(promoted.status, "ok");
const promotedDoc = YAML.parse(fs.readFileSync(baselineFile, "utf8"));
assert.ok(promotedDoc.promoted_at);
assert.ok(promotedDoc.integrity_sha256);
assert.equal(promotedDoc.metrics.dependencies.violations, 2);
assert.match(promotedDoc.promoted_by, /^local:/, "una promocion sin --source ci debe quedar marcada como local");

// doctor no marca tampering justo despues de una promocion legitima. Se usa
// runCli (spawnSync) y no execFileSync: doctor puede salir con exit != 0 por
// el warning esperado de "promocion local", y execFileSync lanzaria por eso.
const doctorClean = JSON.parse(runCli(["doctor", "--target", baselineTarget, "--json"]).stdout);
assert.ok(!doctorClean.findings.some((finding) => finding.code === "baseline-tampered"));
assert.ok(doctorClean.findings.some((finding) => finding.code === "baseline-promoted-locally"));

// Manipular el archivo a mano (bajar violations sin recalcular el hash) rompe
// la integridad, y doctor lo detecta.
const tampered = YAML.parse(fs.readFileSync(baselineFile, "utf8"));
tampered.metrics.dependencies.violations = 0;
fs.writeFileSync(baselineFile, YAML.stringify(tampered), "utf8");
const doctorTamperedPayload = JSON.parse(runCli(["doctor", "--target", baselineTarget, "--json"]).stdout);
assert.ok(doctorTamperedPayload.findings.some((finding) => finding.code === "baseline-tampered"));
assert.equal(doctorTamperedPayload.status, "error");

// Restaurar el baseline legitimo para el resto del test.
fs.writeFileSync(baselineFile, YAML.stringify(promotedDoc), "utf8");

// --- ratchet real: F10 compara contra lo promovido -------------------------
writeContract({
  gates: [
    {
      id: "F10.dependency-violations",
      phase: "F10",
      metric: "dependencies.violations",
      op: "eq",
      mode: "ratchet",
      threshold: 0,
      min_denominator: { metric: "dependencies.modules_scanned", value: 10 },
      provenance: "decision-de-equipo"
    }
  ]
});
// El contrato de mas arriba usa `target`, no `baselineTarget`; se copia aqui
// para reusar el helper sin reescribirlo. `writeContract` declara
// packages/dominio como superficie por defecto: tiene que existir tambien en
// baselineTarget o checkSurfaces lo marca como superficie fantasma.
fs.mkdirSync(path.join(baselineTarget, "packages", "dominio"), { recursive: true });
fs.copyFileSync(path.join(target, "quality-contract.yaml"), path.join(baselineTarget, "quality-contract.yaml"));

const f10Dir = path.join(baselineTarget, ".github", "agent-state", "evidence", "slice-ratchet");
fs.mkdirSync(f10Dir, { recursive: true });

// Mismo nivel que el baseline (2): no es regresion, pero tampoco pasa el
// absoluto (eq 0). Debe avisar, no bloquear.
fs.writeFileSync(
  path.join(f10Dir, "F10.yaml"),
  YAML.stringify({
    phase: "F10",
    slice: "slice-ratchet",
    agent_id: "qa",
    started_at: new Date().toISOString(),
    outputs: [],
    validators_run: [],
    quality_metrics: {
      measured_at: new Date().toISOString(),
      source: "harness",
      tree_hash: "beefbeef",
      probes: [],
      metrics: { dependencies: { violations: 2, cycles: 0, modules_scanned: 12 } }
    }
  }),
  "utf8"
);
const stableRatchet = JSON.parse(
  runCli(["quality-gate", "--target", baselineTarget, "--slice", "slice-ratchet", "--phase", "F10", "--from-evidence", "--json"]).stdout
);
assert.equal(stableRatchet.evaluated[0].status, "fail");
assert.equal(stableRatchet.evaluated[0].regressed, false);
assert.equal(stableRatchet.status, "warning", "ratchet no bloquea aunque no llegue al absoluto");

// Peor que el baseline (5 > 2): regresion real, detectada con la direccion
// correcta despues del fix del bug de eq/gte.
fs.writeFileSync(
  path.join(f10Dir, "F10.yaml"),
  YAML.stringify({
    phase: "F10",
    slice: "slice-ratchet",
    agent_id: "qa",
    started_at: new Date().toISOString(),
    outputs: [],
    validators_run: [],
    quality_metrics: {
      measured_at: new Date().toISOString(),
      source: "harness",
      tree_hash: "beefbeef2",
      probes: [],
      metrics: { dependencies: { violations: 5, cycles: 0, modules_scanned: 12 } }
    }
  }),
  "utf8"
);
const regressedRatchet = JSON.parse(
  runCli(["quality-gate", "--target", baselineTarget, "--slice", "slice-ratchet", "--phase", "F10", "--from-evidence", "--json"]).stdout
);
assert.equal(regressedRatchet.evaluated[0].status, "regression");
assert.equal(regressedRatchet.evaluated[0].regressed, true);

console.log("quality-gate e2e: PASS");
