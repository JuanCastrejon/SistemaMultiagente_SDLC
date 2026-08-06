// ---------------------------------------------------------------------------
// P7 (ADR 0007): F14 (merge) no mide nada propio. La sintesis original
// proponia un guard anti-regresion en F14 antes de fusionar; quedo sin
// conectar en 1.11.0 porque el mecanismo de quality_gates por fase adjudica
// sobre la evidencia de ESA MISMA fase, y F14 nunca produce mediciones
// propias (gap documentado, no resuelto). Este test prueba la herencia: F14
// declara gates de F8/F10 y se re-verifican leyendo la evidencia de la fase
// que SI midio, sin fabricar un mecanismo de arrastre.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "sdlc.js");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-phase-inheritance-"));
const target = path.join(tempRoot, "consumidor");

function run(args) {
  return execFileSync("node", [cli, ...args], { cwd: repoRoot, encoding: "utf8" });
}
function phaseGate(phase, slice) {
  return JSON.parse(run(["phase-gate", "--target", target, "--phase", phase, "--slice", slice, "--json"]));
}
function writeEvidence(slice, phase, body) {
  const dir = path.join(target, ".github", "agent-state", "evidence", slice);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${phase}.yaml`), YAML.stringify(body), "utf8");
}
function baseEvidence(phase, slice, extra = {}) {
  return {
    phase,
    slice,
    agent_id: "test",
    started_at: new Date(0).toISOString(),
    outputs: [],
    validators_run: [],
    ...extra
  };
}

fs.mkdirSync(target, { recursive: true });
run(["install", "--target", target, "--mode", "greenfield", "--project-name", "Demo", "--json"]);
// Las superficies por defecto (apps/api core, apps/web standard) tienen que
// existir en disco: sin esto checkSurfaces las marca fantasma y bloquea
// SIEMPRE, independiente de lo que digan los gates.
fs.mkdirSync(path.join(target, "apps", "api"), { recursive: true });
fs.writeFileSync(path.join(target, "apps", "api", "index.ts"), "export const api = 1;\n", "utf8");
fs.mkdirSync(path.join(target, "apps", "web"), { recursive: true });
fs.writeFileSync(path.join(target, "apps", "web", "index.ts"), "export const web = 1;\n", "utf8");

const slice = "slice-f14";

// --- F8 y F10: mediciones reales que F14 va a heredar -----------------------
writeEvidence(slice, "F8", baseEvidence("F8", slice, {
  quality_metrics: {
    measured_at: new Date(0).toISOString(),
    source: "ci",
    tree_hash: "hash-f8",
    probes: [],
    metrics: { coverage: { changed_lines_pct: 95, changed_lines_total: 20 } }
  }
}));
writeEvidence(slice, "F10", baseEvidence("F10", slice, {
  quality_metrics: {
    measured_at: new Date(0).toISOString(),
    source: "ci",
    tree_hash: "hash-f10",
    probes: [],
    metrics: { dependencies: { violations: 0, cycles: 0, modules_scanned: 12 } }
  }
}));

// F14 exige F13.yaml como input (QA de caja negra previo al merge).
writeEvidence(slice, "F13", baseEvidence("F13", slice, {
  human_gate_signoff: { approved_by: "maintainer", review_id: "PR-1" }
}));

// --- F14: NUNCA mide nada propio, solo trae la firma humana -----------------
writeEvidence(slice, "F14", baseEvidence("F14", slice, {
  human_gate_signoff: { approved_by: "maintainer", review_id: "PR-1" }
}));

// --- 1. Sano: F14 hereda F8/F10, todos pasan, y NO se le exige medicion propia
const healthy = phaseGate("F14", slice);
assert.equal(healthy.status, "ok", JSON.stringify(healthy));
assert.ok(healthy.quality, "F14 debe adjudicar calidad aunque no mida nada propio");
const healthyIds = healthy.quality.evaluated.map((entry) => entry.id);
assert.ok(healthyIds.includes("F8.changed-lines-coverage"));
assert.ok(healthyIds.includes("F10.dependency-violations"));
assert.ok(healthyIds.includes("F10.dependency-cycles"));
assert.ok(
  healthy.quality.evaluated.every((entry) => entry.status === "pass"),
  JSON.stringify(healthy.quality.evaluated)
);
assert.ok(
  !healthy.blockers.some((blocker) => blocker.includes("quality-metrics-absent")),
  "F14 sin quality_metrics propio es legitimo: sus gates son heredados, no propios"
);
assert.ok(!(healthy.evidence.smells ?? []).some((smell) => smell.code === "quality-metrics-absent"));

// --- Se promueve un baseline: sin el, un ratchet fallido en el absoluto es
// solo warning (se comporta como observe puro hasta la primera promocion,
// por diseño). Con baseline, F10 pasando de 0 a 5 violaciones es una
// REGRESION real, que ratchet SI bloquea.
writeEvidence(slice, "F15", baseEvidence("F15", slice, {
  quality_metrics: {
    measured_at: new Date(0).toISOString(),
    source: "ci",
    tree_hash: "hash-baseline",
    probes: [],
    metrics: {
      coverage: { changed_lines_pct: 95, changed_lines_total: 20 },
      dependencies: { violations: 0, cycles: 0, modules_scanned: 12 }
    }
  }
}));
const promoted = JSON.parse(run(["quality-baseline", "--target", target, "--promote", "--slice", slice, "--allow-local", "--json"]));
assert.equal(promoted.status, "ok", JSON.stringify(promoted));

// --- 2. F10 regresiono (5 violaciones): F14 bloquea el merge ----------------
writeEvidence(slice, "F10", baseEvidence("F10", slice, {
  quality_metrics: {
    measured_at: new Date(0).toISOString(),
    source: "ci",
    tree_hash: "hash-f10-bis",
    probes: [],
    metrics: { dependencies: { violations: 5, cycles: 0, modules_scanned: 12 } }
  }
}));
const regressed = phaseGate("F14", slice);
assert.equal(regressed.status, "blocked", JSON.stringify(regressed));
assert.ok(regressed.blockers.some((blocker) => blocker.includes("F10.dependency-violations")));
const depGate = regressed.quality.evaluated.find((entry) => entry.id === "F10.dependency-violations");
assert.equal(depGate.actual, 5);
assert.equal(depGate.status, "regression");
assert.equal(depGate.baseline, 0, "el baseline promovido, no la fase actual, es la comparacion");

// --- 3. F10 nunca corrio (evidencia ausente): F14 bloquea, no pasa por vacio
fs.rmSync(path.join(target, ".github", "agent-state", "evidence", slice, "F10.yaml"));
const skipped = phaseGate("F14", slice);
assert.equal(skipped.status, "blocked", JSON.stringify(skipped));
assert.ok(
  skipped.blockers.some((blocker) => blocker.includes("gate-not-measured") && blocker.includes("F10")),
  "fusionar sin que F10 haya corrido nunca no puede pasar en silencio"
);

console.log("phase-inheritance: PASS");
