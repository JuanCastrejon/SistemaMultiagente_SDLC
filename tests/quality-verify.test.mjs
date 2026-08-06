// ---------------------------------------------------------------------------
// P4 (ADR 0007): "el arbitro es CI, no el harness local" (D1) exigia comparar
// lo recomputado contra lo declarado, y hasta ahora esa comparacion no
// existia en ninguna linea de codigo -- CI solo re-adjudicaba de forma
// independiente. detectEvidenceMismatch es el detector de fraude que la
// decision 6 del cierre dejo "subordinada a implementar".
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { detectEvidenceMismatch } from "../src/quality-verify.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "sdlc.js");
const adaptersSource = path.join(repoRoot, "templates", "scripts", "quality-adapters");

function runCli(args) {
  return spawnSync("node", [cli, ...args], { cwd: repoRoot, encoding: "utf8" });
}

// --- unidad: detectEvidenceMismatch -----------------------------------------
assert.deepEqual(detectEvidenceMismatch({ prior: null, fresh: { tree_hash: "a", metrics: {} } }), []);
assert.deepEqual(detectEvidenceMismatch({ prior: { tree_hash: "a", metrics: {} }, fresh: null }), []);

// Arboles distintos: el codigo cambio entre corridas, una diferencia de
// metricas es esperable y no dice nada sobre fraude.
assert.deepEqual(
  detectEvidenceMismatch({
    prior: { source: "harness", tree_hash: "a", metrics: { coverage: { pct: 10 } } },
    fresh: { tree_hash: "b", metrics: { coverage: { pct: 99 } } }
  }),
  []
);

// CI contra CI no responde la pregunta de si el harness LOCAL mintio.
assert.deepEqual(
  detectEvidenceMismatch({
    prior: { source: "ci", tree_hash: "a", metrics: { coverage: { pct: 10 } } },
    fresh: { tree_hash: "a", metrics: { coverage: { pct: 99 } } }
  }),
  []
);

// Mismo arbol, harness declaro distinto de lo que CI recomputo: mismatch real.
const mismatch = detectEvidenceMismatch({
  prior: {
    source: "harness",
    tree_hash: "a",
    metrics: { coverage: { changed_lines_pct: 95 }, mutation: { survived: 0 } }
  },
  fresh: {
    tree_hash: "a",
    metrics: { coverage: { changed_lines_pct: 40 }, mutation: { survived: 0 } }
  }
});
assert.equal(mismatch.length, 1);
assert.equal(mismatch[0].code, "evidence-mismatch");
assert.equal(mismatch[0].metric, "coverage.changed_lines_pct");
assert.equal(mismatch[0].declared, 95);
assert.equal(mismatch[0].recomputed, 40);

// Mismo arbol, mismos numeros: nada que reportar.
assert.deepEqual(
  detectEvidenceMismatch({
    prior: { source: "harness", tree_hash: "a", metrics: { coverage: { pct: 90 } } },
    fresh: { tree_hash: "a", metrics: { coverage: { pct: 90 } } }
  }),
  []
);

// Tolerancia declarada para jitter esperado (ej. porcentajes con redondeo).
assert.deepEqual(
  detectEvidenceMismatch({
    prior: { source: "harness", tree_hash: "a", metrics: { coverage: { pct: 90.01 } } },
    fresh: { tree_hash: "a", metrics: { coverage: { pct: 90.02 } } },
    tolerance: { "coverage.pct": 0.1 }
  }),
  []
);

console.log("quality-verify unit: PASS");

