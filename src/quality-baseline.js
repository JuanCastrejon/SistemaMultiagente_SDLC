// ---------------------------------------------------------------------------
// Linea base para el modo `ratchet` (ADR 0007, D4 y R7).
//
// Un gate en modo `ratchet` no exige un umbral absoluto: exige NO EMPEORAR
// respecto de la ultima medicion aceptada. Esa medicion aceptada es la linea
// base, y vive en un unico archivo versionado: `.github/agent-state/
// quality-baseline.yaml`.
//
// Dos preguntas que un ratchet mal disenado no responde y que aqui si:
//
// 1. QUIEN puede mover la linea base. La respuesta operativa es "el job
//    post-merge de F15, nunca un agente en F8". Esto no se puede impedir con
//    permisos de archivo (el agente tiene el mismo acceso de escritura que
//    cualquier proceso local), asi que se hace tamper-evidente: cada
//    promocion recalcula `integrity_sha256` sobre el resto del documento. Una
//    edicion a mano que no sepa recalcular ese hash queda marcada
//    `baseline-tampered` en `doctor`. No es a prueba de manipulacion; es
//    evidencia de manipulacion, que es lo que un ratchet necesita para no
//    degradarse en silencio.
// 2. COMO se evita que una promocion legitima esconda una regresion. La
//    promocion lee la metrica ya adjudicada de la evidencia de la fase que
//    cierra el slice (por convencion F15), nunca un numero pasado a mano. Si
//    esa evidencia no paso los gates bloqueantes, el slice no habria llegado a
//    F15; la promocion confia en que el gate ya hizo su trabajo antes.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import path from "node:path";
import YAML from "yaml";
import { pathExists, readTextIfExists, writeText } from "./file-utils.js";
import { readEvidenceFile } from "./evidence-validator.js";
import { evidencePath as evidenceFilePath } from "./evidence-writer.js";

export function baselinePath(target) {
  return path.join(target, ".github", "agent-state", "quality-baseline.yaml");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function computeIntegrity(document) {
  const { integrity_sha256, ...rest } = document;
  return crypto.createHash("sha256").update(stableStringify(rest)).digest("hex");
}

function emptyBaseline() {
  return {
    version: 1,
    promoted_at: null,
    promoted_by: null,
    commit_sha: null,
    slice: null,
    source: null,
    metrics: {},
    integrity_sha256: null
  };
}

/**
 * @returns {{ok: boolean, exists: boolean, tampered: boolean, baseline: object, code: string|null}}
 */
export function loadBaseline(target) {
  const absolute = baselinePath(target);
  const raw = readTextIfExists(absolute);
  if (!raw) {
    return { ok: true, exists: false, tampered: false, baseline: emptyBaseline(), code: null };
  }
  let parsed;
  try {
    parsed = YAML.parse(raw);
  } catch (error) {
    return { ok: false, exists: true, tampered: false, baseline: null, code: "baseline-unparseable", detail: error.message };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, exists: true, tampered: false, baseline: null, code: "baseline-invalid" };
  }
  // Un baseline recien instalado (nunca promovido) no lleva firma: no es
  // manipulacion, es el estado de fabrica.
  const neverPromoted = parsed.promoted_at === null || parsed.promoted_at === undefined;
  if (neverPromoted) {
    return { ok: true, exists: true, tampered: false, baseline: parsed, code: null };
  }
  const expected = computeIntegrity(parsed);
  const tampered = parsed.integrity_sha256 !== expected;
  return { ok: true, exists: true, tampered, baseline: parsed, code: tampered ? "baseline-tampered" : null };
}

/**
 * Metricas listas para pasar como `baseline` a evaluateQualityGates. Un
 * baseline nunca promovido es un objeto vacio: todo gate en modo ratchet se
 * evalua sin comparacion (pasa como si fuera la primera medicion) hasta que
 * exista una promocion real.
 */
export function loadBaselineMetrics(target) {
  const loaded = loadBaseline(target);
  if (!loaded.ok || loaded.tampered) return {};
  return loaded.baseline?.metrics ?? {};
}

/**
 * Promueve el baseline leyendo la evidencia YA ESCRITA de una fase (por
 * convencion F15, post-merge). No acepta metricas pasadas a mano: eso
 * reintroduciria exactamente el problema que el hash de integridad quiere
 * detectar.
 *
 * `source` distingue una promocion del job de CI (autoritativa) de una
 * promocion local (advisory, para probar el flujo sin esperar a merge). Sin
 * `--allow-local`, una promocion sin `source: "ci"` se rechaza.
 */
export function promoteBaseline(target, { slice, phase = "F15", commitSha = null, source = "local", allowLocal = false, now = new Date() }) {
  if (source !== "ci" && !allowLocal) {
    return {
      ok: false,
      code: "baseline-promotion-requires-ci",
      detail: "Promover el baseline localmente exige --allow-local. La promocion autoritativa es el job post-merge de F15."
    };
  }

  const read = readEvidenceFile(evidenceFilePath(target, slice, phase));
  if (!read.ok) {
    return { ok: false, code: read.code, errors: read.errors };
  }
  const metrics = read.evidence?.quality_metrics?.metrics;
  if (!metrics || Object.keys(metrics).length === 0) {
    return { ok: false, code: "baseline-source-without-metrics", detail: `La evidencia de ${phase} no tiene quality_metrics.metrics.` };
  }

  const document = {
    version: 1,
    promoted_at: now.toISOString(),
    promoted_by: source === "ci" ? "ci" : `local:${allowLocal ? "explicit" : "unknown"}`,
    commit_sha: commitSha,
    slice,
    source,
    metrics
  };
  document.integrity_sha256 = computeIntegrity(document);

  writeText(baselinePath(target), YAML.stringify(document));
  return { ok: true, path: baselinePath(target), promotedAt: document.promoted_at, metricsKeys: Object.keys(metrics) };
}

export function baselineDoctorFindings(target) {
  const findings = [];
  if (!pathExists(baselinePath(target))) return findings;
  const loaded = loadBaseline(target);
  if (!loaded.ok) {
    findings.push({ level: "warning", code: loaded.code, path: ".github/agent-state/quality-baseline.yaml" });
    return findings;
  }
  if (loaded.tampered) {
    findings.push({
      level: "error",
      code: "baseline-tampered",
      path: ".github/agent-state/quality-baseline.yaml",
      detail: "el hash de integridad no coincide con el contenido: el archivo se edito fuera de la promocion oficial"
    });
  }
  if (loaded.baseline?.promoted_by && String(loaded.baseline.promoted_by).startsWith("local:")) {
    findings.push({
      level: "warning",
      code: "baseline-promoted-locally",
      path: ".github/agent-state/quality-baseline.yaml",
      detail: "la ultima promocion no vino del job de CI; no debe tratarse como autoritativa"
    });
  }
  return findings;
}
