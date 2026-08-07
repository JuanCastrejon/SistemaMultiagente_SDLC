// ---------------------------------------------------------------------------
// `sdlc quality-gate` (ADR 0007)
//
// Dos modos, deliberadamente separados:
//
//   --run             ejecuta los probes del consumidor, anexa evidencia real y
//                     adjudica. Es lo que corre en F8/F9/F10 y en CI.
//   --from-evidence   NO ejecuta nada: adjudica la evidencia ya escrita. Sirve
//                     para revisar sin volver a pagar el coste, y se autodeclara
//                     `advisory: true` porque nadie recomputo nada.
//
// El engine no conoce ninguna herramienta: ejecuta el script que el consumidor
// declara en `quality-contract.yaml` y lee el reporte que ese script produce.
// La traduccion reporte -> metricas la hace un adapter, que vive fuera del
// engine para que un consumidor Python no tenga que cargar adapters de JS.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { pathExists, readPackageScripts, sha256Text } from "./file-utils.js";
import { evaluateQualityGates } from "./quality-gates.js";
import { appendQualityEvidence, computeTreeHash, evidencePath } from "./evidence-writer.js";
import { detectEvidenceSmells, readEvidenceFile } from "./evidence-validator.js";
import { detectPackageManager, runPackageScript } from "./harness.js";
import { checkProbeAnchors, checkSurfaces, loadQualityContract, resolveTier } from "./quality-adjudicate.js";
import { loadBaseline, loadBaselineMetrics, promoteBaseline } from "./quality-baseline.js";
import { detectEvidenceMismatch } from "./quality-verify.js";

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_ACTION_REQUIRED = 2;

export { checkSurfaces, loadQualityContract };

function loadAdapter(target, format) {
  // Los adapters viven en el consumidor (o en un paquete aparte), nunca en el
  // engine: eso es lo que mantiene portable el framework.
  const candidates = [
    path.join(target, "scripts", "quality-adapters", `${format}.mjs`),
    path.join(target, ".sdlc", "adapters", `${format}.mjs`)
  ];
  return candidates.find((candidate) => pathExists(candidate)) ?? null;
}

async function readReportMetrics(target, probe) {
  const reportPath = path.join(target, probe.emits);
  if (!pathExists(reportPath)) {
    return { metrics: null, reportSha256: null, detail: "el probe no produjo su reporte" };
  }
  const adapterPath = loadAdapter(target, probe.format);
  const raw = fs.readFileSync(reportPath, "utf8");
  const crypto = await import("node:crypto");
  const reportSha256 = crypto.createHash("sha256").update(raw).digest("hex");

  if (!adapterPath) {
    return { metrics: null, reportSha256, detail: `sin adapter para el formato ${probe.format}` };
  }
  try {
    const adapter = await import(pathToFileURL(adapterPath).href);
    const parse = adapter.parse ?? adapter.default;
    if (typeof parse !== "function") {
      return { metrics: null, reportSha256, detail: `el adapter ${probe.format} no exporta parse()` };
    }
    return { metrics: parse(raw, { reportPath }), reportSha256, detail: null };
  } catch (error) {
    return { metrics: null, reportSha256, detail: `adapter ${probe.format} fallo: ${error.message}` };
  }
}

function mergeMetrics(base, incoming) {
  if (!incoming || typeof incoming !== "object") return base;
  for (const [key, value] of Object.entries(incoming)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      base[key] = mergeMetrics(base[key] && typeof base[key] === "object" ? base[key] : {}, value);
    } else {
      base[key] = value;
    }
  }
  return base;
}

