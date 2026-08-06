// ---------------------------------------------------------------------------
// Adjudicacion de gates de calidad (ADR 0007, D3 y D4)
//
// Funcion PURA: sin fs, sin spawn, sin red. Recibe el contrato ya cargado y las
// metricas ya medidas, y decide. Todo lo que ejecuta herramientas vive fuera.
//
// Dos reglas de diseno que no son negociables:
//
// 1. NO-VACUIDAD ANTES QUE UMBRAL. Un gate con forma `== 0` se satisface con
//    denominador vacio: cero mutantes supervivientes sobre cero mutantes, cero
//    tests fallidos sobre cero tests, cero violaciones sobre una superficie cuyo
//    path no existe. Los tres son PASS hoy en cualquier implementacion ingenua y
//    son el modo de fallo mas peligroso del sistema, porque el tablero se ve
//    verde justo cuando no se midio nada. Cada gate declara su denominador
//    minimo y aqui se comprueba ANTES de aplicar el operador.
//
// 2. ESCALERA. Ningun control nace bloqueante. `observe` mide y publica,
//    `ratchet` compara contra la linea base y solo `block` produce blocker.
// ---------------------------------------------------------------------------

export const GATE_MODES = new Set(["observe", "ratchet", "block"]);

export const GATE_OPERATORS = {
  gte: (actual, expected) => actual >= expected,
  lte: (actual, expected) => actual <= expected,
  eq: (actual, expected) => actual === expected,
  neq: (actual, expected) => actual !== expected,
  exists: (actual) => actual !== null && actual !== undefined,
  absent: (actual) => actual === null || actual === undefined
};

const OPERATOR_LABEL = {
  gte: ">=",
  lte: "<=",
  eq: "==",
  neq: "!=",
  exists: "existe",
  absent: "ausente"
};

