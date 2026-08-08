// ---------------------------------------------------------------------------
// Escritura de evidencia (ADR 0007, D2)
//
// Regla: la evidencia se ANEXA tras ejecutar, no se redacta. El agente nunca
// escribe `quality_metrics` a mano; lo hace este modulo con lo que realmente
// devolvio el probe, incluyendo el hash del reporte producido y el hash del
// arbol de fuentes evaluadas.
//
// Por que el hash del arbol y no un timestamp: un `measured_at` lo escribe
// quien quiera. El arbol evaluado es contenido, y el arbitro puede recomputarlo.
// La frescura de la evidencia se decide comparando arboles, nunca relojes.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { ensureDir, pathExists, readTextIfExists, writeText } from "./file-utils.js";

function sha256Text(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256FileIfExists(absolutePath) {
  if (!pathExists(absolutePath)) return null;
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(absolutePath)).digest("hex");
  } catch {
    return null;
  }
}

function listFilesRecursive(root, accumulator = []) {
  if (!pathExists(root)) return accumulator;
  const stat = fs.statSync(root);
  if (stat.isFile()) {
    accumulator.push(root);
    return accumulator;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name.startsWith(".")) continue;
    listFilesRecursive(path.join(root, entry.name), accumulator);
  }
  return accumulator;
}

/**
 * Hash estable del contenido de las superficies evaluadas. Dos arboles con los
 * mismos bytes dan el mismo hash sin importar cuando se midieron.
 */
export function computeTreeHash(target, surfacePaths = []) {
  const parts = [];
  for (const surfacePath of [...surfacePaths].sort()) {
    const absolute = path.join(target, surfacePath);
    for (const file of listFilesRecursive(absolute).sort()) {
      const relative = path.relative(target, file).split(path.sep).join("/");
      const digest = sha256FileIfExists(file);
      if (digest) parts.push(`${relative}:${digest}`);
    }
  }
  return { hash: sha256Text(parts.join("\n")), files: parts.length };
}

export function evidencePath(target, slice, phase) {
  return path.join(target, ".github", "agent-state", "evidence", slice, `${phase}.yaml`);
}

/**
 * Anexa un bloque de calidad a la evidencia de una fase, en modo append-only:
 * lo que ya estaba no se reescribe, se conserva bajo `history`.
 *
 * @param {object} input
 * @param {string} input.target
 * @param {string} input.slice
 * @param {string} input.phase
 * @param {string} input.agentId
 * @param {Array}  input.probes   Resultados reales de ejecucion.
 * @param {object} input.metrics  Metricas normalizadas por los adapters.
 * @param {object} input.tree     {hash, files} de computeTreeHash.
 * @param {string} [input.commitSha]
 * @param {string} [input.source] "harness" (default) o "ci".
 */
export function appendQualityEvidence({
  target,
  slice,
  phase,
  agentId = "sdlc-harness",
  probes = [],
  metrics = {},
  tree = null,
  commitSha = null,
  source = "harness",
  // Rastro del runner cuando el origen es CI verificado. No es infalsificable
  // —el evaluado puede escribir cualquier cosa en su propio YAML— pero un
  // `run_id` es cruzable contra los runs reales del repo, mientras que un
  // `source: ci` a secas no deja nada que auditar.
  ci = null,
  now = new Date()
}) {
  const absolute = evidencePath(target, slice, phase);
  ensureDir(path.dirname(absolute));

  const existingRaw = readTextIfExists(absolute);
  let document = {};
  if (existingRaw) {
    try {
      document = YAML.parse(existingRaw) ?? {};
    } catch {
      // Evidencia ilegible: se preserva intacta al lado en vez de destruirla.
      const salvage = `${absolute}.corrupt-${now.toISOString().replace(/[:.]/g, "-")}`;
      fs.copyFileSync(absolute, salvage);
      document = {};
    }
  }

  const previousQuality = document.quality_metrics;
  if (previousQuality) {
    document.history = Array.isArray(document.history) ? document.history : [];
    document.history.push({ replaced_at: now.toISOString(), quality_metrics: previousQuality });
  }

  document.phase = document.phase ?? phase;
  document.slice = document.slice ?? slice;
  document.agent_id = document.agent_id ?? agentId;
  document.started_at = document.started_at ?? now.toISOString();
  document.outputs = Array.isArray(document.outputs) ? document.outputs : [];
  document.validators_run = Array.isArray(document.validators_run) ? document.validators_run : [];

  // Los probes ejecutados tambien entran en validators_run, que es el campo
  // historico que ya leen las plantillas de fase.
  for (const probe of probes) {
    document.validators_run.push({
      command: probe.command,
      status: probe.status === "ok" ? "ok" : probe.status === "failed" ? "error" : "skipped",
      exit_code: probe.exit_code ?? null
    });
  }

  document.quality_metrics = {
    measured_at: now.toISOString(),
    source,
    // Solo se escriben cuando el origen es `ci` de verdad: una evidencia que
    // dice `source: ci` sin estos campos delata que el string se puso a mano.
    ci_provider: source === "ci" ? ci?.provider ?? null : null,
    ci_run_id: source === "ci" ? ci?.runId ?? null : null,
    tree_hash: tree?.hash ?? null,
    tree_files: tree?.files ?? null,
    commit_sha: commitSha,
    probes,
    metrics
  };

  writeText(absolute, YAML.stringify(document));
  return { path: absolute, evidence: document };
}