export async function commandQualityGate(options = {}) {
  const target = path.resolve(options.target ?? process.cwd());
  const phase = options.phase ?? null;
  const slice = options.slice ?? null;
  const runProbes = Boolean(options.run);
  const fromEvidence = Boolean(options["from-evidence"] ?? options.fromEvidence);
  const exitCodeMode = Boolean(options["exit-code"] ?? options.exitCode);

  const loaded = loadQualityContract(target);
  if (!loaded.ok) {
    return {
      exitCode: EXIT_ACTION_REQUIRED,
      payload: { status: "not-configured", code: loaded.code, path: loaded.path, detail: loaded.detail ?? null }
    };
  }
  const contract = loaded.contract;
  const surfaceFindings = checkSurfaces(target, contract);
  surfaceFindings.push(...checkProbeAnchors(target, contract));
  const tier = resolveTier(contract, options.surface ?? null);

  let metrics = {};
  let probeResults = [];
  let evidenceWritten = null;
  let advisory = true;

  if (runProbes) {
    if (!slice || !phase) {
      return {
        exitCode: EXIT_ERROR,
        payload: { status: "error", message: "--run exige --slice y --phase para saber donde anexar la evidencia." }
      };
    }
    const packageManager = detectPackageManager(target);
    const declaredScripts = readPackageScripts(target) ?? {};
    for (const probe of contract.probes ?? []) {
      const scriptText = declaredScripts[probe.command];
      const commandSha256Actual = typeof scriptText === "string" ? sha256Text(scriptText) : null;
      const started = Date.now();
      const execution = runPackageScript(target, packageManager, probe.command, probe.timeout_ms ?? 120_000);
      const durationMs = Date.now() - started;

      if (execution.status === "not-configured") {
        const policy = probe.when_absent ?? "warn";
        probeResults.push({
          id: probe.id,
          command: probe.command,
          exit_code: null,
          report_path: probe.emits,
          report_sha256: null,
          command_sha256_actual: commandSha256Actual,
          duration_ms: durationMs,
          status: policy === "fail" ? "failed" : "not-configured",
          detail: `el consumidor no declara el script ${probe.command}`
        });
        continue;
      }

      const report = await readReportMetrics(target, probe);
      if (report.metrics) mergeMetrics(metrics, report.metrics);
      probeResults.push({
        id: probe.id,
        command: probe.command,
        exit_code: execution.exitCode,
        report_path: probe.emits,
        report_sha256: report.reportSha256,
        command_sha256_actual: commandSha256Actual,
        duration_ms: durationMs,
        status: execution.ok ? "ok" : "failed",
        detail: report.detail
      });
    }

    const tree = computeTreeHash(target, (contract.surfaces ?? []).map((surface) => surface.path));
    const written = appendQualityEvidence({
      target,
      slice,
      phase,
      probes: probeResults,
      metrics,
      tree,
      source: options.source === "ci" ? "ci" : "harness"
    });
    evidenceWritten = written.path;
    advisory = options.source !== "ci";

    // El arbitro es CI, no el harness local (ADR 0007, D1): esto es lo que
    // hace ese diseño real en vez de una frase. `history` acaba de recibir lo
    // que este mismo write rotó fuera de `quality_metrics` -- es la corrida
    // inmediatamente anterior para esta fase/slice, sin releer nada del disco.
    if (options.source === "ci") {
      const priorEntry = written.evidence?.history?.at(-1)?.quality_metrics ?? null;
      surfaceFindings.push(...detectEvidenceMismatch({ prior: priorEntry, fresh: written.evidence.quality_metrics }));
    }
  } else if (fromEvidence) {
    if (!slice || !phase) {
      return {
        exitCode: EXIT_ERROR,
        payload: { status: "error", message: "--from-evidence exige --slice y --phase." }
      };
    }
    const read = readEvidenceFile(evidencePath(target, slice, phase));
    if (!read.ok) {
      return {
        exitCode: EXIT_ACTION_REQUIRED,
        payload: { status: "blocked", code: read.code, errors: read.errors }
      };
    }
    metrics = read.evidence?.quality_metrics?.metrics ?? {};
    probeResults = read.evidence?.quality_metrics?.probes ?? [];
    const smells = detectEvidenceSmells(read.evidence);
    if (smells.length > 0) surfaceFindings.push(...smells.map((smell) => ({ level: "warning", ...smell })));
  } else {
    return {
      exitCode: EXIT_ERROR,
      payload: { status: "error", message: "Elegir --run (ejecuta y anexa evidencia) o --from-evidence (solo adjudica)." }
    };
  }

  const baselineState = loadBaseline(target);
  if (baselineState.tampered) {
    surfaceFindings.push({
      level: "error",
      code: "baseline-tampered",
      detail: "el baseline no supero su verificacion de integridad; los gates ratchet se evaluaron sin comparacion"
    });
  }
  const baseline = baselineState.tampered ? {} : loadBaselineMetrics(target);

  const adjudication = evaluateQualityGates({
    gates: contract.gates ?? [],
    metrics,
    phase,
    tier,
    baseline
  });

  const surfaceErrors = surfaceFindings.filter((finding) => finding.level === "error");
  const blocked = adjudication.violations.length > 0 || surfaceErrors.length > 0;

  const payload = {
    // El spread de `adjudication` va PRIMERO a proposito: trae su propio
    // `status`, que solo describe los gates. El status del comando tiene que
    // considerar tambien los errores de superficie, asi que se calcula despues
    // y debe ganar.
    ...adjudication,
    status: blocked ? "blocked" : adjudication.status === "warning" ? "warning" : "ok",
    // Un veredicto que no recomputo nada no puede presentarse como autoritativo.
    advisory,
    phase,
    slice,
    tier,
    enforcement: contract.enforcement ?? "observe",
    evidence: evidenceWritten,
    probes: probeResults,
    surfaceFindings
  };

  const exitCode = blocked && exitCodeMode ? EXIT_ACTION_REQUIRED : EXIT_OK;
  return { exitCode, payload };
}

/**
 * `sdlc quality-baseline --promote`
 *
 * Mueve la linea base de los gates en modo ratchet a lo que dice la evidencia
 * de una fase ya escrita. Sin `--source ci` exige `--allow-local` explicito: la
 * promocion autoritativa es el job post-merge de F15, no una corrida local.
 */
export function commandQualityBaseline(options = {}) {
  const target = path.resolve(options.target ?? process.cwd());
  if (!options.promote) {
    return {
      exitCode: EXIT_ERROR,
      payload: { status: "error", message: "Uso: sdlc quality-baseline --promote --slice <id> [--phase F15] [--source ci|local] [--allow-local]" }
    };
  }
  const slice = options.slice ?? null;
  if (!slice) {
    return { exitCode: EXIT_ERROR, payload: { status: "error", message: "--promote exige --slice <id>." } };
  }
  const result = promoteBaseline(target, {
    slice,
    phase: options.phase ?? "F15",
    commitSha: options["commit-sha"] ?? options.commitSha ?? null,
    source: options.source ?? "local",
    allowLocal: Boolean(options["allow-local"] ?? options.allowLocal)
  });
  if (!result.ok) {
    return { exitCode: EXIT_ACTION_REQUIRED, payload: { status: "blocked", ...result } };
  }
  return { exitCode: EXIT_OK, payload: { status: "ok", ...result } };
}
