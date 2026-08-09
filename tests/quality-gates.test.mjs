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
// Un gate en modo ratchet BLOQUEA al regresionar: ese es el sentido del
// ratchet. El default de on_regression es "block" cuando mode es "ratchet".
assert.equal(regression.status, "blocked");
assert.equal(regression.violations[0].code, "gate-regression");
// Y se puede degradar explicitamente a aviso si el consumidor lo declara.
const regressionWarnOnly = evaluateQualityGates({
  gates: [{ ...ratchetGate, on_regression: "warn" }],
  metrics: { coverage: { lines_pct: 71 } },
  baseline: { coverage: { lines_pct: 80 } }
});
assert.equal(regressionWarnOnly.status, "warning");

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

// Bug real encontrado al conectar el baseline: `eq` (violaciones, ciclos)
// heredaba la direccion de `gte` y marcaba una MEJORA como regresion.
//
// Bajar de 5 a 2 violaciones NO regresiona (el umbral absoluto sigue sin
// cumplirse porque el objetivo final es 0, y ratchet no exime de el; lo que
// importa aqui es que `regressed` sea false y el status NO sea "regression").
const eqImprovement = evaluateQualityGates({
  gates: [{ id: "deps", metric: "dependencies.violations", op: "eq", mode: "ratchet", threshold: 0 }],
  metrics: { dependencies: { violations: 2 } },
  baseline: { dependencies: { violations: 5 } }
});
assert.equal(eqImprovement.evaluated[0].status, "fail", "2 sigue sin ser 0, pero no es peor que el baseline");
assert.equal(eqImprovement.evaluated[0].regressed, false);
assert.equal(eqImprovement.violations.length, 0, "ratchet no bloquea, solo observa/avisa");

// Subir de 2 a 5 violaciones SI es regresion: se detecta antes de mirar el
// umbral absoluto, y con la direccion correcta (antes del fix, este caso se
// habria colado como pass).
const eqRegression = evaluateQualityGates({
  gates: [{ id: "deps", metric: "dependencies.violations", op: "eq", mode: "ratchet", threshold: 0 }],
  metrics: { dependencies: { violations: 5 } },
  baseline: { dependencies: { violations: 2 } }
});
assert.equal(eqRegression.evaluated[0].status, "regression");
assert.equal(eqRegression.evaluated[0].regressed, true);

// --- P0.1: el baseline se compara SIEMPRE, no solo en mode ratchet ---------
// Antes, un gate en mode block con regresion pasaba inadvertido mientras el
// valor siguiera cumpliendo el umbral absoluto.
const blockWithRegression = evaluateQualityGates({
  gates: [{ id: "cov", metric: "coverage.lines_pct", op: "gte", mode: "block", threshold: 80, on_regression: "block" }],
  metrics: { coverage: { lines_pct: 85 } },
  baseline: { coverage: { lines_pct: 95 } }
});
assert.equal(blockWithRegression.evaluated[0].regressed, true, "85 < 95 es regresion aunque cumpla el umbral 80");
assert.equal(blockWithRegression.status, "blocked");
assert.equal(blockWithRegression.violations[0].code, "gate-regression");

// El umbral absoluto se sigue evaluando aunque haya regresion: antes el
// `continue` tras detectarla impedia que se reportara el fallo de umbral.
const bothFail = evaluateQualityGates({
  gates: [{ id: "cov", metric: "coverage.lines_pct", op: "gte", mode: "ratchet", threshold: 80 }],
  metrics: { coverage: { lines_pct: 12 } },
  baseline: { coverage: { lines_pct: 95 } }
});
assert.equal(bothFail.evaluated[0].status, "regression");
const codes = [...bothFail.violations, ...bothFail.warnings].map((f) => f.code).sort();
assert.deepEqual(codes, ["gate-failed", "gate-regression"], "deben reportarse ambos hallazgos, no solo el primero");

// on_regression separa modo de efecto: observe puede bloquear al regresionar.
const observeButBlocksRegression = evaluateQualityGates({
  gates: [{ id: "cov", metric: "coverage.lines_pct", op: "gte", mode: "observe", threshold: 0, on_regression: "block" }],
  metrics: { coverage: { lines_pct: 70 } },
  baseline: { coverage: { lines_pct: 90 } }
});
assert.equal(observeButBlocksRegression.status, "blocked");

// --- P0.3: un gate declarado por la fase que no se mide es violacion -------
const notMeasuredDeclared = evaluateQualityGates({
  gates: [{ id: "F8.cov", phase: "F8", metric: "coverage.changed_lines_pct", op: "gte", mode: "observe", threshold: 90 }],
  metrics: {},
  phase: "F8",
  declaredByContract: ["F8.cov"]
});
assert.equal(notMeasuredDeclared.status, "blocked", "la fase promete medir y no midio");
assert.equal(notMeasuredDeclared.violations[0].code, "gate-not-measured");
assert.equal(notMeasuredDeclared.evaluated[0].declaredByPhase, true);

// El mismo gate NO declarado por la fase sigue siendo aviso en modo observe.
const notMeasuredUndeclared = evaluateQualityGates({
  gates: [{ id: "F8.cov", phase: "F8", metric: "coverage.changed_lines_pct", op: "gte", mode: "observe", threshold: 90 }],
  metrics: {},
  phase: "F8"
});
assert.equal(notMeasuredUndeclared.status, "warning");

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
