// ---------------------------------------------------------------------------
// P1 (ADR 0007): sin esto toda metrica era `null` y todo gate `not-measured`.
// Este E2E prueba que un consumidor real -- con los adapters de
// templates/scripts/quality-adapters/ (no fixtures falsos escritos por el
// test) y `sdlc coverage-diff` encadenado a su propio test runner -- produce
// metricas REALES en `sdlc quality-gate --run`, para los tres formatos que
// declara quality-contract.yaml: istanbul-summary, dependency-cruiser y
// stryker.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "sdlc.js");
const adaptersSource = path.join(repoRoot, "templates", "scripts", "quality-adapters");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-adapters-"));
const target = path.join(tempRoot, "consumidor");

function runCli(args) {
  return spawnSync("node", [cli, ...args], { cwd: repoRoot, encoding: "utf8" });
}
function git(args) {
  return execFileSync("git", args, { cwd: target, encoding: "utf8" });
}

// --- repo git real, dos commits: base y el que agrega subtract() -----------
fs.mkdirSync(path.join(target, "src", "lib"), { recursive: true });
fs.mkdirSync(path.join(target, "scripts", "quality-adapters"), { recursive: true });
fs.mkdirSync(path.join(target, "reports"), { recursive: true });

git(["init", "--quiet"]);
git(["config", "user.email", "test@example.com"]);
git(["config", "user.name", "Test"]);

fs.writeFileSync(
  path.join(target, "src", "lib", "foo.js"),
  ["function add(a, b) {", "  return a + b;", "}", ""].join("\n"),
  "utf8"
);
git(["add", "."]);
git(["commit", "--quiet", "-m", "base"]);
const baseSha = git(["rev-parse", "HEAD"]).trim();

// El cambio real de la fase: agrega subtract() con dos statements, una
// cubierta y otra no. Las lineas 4 (blanco) y 8 (`}`) tambien son "cambiadas"
// segun git pero no tienen statement propio: no deben contar en el
// denominador (misma regla de no-vacuidad que el resto del gauntlet).
fs.writeFileSync(
  path.join(target, "src", "lib", "foo.js"),
  [
    "function add(a, b) {",
    "  return a + b;",
    "}",
    "",
    "function subtract(a, b) {",
    "  const diff = a - b;",
    "  return diff;",
    "}",
    ""
  ].join("\n"),
  "utf8"
);
git(["add", "."]);
git(["commit", "--quiet", "-m", "agrega subtract"]);

// --- adapters REALES, copiados de templates/, no fixtures del test --------
for (const format of ["istanbul-summary", "dependency-cruiser", "stryker"]) {
  fs.copyFileSync(
    path.join(adaptersSource, `${format}.mjs`),
    path.join(target, "scripts", "quality-adapters", `${format}.mjs`)
  );
}

// --- probe de cobertura: simula el reporter + encadena coverage-diff -------
// Mismo patron documentado en el adapter: el test runner emite el reporte
// nativo, y `sdlc coverage-diff` lo aumenta con `changed.pct/total` antes de
// que el adapter lo traduzca.
fs.writeFileSync(
  path.join(target, "scripts", "probe-coverage.mjs"),
  [
    "import fs from 'node:fs';",
    "fs.mkdirSync('coverage', { recursive: true });",
    "fs.writeFileSync('coverage/coverage-final.json', JSON.stringify({",
    "  [process.cwd() + '/src/lib/foo.js']: {",
    "    path: process.cwd() + '/src/lib/foo.js',",
    "    statementMap: {",
    "      '0': { start: { line: 2 }, end: { line: 2 } },",
    "      '1': { start: { line: 6 }, end: { line: 6 } },",
    "      '2': { start: { line: 7 }, end: { line: 7 } }",
    "    },",
    "    s: { '0': 4, '1': 1, '2': 0 }",
    "  }",
    "}));",
    "fs.writeFileSync('coverage/coverage-summary.json', JSON.stringify({",
    "  total: { lines: { pct: 75 }, statements: { pct: 75 }, branches: { pct: 100 }, functions: { pct: 100 } }",
    "}));"
  ].join("\n"),
  "utf8"
);

// --- probes de dependencias y mutacion: reportes nativos reales -------------
fs.writeFileSync(
  path.join(target, "scripts", "probe-deps.mjs"),
  [
    "import fs from 'node:fs';",
    "fs.mkdirSync('reports', { recursive: true });",
    "fs.writeFileSync('reports/dependencies.json', JSON.stringify({",
    "  summary: {",
    "    totalCruised: 12,",
    "    violations: [{ rule: { name: 'no-circular' }, from: 'src/a.js', to: 'src/b.js', cycle: ['src/a.js', 'src/b.js', 'src/a.js'] }]",
    "  },",
    "  modules: []",
    "}));"
  ].join("\n"),
  "utf8"
);

fs.writeFileSync(
  path.join(target, "scripts", "probe-mutation.mjs"),
  [
    "import fs from 'node:fs';",
    "fs.mkdirSync('reports', { recursive: true });",
    "fs.writeFileSync('reports/mutation.json', JSON.stringify({",
    "  files: {",
    "    'src/lib/foo.js': {",
    "      mutants: [{ status: 'Killed' }, { status: 'Survived' }, { status: 'NoCoverage' }]",
    "    }",
    "  }",
    "}));"
  ].join("\n"),
  "utf8"
);

