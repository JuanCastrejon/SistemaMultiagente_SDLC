import assert from "node:assert/strict";
import { evaluateQualityGates, resolveMetric } from "../src/quality-gates.js";

// --- resolveMetric ---------------------------------------------------------
assert.equal(resolveMetric({ coverage: { lines_pct: 91 } }, "coverage.lines_pct"), 91);
assert.equal(resolveMetric({ coverage: {} }, "coverage.lines_pct"), undefined);
assert.equal(resolveMetric({}, "a.b.c"), undefined);
assert.equal(resolveMetric(null, "a"), undefined);

// --- caso feliz ------------------------------------------------------------
const passing = evaluateQualityGates({
  gates: [
    {
      id: "F9.coverage",
      phase: "F9",
      metric: "coverage.changed_lines_pct",
      op: "gte",
      mode: "block",
      thresholds: { core: 90, standard: 80 },
      min_denominator: { metric: "coverage.changed_lines_total", value: 1 }
    }
  ],
  metrics: { coverage: { changed_lines_pct: 93, changed_lines_total: 40 } },
  phase: "F9",
  tier: "core"
});
assert.equal(passing.status, "ok");
assert.equal(passing.evaluated[0].status, "pass");
assert.equal(passing.evaluated[0].threshold, 90);
assert.equal(passing.evaluated[0].thresholdSource, "thresholds.core");

// --- NO-VACUIDAD: el corazon del diseno ------------------------------------
// survived == 0 sobre CERO mutantes es el falso verde clasico.
const vacuousGate = {
  id: "F9.mutation",
  phase: "F9",
  metric: "mutation.survived",
  op: "eq",
  mode: "block",
  threshold: 0,
  min_denominator: { metric: "mutation.total", value: 1 }
};
const vacuous = evaluateQualityGates({
  gates: [vacuousGate],
  metrics: { mutation: { survived: 0, total: 0 } },
  phase: "F9",
  tier: "core"
});
assert.equal(vacuous.status, "blocked", "un gate vacuo en modo block debe bloquear, no pasar");
assert.equal(vacuous.evaluated[0].status, "vacuous");
assert.equal(vacuous.vacuous.length, 1);
assert.ok(!vacuous.evaluated.some((entry) => entry.status === "pass"));

// El mismo gate con denominador real si puede juzgar.
const notVacuous = evaluateQualityGates({
  gates: [vacuousGate],
  metrics: { mutation: { survived: 0, total: 37 } },
  phase: "F9",
  tier: "core"
});
assert.equal(notVacuous.status, "ok");
assert.equal(notVacuous.evaluated[0].status, "pass");

// En modo observe, el gate vacuo avisa pero no bloquea.
const vacuousObserve = evaluateQualityGates({
  gates: [{ ...vacuousGate, mode: "observe" }],
  metrics: { mutation: { survived: 0, total: 0 } },
  phase: "F9"
});
assert.equal(vacuousObserve.status, "warning");
assert.equal(vacuousObserve.violations.length, 0);
assert.equal(vacuousObserve.vacuous.length, 1);

// --- metrica ausente: nunca es pass ---------------------------------------
const notMeasured = evaluateQualityGates({
  gates: [{ id: "F9.crap", metric: "complexity.crap_max", op: "lte", mode: "block", threshold: 8 }],
  metrics: {}
});
assert.equal(notMeasured.status, "blocked");
assert.equal(notMeasured.evaluated[0].status, "not-measured");

// --- escalera: el mismo fallo segun el modo -------------------------------
const failingGate = { id: "g", metric: "coverage.lines_pct", op: "gte", threshold: 90 };
const metricsFailing = { coverage: { lines_pct: 12 } };
assert.equal(evaluateQualityGates({ gates: [{ ...failingGate, mode: "observe" }], metrics: metricsFailing }).status, "warning");
assert.equal(evaluateQualityGates({ gates: [{ ...failingGate, mode: "block" }], metrics: metricsFailing }).status, "blocked");

// --- ratchet: no empeorar respecto de la base ------------------------------
const ratchetGate = { id: "r", metric: "coverage.lines_pct", op: "gte", mode: "ratchet", threshold: 0 };
const regression = evaluateQualityGates({
  gates: [ratchetGate],
  metrics: { coverage: { lines_pct: 71 } },
  baseline: { coverage: { lines_pct: 80 } }
});
assert.equal(regression.evaluated[0].status, "regression");
assert.equal(regression.status, "warning");

const improvement = evaluateQualityGates({
  gates: [ratchetGate],
  metrics: { coverage: { lines_pct: 84 } },
  baseline: { coverage: { lines_pct: 80 } }
});
assert.equal(improvement.evaluated[0].status, "pass");

// Ratchet con op lte: empeorar es SUBIR (por ejemplo, complejidad maxima).
const ratchetLte = evaluateQualityGates({
  gates: [{ id: "crap", metric: "complexity.crap_max", op: "lte", mode: "ratchet", threshold: 100 }],
  metrics: { complexity: { crap_max: 14 } },
  baseline: { complexity: { crap_max: 9 } }
});
assert.equal(ratchetLte.evaluated[0].status, "regression");

// --- errores de contrato ---------------------------------------------------
const unknownOp = evaluateQualityGates({ gates: [{ id: "x", metric: "a", op: "aproximadamente" }], metrics: { a: 1 } });
assert.equal(unknownOp.violations[0].code, "gate-invalid");

const missingThreshold = evaluateQualityGates({
  gates: [{ id: "y", metric: "a", op: "gte", thresholds: { core: 10 } }],
  metrics: { a: 5 },
  tier: "shell"
});
assert.equal(missingThreshold.violations[0].code, "gate-threshold-missing");

// --- filtro por fase -------------------------------------------------------
const byPhase = evaluateQualityGates({
  gates: [
    { id: "a", phase: "F8", metric: "m", op: "gte", threshold: 1 },
    { id: "b", phase: "F9", metric: "m", op: "gte", threshold: 1 }
  ],
  metrics: { m: 5 },
  phase: "F9"
});
assert.equal(byPhase.evaluated.length, 1);
assert.equal(byPhase.evaluated[0].id, "b");

// --- operadores de presencia ----------------------------------------------
const exists = evaluateQualityGates({
  gates: [{ id: "e", metric: "report.path", op: "exists", mode: "block" }],
  metrics: { report: { path: "coverage/lcov.info" } }
});
assert.equal(exists.status, "ok");
const absent = evaluateQualityGates({
  gates: [{ id: "e", metric: "report.path", op: "exists", mode: "block" }],
  metrics: {}
});
assert.equal(absent.status, "blocked");

console.log("quality-gates: PASS");