// Resuelve `coverage.changed_lines_pct` dentro del objeto de metricas.
export function resolveMetric(metrics, dottedPath) {
  if (!dottedPath || typeof dottedPath !== "string") return undefined;
  let cursor = metrics;
  for (const segment of dottedPath.split(".")) {
    if (cursor === null || cursor === undefined || typeof cursor !== "object") return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

function resolveThreshold(gate, tier) {
  if (gate.thresholds && typeof gate.thresholds === "object") {
    if (tier && Object.prototype.hasOwnProperty.call(gate.thresholds, tier)) {
      return { value: gate.thresholds[tier], source: `thresholds.${tier}` };
    }
    if (Object.prototype.hasOwnProperty.call(gate.thresholds, "default")) {
      return { value: gate.thresholds.default, source: "thresholds.default" };
    }
  }
  if (Object.prototype.hasOwnProperty.call(gate, "threshold")) {
    return { value: gate.threshold, source: "threshold" };
  }
  return { value: undefined, source: null };
}

// Un gate solo puede juzgar si su denominador minimo se cumple. `min_denominator`
// es { metric, value }: cuantos sujetos hubo que evaluar realmente.
function checkDenominator(gate, metrics) {
  const declared = gate.min_denominator;
  if (!declared) {
    return { required: false, ok: true };
  }
  const actual = resolveMetric(metrics, declared.metric);
  const minimum = typeof declared.value === "number" ? declared.value : 1;
  if (typeof actual !== "number") {
    return { required: true, ok: false, metric: declared.metric, minimum, actual: null, reason: "denominador ausente" };
  }
  return {
    required: true,
    ok: actual >= minimum,
    metric: declared.metric,
    minimum,
    actual,
    reason: actual >= minimum ? null : "denominador por debajo del minimo"
  };
}

/**
 * @param {object} input
 * @param {Array}  input.gates      Gates del contrato, ya filtrados o no por fase.
 * @param {object} input.metrics    Metricas medidas, anidadas.
 * @param {string} [input.phase]    Si viene, solo se evaluan los gates de esa fase.
 * @param {string} [input.tier]     Tier de la superficie evaluada.
 * @param {object} [input.baseline] Linea base para los gates en modo ratchet.
 * @returns {{evaluated: Array, violations: Array, warnings: Array, vacuous: Array, status: string}}
 */
export function evaluateQualityGates({ gates = [], metrics = {}, phase = null, tier = null, baseline = {} } = {}) {
  const evaluated = [];
  const violations = [];
  const warnings = [];
  const vacuous = [];

  for (const gate of gates) {
    if (phase && gate.phase && gate.phase !== phase) continue;

    const mode = GATE_MODES.has(gate.mode) ? gate.mode : "observe";
    const operator = GATE_OPERATORS[gate.op];
    const actual = resolveMetric(metrics, gate.metric);
    const { value: threshold, source: thresholdSource } = resolveThreshold(gate, tier);
    const entry = {
      id: gate.id,
      phase: gate.phase ?? null,
      metric: gate.metric,
      op: gate.op,
      mode,
      actual: actual ?? null,
      threshold: threshold ?? null,
      thresholdSource,
      tier
    };

    if (!operator) {
      entry.status = "error";
      entry.reason = `operador desconocido: ${gate.op}`;
      evaluated.push(entry);
      violations.push({ code: "gate-invalid", id: gate.id, detail: entry.reason });
      continue;
    }

    // La metrica no se midio: el gate no puede juzgar y NO puede pasar en
    // silencio, que es exactamente como se cuela un falso verde.
    if (actual === undefined && gate.op !== "absent") {
      entry.status = "not-measured";
      entry.reason = `no hay metrica en ${gate.metric}`;
      evaluated.push(entry);
      const finding = { code: "gate-not-measured", id: gate.id, metric: gate.metric, mode };
      if (mode === "block") violations.push(finding);
      else warnings.push(finding);
      continue;
    }

    const denominator = checkDenominator(gate, metrics);
    if (denominator.required && !denominator.ok) {
      entry.status = "vacuous";
      entry.denominator = denominator;
      entry.reason = `${denominator.reason}: ${denominator.metric}=${denominator.actual ?? "n/a"} < ${denominator.minimum}`;
      evaluated.push(entry);
      const finding = { code: "gate-vacuous", id: gate.id, detail: entry.reason, mode };
      vacuous.push(finding);
      // Un gate vacuo nunca es PASS. En modo block es violacion; en el resto,
      // advertencia visible.
      if (mode === "block") violations.push(finding);
      else warnings.push(finding);
      continue;
    }
    if (denominator.required) entry.denominator = denominator;

    let passed;
    if (gate.op === "exists" || gate.op === "absent") {
      passed = operator(actual);
    } else if (threshold === undefined) {
      entry.status = "error";
      entry.reason = `el gate ${gate.id} no declara umbral para tier ${tier ?? "(sin tier)"}`;
      evaluated.push(entry);
      violations.push({ code: "gate-threshold-missing", id: gate.id, detail: entry.reason });
      continue;
    } else {
      passed = operator(actual, threshold);
    }

    // Ratchet: ademas del umbral, no se puede empeorar respecto de la base.
    // La direccion de "empeorar" depende del operador, NO se puede asumir
    // "mas alto es mejor" como default: gte (cobertura) sube, lte y eq
    // (violaciones, ciclos, mutantes) bajan. Un default equivocado aqui
    // invierte el ratchet: marcaria como regresion justo las mejoras, que es
    // el tipo de bug que este mismo diseno existe para atrapar en el
    // consumidor, no para cometer en el engine.
    if (mode === "ratchet") {
      const baseValue = resolveMetric(baseline, gate.metric);
      entry.baseline = baseValue ?? null;
      if (typeof baseValue === "number" && typeof actual === "number") {
        const worseIsHigher = gate.op === "lte" || gate.op === "eq";
        const regressed = worseIsHigher ? actual > baseValue : actual < baseValue;
        entry.regressed = regressed;
        if (regressed) {
          entry.status = "regression";
          entry.reason = `regresion contra baseline: ${actual} vs ${baseValue}`;
          evaluated.push(entry);
          warnings.push({ code: "gate-regression", id: gate.id, detail: entry.reason, mode });
          continue;
        }
      }
    }

    entry.status = passed ? "pass" : "fail";
    if (!passed) {
      entry.reason = `${gate.metric}=${actual} no cumple ${OPERATOR_LABEL[gate.op] ?? gate.op} ${threshold}`;
    }
    evaluated.push(entry);

    if (!passed) {
      const finding = { code: "gate-failed", id: gate.id, detail: entry.reason, mode };
      // La escalera: observe y ratchet informan, solo block detiene.
      if (mode === "block") violations.push(finding);
      else warnings.push(finding);
    }
  }

  return {
    status: violations.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ok",
    evaluated,
    violations,
    warnings,
    vacuous
  };
}
