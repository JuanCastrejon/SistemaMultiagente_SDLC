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
export function evaluateQualityGates({
  gates = [],
  metrics = {},
  phase = null,
  tier = null,
  baseline = {},
  // Ids de gates que la FASE declara en phase-contract.yaml. Un gate declarado
  // por el contrato de fases es una promesa explicita de medir algo; si no se
  // midio, la promesa se incumplio y eso no puede degradarse a aviso segun el
  // modo. El modo gradua cuan exigente es el umbral, no si la medicion existe.
  declaredByContract = null,
  // Probes que el repo declara NO PODER ejecutar todavia, con motivo escrito
  // (`resolveUnavailableProbes`). Un gate cuya metrica depende de uno de ellos
  // sale `not-applicable` en vez de `not-measured`: NO MEDIDO e INCUMPLIDO son
  // cosas distintas y confundirlas en un solo rojo es lo que ensena a ignorar
  // la senal (RN-AC-03/RN-AC-05 del consumidor). La exencion se declara sobre
  // la CAPACIDAD ausente, nunca gate por gate: asi no se puede silenciar un
  // gate que si se podria medir sin declarar que se renuncia a medir toda su
  // familia.
  unavailableProbes = []
} = {}) {
  const unavailableByPrefix = new Map(
    (unavailableProbes ?? [])
      .filter((probe) => probe && probe.prefix && probe.reason)
      .map((probe) => [probe.prefix, probe])
  );
  const findUnavailable = (metric) => {
    if (typeof metric !== "string") return null;
    return unavailableByPrefix.get(metric.split(".")[0]) ?? null;
  };
  const declaredSet = declaredByContract instanceof Set
    ? declaredByContract
    : Array.isArray(declaredByContract)
      ? new Set(declaredByContract)
      : null;
  const evaluated = [];
  const violations = [];
  const warnings = [];
  const vacuous = [];
  const notApplicable = [];

  for (const gate of gates) {
    if (phase && gate.phase && gate.phase !== phase) continue;
    const declaredByPhase = declaredSet ? declaredSet.has(gate.id) : false;

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

    const unavailable = findUnavailable(gate.metric);
    // Declarado no medible Y medido de todas formas: la declaracion esta
    // obsoleta o es falsa. Se evalua con el numero real —medir gana siempre— y
    // se avisa, porque una exencion que sobrevive a la capacidad que dice que
    // falta es justo el mecanismo con el que se bajaria el liston en silencio.
    if (unavailable && actual !== undefined) {
      warnings.push({
        code: "probe-unavailable-but-measured",
        id: gate.id,
        metric: gate.metric,
        probe: unavailable.probeId,
        detail: `el contrato declara '${unavailable.probeId}' no disponible, pero hay metrica en ${gate.metric}: retirar la declaracion`
      });
    }

    // La metrica no se midio: el gate no puede juzgar y NO puede pasar en
    // silencio, que es exactamente como se cuela un falso verde.
    if (actual === undefined && gate.op !== "absent" && unavailable) {
      entry.status = "not-applicable";
      entry.declaredByPhase = declaredByPhase;
      entry.probe = unavailable.probeId;
      entry.reason = unavailable.reason;
      evaluated.push(entry);
      notApplicable.push({
        code: "gate-not-applicable",
        id: gate.id,
        metric: gate.metric,
        probe: unavailable.probeId,
        reason: unavailable.reason,
        declaredByPhase
      });
      continue;
    }

    if (actual === undefined && gate.op !== "absent") {
      entry.status = "not-measured";
      entry.declaredByPhase = declaredByPhase;
      entry.reason = declaredByPhase
        ? `la fase declara el gate ${gate.id} pero no hay metrica en ${gate.metric}`
        : `no hay metrica en ${gate.metric}`;
      evaluated.push(entry);
      const finding = { code: "gate-not-measured", id: gate.id, metric: gate.metric, mode, declaredByPhase };
      // Si la fase lo declara en su contrato, no medirlo es incumplir el
      // contrato, sin importar el modo del gate.
      if (mode === "block" || declaredByPhase) violations.push(finding);
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

    // El baseline se compara SIEMPRE que exista, no solo en mode "ratchet".
    // Atarlo al modo tenia dos consecuencias malas: en mode "block" una
    // regresion pasaba inadvertida mientras el valor siguiera cumpliendo el
    // umbral, y en mode "ratchet" el umbral absoluto no llegaba a evaluarse
    // nunca porque la deteccion de regresion cortaba el flujo.
    //
    // La direccion de "empeorar" depende del operador, NO se puede asumir
    // "mas alto es mejor" como default: gte (cobertura) sube, lte y eq
    // (violaciones, ciclos, mutantes) bajan.
    const baseValue = resolveMetric(baseline, gate.metric);
    let regressed = false;
    if (typeof baseValue === "number" && typeof actual === "number") {
      entry.baseline = baseValue;
      const worseIsHigher = gate.op === "lte" || gate.op === "eq";
      regressed = worseIsHigher ? actual > baseValue : actual < baseValue;
      entry.regressed = regressed;
    } else {
      entry.baseline = baseValue ?? null;
    }

    // Modo y efecto son cosas distintas. `mode` dice que tan exigente es el
    // umbral absoluto; `on_regression` dice que pasa si ademas se empeora
    // respecto de la linea base. Por defecto, un gate en ratchet bloquea al
    // regresionar (es el sentido del ratchet) y en cualquier otro modo avisa.
    const onRegression = gate.on_regression ?? (mode === "ratchet" ? "block" : "warn");
    entry.onRegression = onRegression;

    // El umbral absoluto se evalua SIEMPRE, haya o no regresion.
    entry.status = regressed ? "regression" : passed ? "pass" : "fail";
    const reasons = [];
    if (!passed) {
      reasons.push(`${gate.metric}=${actual} no cumple ${OPERATOR_LABEL[gate.op] ?? gate.op} ${threshold}`);
    }
    if (regressed) {
      reasons.push(`regresion contra baseline: ${actual} vs ${baseValue}`);
    }
    if (reasons.length > 0) entry.reason = reasons.join("; ");
    evaluated.push(entry);

    if (regressed) {
      const finding = {
        code: "gate-regression",
        id: gate.id,
        detail: `regresion contra baseline: ${actual} vs ${baseValue}`,
        mode,
        onRegression
      };
      if (onRegression === "block") violations.push(finding);
      else warnings.push(finding);
    }
    if (!passed) {
      const finding = { code: "gate-failed", id: gate.id, detail: reasons[0], mode };
      // La escalera: observe y ratchet informan sobre el umbral absoluto,
      // solo block detiene por el.
      if (mode === "block") violations.push(finding);
      else warnings.push(finding);
    }
  }

  // `notApplicable` NO entra en el status: es lo declarado como no medible con
  // motivo, y su sitio es la salida —visible siempre—, no el veredicto. Un
  // repo que declara honestamente lo que no puede medir queda en verde; lo que
  // no puede quedar en verde es lo que NO se midio sin decir por que.
  return {
    status: violations.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ok",
    evaluated,
    violations,
    warnings,
    vacuous,
    notApplicable
  };
}
