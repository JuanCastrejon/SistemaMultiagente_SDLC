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
import { detectPackageManager, loadPhaseContract, runPackageScript } from "./harness.js";
import { checkProbeAnchors, checkSurfaces, loadQualityContract, resolveProbeChain, resolveTier } from "./quality-adjudicate.js";
import { loadBaseline, loadBaselineMetrics, promoteBaseline } from "./quality-baseline.js";
import { detectEvidenceMismatch } from "./quality-verify.js";
import { resolveEffectiveSource } from "./ci-detect.js";

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
  let sourceResolution = null;
  // Se eleva al scope de la funcion: la adjudicacion de gates HEREDADOS (mas
  // abajo) necesita el hash del arbol actual para comprobar que la evidencia
  // que hereda midio este mismo arbol, y esa comprobacion ocurre fuera del
  // bloque `--run` donde el hash se calculaba.
  let currentTree = null;

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
      // El valor que se reporta para copiar al contrato tiene que ser el
      // MISMO que checkProbeAnchors valida: el de la cadena completa
      // (pre/cmd/post + archivos referenciados), no el del texto suelto.
      // Reportar uno y validar otro dejaba al usuario anclando un hash que
      // nunca iba a calzar.
      const probeChain = resolveProbeChain(target, declaredScripts, probe.command);
      const commandSha256Actual = probeChain.declared ? probeChain.digest : null;
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

    // `--source ci` es una AFIRMACION del invocador. Solo cuenta como `ci` si
    // el proceso corre de verdad en un runner (ADR 0007, P8): si no, se
    // degrada a `harness` — advisory, que es lo que realmente es — y la
    // degradacion se reporta en el payload en vez de ocurrir en silencio.
    const effectiveSource = resolveEffectiveSource(options.source, process.env);
    sourceResolution = effectiveSource;

    const tree = computeTreeHash(target, (contract.surfaces ?? []).map((surface) => surface.path));
    currentTree = tree;
    const written = appendQualityEvidence({
      target,
      slice,
      phase,
      probes: probeResults,
      metrics,
      tree,
      source: effectiveSource.source === "ci" ? "ci" : "harness",
      ci: effectiveSource.ci
    });
    evidenceWritten = written.path;
    advisory = effectiveSource.source !== "ci";

    // El arbitro es CI, no el harness local (ADR 0007, D1): esto es lo que
    // hace ese diseño real en vez de una frase. `history` acaba de recibir lo
    // que este mismo write rotó fuera de `quality_metrics` -- es la corrida
    // inmediatamente anterior para esta fase/slice, sin releer nada del disco.
    if (effectiveSource.source === "ci") {
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

  // Los gates que la FASE declara en phase-contract.yaml pueden pertenecer a
  // otra fase de ORIGEN (herencia, P7): F14 no mide nada propio y re-verifica
  // los de F8/F10. `evaluateQualityGates` filtra por `phase`, asi que
  // pasarle el contrato entero descartaba los heredados y devolvia
  // `evaluated: []` — y este comando es EXACTAMENTE el que corre el arbitro
  // en CI, con lo que la pieza entera era decorativa donde mas importa.
  // `phase-gate` y `status` si los adjudicaban, via adjudicateFromEvidence;
  // el arbitro no. Se cierra esa asimetria aqui.
  const phaseContract = loadPhaseContract(target);
  const phaseEntry = (phaseContract.phases ?? []).find(
    (entry) => String(entry.id).toUpperCase() === String(phase).toUpperCase()
  );
  const declaredGateIds = Array.isArray(phaseEntry?.quality_gates) ? phaseEntry.quality_gates : null;
  const allGates = contract.gates ?? [];
  const byDeclaredIds = declaredGateIds ? allGates.filter((gate) => declaredGateIds.includes(gate.id)) : [];
  // Si el phase-contract declara gates y AL MENOS UNO resuelve en el contrato
  // de calidad, esa lista manda (es la que habilita la herencia). Si no
  // resuelve ninguno, los dos contratos no se corresponden — tipico de un
  // consumidor con quality-contract propio que aun usa el phase-contract del
  // framework por fallback — y filtrar por ids ajenos dejaria al consumidor
  // sin adjudicar nada. En ese caso se cae al comportamiento historico:
  // evaluar todos los gates y dejar que evaluateQualityGates filtre por fase.
  const declaredGates = byDeclaredIds.length > 0 ? byDeclaredIds : allGates;
  const effectiveDeclaredIds = byDeclaredIds.length > 0 ? declaredGateIds : null;

  const ownGates = declaredGates.filter((gate) => !gate.phase || gate.phase === phase);
  const inheritedByOrigin = new Map();
  for (const gate of declaredGates) {
    if (!gate.phase || gate.phase === phase) continue;
    if (!inheritedByOrigin.has(gate.phase)) inheritedByOrigin.set(gate.phase, []);
    inheritedByOrigin.get(gate.phase).push(gate);
  }

  const groups = [
    evaluateQualityGates({ gates: ownGates, metrics, phase, tier, baseline, declaredByContract: effectiveDeclaredIds })
  ];
  const inherited = [];
  // Heredar una metrica es heredar tambien EL ARBOL sobre el que se midio. Sin
  // este anclaje, F14 -- que no mide nada propio y existe precisamente como
  // guard anti-regresion antes de fusionar -- adjudicaba contra la medicion de
  // un arbol anterior. Reproducido con PoC: con la evidencia de F8/F10 tomada
  // sobre un arbol limpio, se ensucia el arbol, y la corrida fresca de F14 mide
  // 7 violaciones de dependencias, 3 ciclos y 12% de cobertura, las escribe en
  // F14.yaml... y los tres gates salen `pass` con los valores viejos, con
  // `status: ok` y exit 0. Los dos tree_hash ya estaban en disco, en los mismos
  // archivos que este codigo lee; nadie los comparaba.
  const inheritedTree =
    inheritedByOrigin.size > 0
      ? (currentTree ??= computeTreeHash(target, (contract.surfaces ?? []).map((surface) => surface.path)))
      : null;
  for (const [originPhase, originGates] of inheritedByOrigin) {
    // Un gate heredado se evalua contra la evidencia de la fase que SI lo
    // midio, nunca contra las metricas frescas de esta fase (que no las tiene).
    const originRead = readEvidenceFile(evidencePath(target, slice, originPhase));
    const originMetrics = originRead.ok ? originRead.evidence?.quality_metrics?.metrics ?? {} : {};
    const originTreeHash = originRead.ok ? originRead.evidence?.quality_metrics?.tree_hash ?? null : null;
    groups.push(
      evaluateQualityGates({
        gates: originGates,
        metrics: originMetrics,
        phase: originPhase,
        tier,
        baseline,
        declaredByContract: effectiveDeclaredIds
      })
    );
    inherited.push({
      phase: originPhase,
      evidenceFound: originRead.ok,
      gates: originGates.map((gate) => gate.id),
      treeHash: originTreeHash,
      currentTreeHash: inheritedTree?.hash ?? null,
      treeMatches: originRead.ok ? originTreeHash === inheritedTree?.hash : null
    });
    if (!originRead.ok) {
      surfaceFindings.push({
        level: "error",
        code: "inherited-evidence-missing",
        phase: originPhase,
        detail: `${phase} hereda gates de ${originPhase} pero su evidencia no es legible (${originRead.code}): no se puede re-verificar antes de fusionar`
      });
    } else if (originTreeHash === null) {
      // Sin hash no se puede demostrar frescura. No poder verificar no puede
      // parecerse a haber verificado: se bloquea, igual que el resto del
      // gauntlet trata la ausencia de medicion.
      surfaceFindings.push({
        level: "error",
        code: "inherited-evidence-unanchored",
        phase: originPhase,
        detail: `${phase} hereda gates de ${originPhase} pero esa evidencia no declara tree_hash: no se puede demostrar que midio el arbol que se va a fusionar`
      });
    } else if (originTreeHash !== inheritedTree?.hash) {
      surfaceFindings.push({
        level: "error",
        code: "inherited-evidence-stale",
        phase: originPhase,
        expected: inheritedTree?.hash ?? null,
        actual: originTreeHash,
        detail: `${phase} hereda gates de ${originPhase}, pero esa evidencia midio otro arbol (${originTreeHash.slice(0, 12)} != ${(inheritedTree?.hash ?? "").slice(0, 12)}): las superficies cambiaron despues de medirse y hay que volver a correr ${originPhase}`
      });
    }
  }

  const adjudication = {
    status: groups.some((g) => g.violations.length > 0)
      ? "blocked"
      : groups.some((g) => g.warnings.length > 0)
        ? "warning"
        : "ok",
    evaluated: groups.flatMap((g) => g.evaluated),
    violations: groups.flatMap((g) => g.violations),
    warnings: groups.flatMap((g) => g.warnings),
    vacuous: groups.flatMap((g) => g.vacuous)
  };

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
    // Solo presente en `--run`: dice el origen DECLARADO, el EFECTIVO y si
    // hubo degradacion, para que "esto se midio en CI" sea auditable en vez
    // de creible por afirmacion (ADR 0007, P8).
    sourceResolution,
    // Que gates se heredaron de otra fase y si su evidencia de origen se pudo
    // leer. Sin esto, "F14 adjudico" y "F14 no adjudico nada" se veian igual.
    inherited: inherited.length > 0 ? inherited : undefined,
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
