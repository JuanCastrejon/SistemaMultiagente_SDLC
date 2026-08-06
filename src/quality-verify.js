// ---------------------------------------------------------------------------
// Detector de evidence-mismatch (ADR 0007, D1 y decision 6 del cierre de
// decisiones)
//
// El diseño dice que el arbitro es CI, no el harness local: CI RE-EJECUTA y
// COMPARA contra lo que la evidencia ya declaraba. Hasta esta pieza,
// "comparar" no pasaba de una frase en el ADR: CI recomputaba metricas y las
// adjudicaba de forma independiente, pero nunca las cotejaba bit a bit contra
// lo que el harness local (advisory) habia declarado para el MISMO arbol de
// codigo. Sin esa comparacion, un agente puede escribir numeros optimistas en
// su corrida local y confiar en que nadie los coteje despues.
//
// La comparacion SOLO aplica cuando el arbol coincide (`tree_hash` igual): si
// el codigo cambio entre la corrida local y la de CI, una diferencia de
// metricas es esperable y no es evidencia de nada. Comparar sobre arboles
// distintos seria puro ruido, el mismo error que "vacuidad" combate en el
// resto del gauntlet pero en la direccion contraria: aqui el riesgo no es un
// falso verde por denominador vacio, es un falso ROJO por comparar cosas que
// nunca fueron la misma medicion.
// ---------------------------------------------------------------------------

import { resolveMetric } from "./quality-gates.js";

function collectMetricPaths(...objects) {
  const paths = new Set();
  function walk(node, prefix) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    for (const [key, value] of Object.entries(node)) {
      const next = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === "object" && !Array.isArray(value)) walk(value, next);
      else paths.add(next);
    }
  }
  for (const object of objects) walk(object, "");
  return [...paths];
}

/**
 * @param {object} input
 * @param {object|null} input.prior     Bloque quality_metrics anterior (measured_at, source, tree_hash, metrics).
 * @param {object|null} input.fresh     Bloque quality_metrics recien escrito por esta corrida.
 * @param {object} [input.tolerance]    Delta absoluto permitido por metrica (dotted path). Default 0: exacto.
 * @returns {Array} hallazgos `evidence-mismatch`; vacio si no hay nada comparable o todo coincide.
 */
export function detectEvidenceMismatch({ prior = null, fresh = null, tolerance = {} } = {}) {
  if (!prior || !fresh) return [];
  // Comparar CI contra CI no dice nada sobre si el harness LOCAL mintio: la
  // pregunta que este detector responde es "lo que declaro el agente coincide
  // con lo que el arbitro mide", no "dos corridas de CI dan lo mismo".
  if (prior.source === "ci") return [];
  if (!prior.tree_hash || !fresh.tree_hash || prior.tree_hash !== fresh.tree_hash) return [];

  const findings = [];
  const priorMetrics = prior.metrics ?? {};
  const freshMetrics = fresh.metrics ?? {};
  for (const metricPath of collectMetricPaths(priorMetrics, freshMetrics)) {
    const declared = resolveMetric(priorMetrics, metricPath);
    const recomputed = resolveMetric(freshMetrics, metricPath);
    if (declared === undefined && recomputed === undefined) continue;
    const allowed = tolerance[metricPath] ?? 0;
    const mismatched =
      typeof declared === "number" && typeof recomputed === "number"
        ? Math.abs(declared - recomputed) > allowed
        : declared !== recomputed;
    if (!mismatched) continue;
    findings.push({
      level: "error",
      code: "evidence-mismatch",
      metric: metricPath,
      declared: declared ?? null,
      recomputed: recomputed ?? null,
      detail: `${metricPath}: el harness local (${prior.source ?? "?"}) declaro ${declared ?? "ausente"} sobre el arbol ${fresh.tree_hash.slice(0, 12)}; CI recomputo ${recomputed ?? "ausente"} para el MISMO arbol`
    });
  }
  return findings;
}