// --- E2E: harness declara X, CI recomputa Y sobre el MISMO arbol -----------
const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-evidence-mismatch-")), "consumidor");
fs.mkdirSync(path.join(target, "src"), { recursive: true });
fs.mkdirSync(path.join(target, "scripts", "quality-adapters"), { recursive: true });
fs.copyFileSync(path.join(adaptersSource, "istanbul-summary.mjs"), path.join(target, "scripts", "quality-adapters", "istanbul-summary.mjs"));
fs.writeFileSync(path.join(target, "src", "lib.js"), "export const x = 1;\n", "utf8");
fs.writeFileSync(
  path.join(target, "scripts", "probe.mjs"),
  [
    "import fs from 'node:fs';",
    "const control = JSON.parse(fs.readFileSync('control.json', 'utf8'));",
    "fs.mkdirSync('reports', { recursive: true });",
    "fs.writeFileSync('reports/metric.json', JSON.stringify({ total: { lines: { pct: control.pct } } }));"
  ].join("\n"),
  "utf8"
);
fs.writeFileSync(
  path.join(target, "package.json"),
  JSON.stringify({ name: "consumidor-mismatch", packageManager: "npm@11.9.0", scripts: { "validate:metric": "node scripts/probe.mjs" } }, null, 2),
  "utf8"
);
const contract = {
  version: 1,
  enforcement: "observe",
  tiers: { core: { description: "unico tier de esta prueba" } },
  surfaces: [{ id: "s", path: "src", tier: "core" }],
  probes: [{ id: "metric", command: "validate:metric", emits: "reports/metric.json", format: "istanbul-summary", when_absent: "warn" }],
  gates: []
};
fs.writeFileSync(path.join(target, "quality-contract.yaml"), YAML.stringify(contract), "utf8");
function setControl(pct) {
  fs.writeFileSync(path.join(target, "control.json"), JSON.stringify({ pct }), "utf8");
}

// 1. Corrida local (harness): declara 95%.
setControl(95);
const local = JSON.parse(runCli(["quality-gate", "--target", target, "--slice", "s1", "--phase", "F8", "--run", "--json"]).stdout);
assert.equal(local.status, "ok");
assert.equal(local.advisory, true);

// 2. CI recomputa sobre el MISMO codigo (src/lib.js no cambio) y obtiene 40%:
// el harness local mintio, o algo cambio el reporte sin cambiar el arbol.
setControl(40);
const ci = JSON.parse(runCli(["quality-gate", "--target", target, "--slice", "s1", "--phase", "F8", "--run", "--source", "ci", "--json"]).stdout);
assert.equal(ci.status, "blocked", JSON.stringify(ci));
const mismatchFinding = ci.surfaceFindings.find((f) => f.code === "evidence-mismatch");
assert.ok(mismatchFinding, "CI debe detectar que el arbol es el mismo y los numeros no");
assert.equal(mismatchFinding.metric, "coverage.lines_pct");
assert.equal(mismatchFinding.declared, 95);
assert.equal(mismatchFinding.recomputed, 40);

// 3. Otra fase/slice: harness declara 90%, CI recomputa 90% sobre el mismo
// arbol. Coinciden: sin evidence-mismatch.
setControl(90);
runCli(["quality-gate", "--target", target, "--slice", "s2", "--phase", "F8", "--run", "--json"]);
const ciMatching = JSON.parse(
  runCli(["quality-gate", "--target", target, "--slice", "s2", "--phase", "F8", "--run", "--source", "ci", "--json"]).stdout
);
assert.ok(!ciMatching.surfaceFindings.some((f) => f.code === "evidence-mismatch"));

// 4. Otra fase/slice mas: el CODIGO cambia entre la corrida local y la de CI.
// Los numeros tambien difieren, pero el arbol ya no es el mismo: no se puede
// acusar de mismatch algo que nunca fue la misma medicion.
setControl(20);
runCli(["quality-gate", "--target", target, "--slice", "s3", "--phase", "F8", "--run", "--json"]);
fs.writeFileSync(path.join(target, "src", "lib.js"), "export const x = 2;\n", "utf8");
setControl(99);
const ciDifferentTree = JSON.parse(
  runCli(["quality-gate", "--target", target, "--slice", "s3", "--phase", "F8", "--run", "--source", "ci", "--json"]).stdout
);
assert.ok(
  !ciDifferentTree.surfaceFindings.some((f) => f.code === "evidence-mismatch"),
  "un arbol distinto no es evidencia de fraude, es codigo distinto"
);

console.log("quality-verify e2e: PASS");