const coverageDiffInvocation = `node "${cli}" coverage-diff --base-ref ${baseSha}`;
fs.writeFileSync(
  path.join(target, "package.json"),
  JSON.stringify(
    {
      name: "consumidor-adapters",
      packageManager: "npm@11.9.0",
      scripts: {
        "validate:coverage": `node scripts/probe-coverage.mjs && ${coverageDiffInvocation}`,
        "validate:deps": "node scripts/probe-deps.mjs",
        "validate:mutation": "node scripts/probe-mutation.mjs"
      }
    },
    null,
    2
  ),
  "utf8"
);

const contract = {
  version: 1,
  enforcement: "observe",
  tiers: { core: { description: "unico tier de esta prueba" } },
  surfaces: [{ id: "lib", path: "src/lib", tier: "core", money_path: true }],
  probes: [
    { id: "coverage", command: "validate:coverage", emits: "coverage/coverage-summary.json", format: "istanbul-summary", when_absent: "warn" },
    { id: "deps", command: "validate:deps", emits: "reports/dependencies.json", format: "dependency-cruiser", when_absent: "warn" },
    { id: "mutation", command: "validate:mutation", emits: "reports/mutation.json", format: "stryker", when_absent: "warn" }
  ],
  gates: [
    {
      id: "F8.changed-lines-coverage",
      phase: "F8",
      metric: "coverage.changed_lines_pct",
      op: "gte",
      mode: "observe",
      thresholds: { core: 40 },
      min_denominator: { metric: "coverage.changed_lines_total", value: 1 },
      provenance: "decision-de-equipo"
    },
    {
      id: "F9.mutation-survivors",
      phase: "F9",
      metric: "mutation.survived",
      op: "eq",
      mode: "observe",
      threshold: 0,
      min_denominator: { metric: "mutation.total", value: 1 },
      provenance: "decision-de-equipo"
    },
    {
      id: "F10.dependency-violations",
      phase: "F10",
      metric: "dependencies.violations",
      op: "eq",
      mode: "observe",
      threshold: 0,
      min_denominator: { metric: "dependencies.modules_scanned", value: 10 },
      provenance: "decision-de-equipo"
    }
  ]
};
fs.writeFileSync(path.join(target, "quality-contract.yaml"), YAML.stringify(contract), "utf8");

// --- F8: coverage real, calculada por coverage-diff sobre el diff real -----
const f8 = runCli(["quality-gate", "--target", target, "--slice", "slice-p1", "--phase", "F8", "--run", "--json"]);
assert.equal(f8.status, 0, f8.stderr);
const f8Payload = JSON.parse(f8.stdout);
assert.equal(f8Payload.probes.find((p) => p.id === "coverage").status, "ok", JSON.stringify(f8Payload.probes));

const coverageGate = f8Payload.evaluated.find((g) => g.id === "F8.changed-lines-coverage");
// Lineas cambiadas instrumentadas: 6 (hit) y 7 (sin hit). Las lineas 4, 5 y 8
// cambiaron pero no tienen statement propio y no deben contar.
assert.equal(coverageGate.actual, 50, "1 de 2 lineas cambiadas instrumentadas cubierta = 50%, no null ni 0 por defecto");
assert.notEqual(coverageGate.status, "not-measured");
assert.equal(coverageGate.status, "pass", "50 >= 40 (umbral core de esta prueba)");
const summary = JSON.parse(fs.readFileSync(path.join(target, "coverage", "coverage-summary.json"), "utf8"));
assert.equal(summary.changed.total, 2);
assert.equal(summary.changed.pct, 50);

// --- F9: mutacion real, agregada desde el reporte de stryker ----------------
const f9 = runCli(["quality-gate", "--target", target, "--slice", "slice-p1", "--phase", "F9", "--run", "--json"]);
assert.equal(f9.status, 0, f9.stderr);
const f9Payload = JSON.parse(f9.stdout);
const mutationGate = f9Payload.evaluated.find((g) => g.id === "F9.mutation-survivors");
assert.equal(mutationGate.actual, 1, "1 mutante Survived de 3, no null");
assert.equal(mutationGate.status, "fail");
assert.equal(f9Payload.status, "warning", "mode observe: informa, no bloquea");

// --- F10: dependencias reales, agregadas desde dependency-cruiser ----------
const f10 = runCli(["quality-gate", "--target", target, "--slice", "slice-p1", "--phase", "F10", "--run", "--json"]);
assert.equal(f10.status, 0, f10.stderr);
const f10Payload = JSON.parse(f10.stdout);
const depsGate = f10Payload.evaluated.find((g) => g.id === "F10.dependency-violations");
assert.equal(depsGate.actual, 1, "1 violacion (con 1 ciclo) de 12 modulos escaneados, no null");

// El ciclo detectado por dependency-cruiser tambien queda en la evidencia
// anexada, no solo en el payload de la corrida.
const evidence = YAML.parse(
  fs.readFileSync(path.join(target, ".github", "agent-state", "evidence", "slice-p1", "F10.yaml"), "utf8")
);
assert.equal(evidence.quality_metrics.metrics.dependencies.cycles, 1);
assert.equal(evidence.quality_metrics.metrics.dependencies.modules_scanned, 12);

console.log("quality-adapters e2e: PASS");
