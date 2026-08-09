// ---------------------------------------------------------------------------
// Prueba de rojo con credito solo por asercion real (ADR 0007, P10)
//
// El hallazgo negativo documentado en la investigacion (docs/research/2026-08-
// quality-gauntlet-agentic.md): `it('SC-001', () => { throw new Error('not
// implemented') })` es una prueba de rojo GRATIS. Cualquier modulo nuevo
// falla al importarlo, o cualquier test puede lanzar un error arbitrario sin
// aserción real: eso demuestra que el codigo no compila o que alguien escribio
// un `throw`, no que el escenario este bien especificado. El credito de F5
// solo puede salir de una asercion que compara lo esperado contra lo real y
// pierde -- porque eso SI demuestra que el escenario describe un
// comportamiento verificable que la implementacion aun no satisface.
//
// La distincion (asercion real vs error colateral: import roto, sintaxis,
// excepcion no relacionada, timeout) la hace un adapter fuera del engine
// (mismo patron D5 que coverage/dependencias/mutacion): el engine adjudica un
// reporte normalizado, nunca sabe que existe Vitest.
// ---------------------------------------------------------------------------

import path from "node:path";
import { pathToFileURL } from "node:url";
import { pathExists } from "./file-utils.js";
import { readEvidenceFile } from "./evidence-validator.js";
import { evidencePath } from "./evidence-writer.js";

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_ACTION_REQUIRED = 2;

/**
 * @param {object} input
 * @param {Array} input.scenarios  scenario_traceability de la evidencia (sc_id, test_ref, status).
 * @param {object} input.report    Reporte normalizado del adapter: { results: [{test_ref, outcome}] }.
 *   outcome: "assertion-failed" | "passed" | "collateral-error" | "not-run".
 */
export function verifyRedProof({ scenarios = [], report = {} } = {}) {
  const findings = [];

  // El `new Map(...)` de una lista se queda con la ULTIMA entrada de cada
  // clave, en silencio. Si el reporte trae dos tests con el mismo test_ref
  // (mismo titulo en el mismo archivo, o un adapter que colapsa dos casos),
  // el credito lo decidia el orden de aparicion: un test que falla por
  // asercion podia quedar tapado por otro homonimo que pasa, o al reves.
  // Cual de los dos es "la prueba" es indecidible, asi que se rechaza en vez
  // de elegir uno.
  const resultsByRef = new Map();
  const duplicatedInReport = new Set();
  for (const result of report?.results ?? []) {
    if (resultsByRef.has(result.test_ref)) duplicatedInReport.add(result.test_ref);
    else resultsByRef.set(result.test_ref, result);
  }

  // Un test_ref solo puede respaldar UN escenario. Sin esto, N escenarios
  // distintos apuntando al mismo test cobraban credito de una sola asercion:
  // se demuestra un rojo y se acreditan N. Es la misma vacuidad por
  // denominador que el resto del gauntlet rechaza, con otra forma.
  const scIdsByRef = new Map();
  for (const scenario of scenarios) {
    if (scenario.status !== "red" || !scenario.test_ref) continue;
    if (!scIdsByRef.has(scenario.test_ref)) scIdsByRef.set(scenario.test_ref, new Set());
    scIdsByRef.get(scenario.test_ref).add(scenario.sc_id);
  }

  for (const scenario of scenarios) {
    // Solo se verifica lo que el propio slice DECLARA rojo. Un escenario ya
    // en green o unknown no promete nada aqui.
    if (scenario.status !== "red") continue;

    if (!scenario.test_ref) {
      findings.push({
        level: "error",
        code: "red-proof-missing-test-ref",
        sc_id: scenario.sc_id,
        detail: `el escenario ${scenario.sc_id} declara status:red sin test_ref: no hay nada que verificar`
      });
      continue;
    }

    const sharedWith = scIdsByRef.get(scenario.test_ref);
    if (sharedWith && sharedWith.size > 1) {
      findings.push({
        level: "error",
        code: "red-proof-test-ref-collision",
        sc_id: scenario.sc_id,
        test_ref: scenario.test_ref,
        sharedWith: [...sharedWith].filter((id) => id !== scenario.sc_id),
        detail: `el test_ref '${scenario.test_ref}' respalda ${sharedWith.size} escenarios (${[...sharedWith].join(", ")}): una sola asercion no puede acreditar varios escenarios, cada uno necesita su propio test`
      });
      continue;
    }

    if (duplicatedInReport.has(scenario.test_ref)) {
      findings.push({
        level: "error",
        code: "red-proof-ambiguous-result",
        sc_id: scenario.sc_id,
        test_ref: scenario.test_ref,
        detail: `el reporte trae mas de un resultado para el test_ref '${scenario.test_ref}': cual de ellos es la prueba del rojo es indecidible`
      });
      continue;
    }

    const result = resultsByRef.get(scenario.test_ref);
    if (!result) {
      findings.push({
        level: "error",
        code: "red-proof-test-not-found",
        sc_id: scenario.sc_id,
        test_ref: scenario.test_ref,
        detail: `el test_ref '${scenario.test_ref}' no aparece en el reporte de la corrida: no se puede confirmar que corrio`
      });
      continue;
    }

    if (result.outcome === "passed") {
      findings.push({
        level: "error",
        code: "red-proof-not-red",
        sc_id: scenario.sc_id,
        test_ref: scenario.test_ref,
        detail: "el test ya pasa en esta corrida: no puede ser la prueba de que el escenario fallaba antes de implementarse"
      });
      continue;
    }

    if (result.outcome === "collateral-error") {
      findings.push({
        level: "error",
        code: "red-proof-collateral-error",
        sc_id: scenario.sc_id,
        test_ref: scenario.test_ref,
        detail:
          "el test fallo por un error colateral (import roto, sintaxis, excepcion no relacionada), no por una asercion: no demuestra que el escenario este bien especificado, solo que algo se rompio"
      });
      continue;
    }

    if (result.outcome !== "assertion-failed") {
      findings.push({
        level: "error",
        code: "red-proof-unknown-outcome",
        sc_id: scenario.sc_id,
        test_ref: scenario.test_ref,
        outcome: result.outcome,
        detail: `el adapter reporto un outcome desconocido ('${result.outcome}') para ${scenario.test_ref}`
      });
    }
    // "assertion-failed": credito real, sin hallazgo.
  }

  return findings;
}

function loadAdapter(target, format) {
  const candidates = [
    path.join(target, "scripts", "red-proof-adapters", `${format}.mjs`),
    path.join(target, ".sdlc", "red-proof-adapters", `${format}.mjs`)
  ];
  return candidates.find((candidate) => pathExists(candidate)) ?? null;
}

/**
 * `sdlc red-proof-verify` (ADR 0007, P10)
 *
 * Lee scenario_traceability de la evidencia de la fase (F5 por convencion),
 * traduce el reporte nativo del test runner con el adapter del formato
 * declarado, y adjudica: todo escenario en status:red exige asercion real.
 */
export async function commandRedProofVerify(options = {}) {
  const target = path.resolve(options.target ?? process.cwd());
  const slice = options.slice ?? null;
  const phase = options.phase ?? "F5";
  const reportRelative = options.report ?? null;
  const format = options.format ?? null;

  if (!slice || !reportRelative || !format) {
    return {
      exitCode: EXIT_ERROR,
      payload: { status: "error", message: "Uso: sdlc red-proof-verify --slice <id> [--phase F5] --report <ruta> --format <formato>" }
    };
  }

  const read = readEvidenceFile(evidencePath(target, slice, phase));
  if (!read.ok) {
    return { exitCode: EXIT_ACTION_REQUIRED, payload: { status: "blocked", code: read.code, errors: read.errors } };
  }
  const scenarios = Array.isArray(read.evidence?.scenario_traceability) ? read.evidence.scenario_traceability : [];
  const declaredRed = scenarios.filter((scenario) => scenario.status === "red");

  // NO-VACUIDAD. La ruta mas barata para pasar este gate NO era falsear un
  // outcome: era borrar el bloque `scenario_traceability` del F5.yaml (el
  // schema no lo exige) o no marcar ningun escenario como `red`. Con cero
  // sujetos, verifyRedProof devolvia [] y el comando salia `ok` / exit 0 —
  // "no se pudo medir" indistinguible de "todo bien", que es exactamente lo
  // que el ADR 0007 declara prohibido. F5 existe para demostrar que los
  // escenarios fallaban ANTES de implementarlos: una fase que no declara ni
  // un rojo no ha demostrado nada.
  if (declaredRed.length === 0) {
    return {
      exitCode: EXIT_ACTION_REQUIRED,
      payload: {
        status: "blocked",
        code: "red-proof-vacuous",
        slice,
        phase,
        scenariosTotal: scenarios.length,
        scenariosChecked: 0,
        detail:
          scenarios.length === 0
            ? `la evidencia de ${phase} no trae scenario_traceability: no hay ni un escenario del que demostrar el rojo`
            : `la evidencia de ${phase} trae ${scenarios.length} escenario(s) pero ninguno en status:red: no hay nada que demostrar y el gate no puede satisfacerse con el conjunto vacio`
      }
    };
  }

  const reportAbsolute = path.join(target, reportRelative);
  if (!pathExists(reportAbsolute)) {
    return {
      exitCode: EXIT_ACTION_REQUIRED,
      payload: { status: "blocked", code: "red-proof-report-missing", detail: `no existe ${reportRelative}` }
    };
  }

  const adapterPath = loadAdapter(target, format);
  if (!adapterPath) {
    return {
      exitCode: EXIT_ACTION_REQUIRED,
      payload: { status: "blocked", code: "red-proof-adapter-missing", detail: `sin adapter para el formato ${format}` }
    };
  }

  const fs = await import("node:fs");
  const raw = fs.readFileSync(reportAbsolute, "utf8");
  let report;
  try {
    const adapter = await import(pathToFileURL(adapterPath).href);
    const parse = adapter.parse ?? adapter.default;
    if (typeof parse !== "function") {
      return {
        exitCode: EXIT_ACTION_REQUIRED,
        payload: { status: "blocked", code: "red-proof-adapter-invalid", detail: `el adapter ${format} no exporta parse()` }
      };
    }
    report = parse(raw, { reportPath: reportAbsolute });
  } catch (error) {
    return {
      exitCode: EXIT_ACTION_REQUIRED,
      payload: { status: "blocked", code: "red-proof-adapter-failed", detail: error.message }
    };
  }

  const findings = verifyRedProof({ scenarios, report });
  return {
    exitCode: findings.length > 0 ? EXIT_ACTION_REQUIRED : EXIT_OK,
    payload: {
      status: findings.length > 0 ? "blocked" : "ok",
      slice,
      phase,
      scenariosTotal: scenarios.length,
      // Cuantos sujetos se evaluaron de verdad. Sin este numero en el payload,
      // "verifique 12 escenarios" y "verifique 0" se ven identicos aguas abajo.
      scenariosChecked: declaredRed.length,
      // Esta pieza NO es prueba autoritativa segun el ADR, y decirlo es el
      // punto. El ADR 0007 exige que el rojo se demuestre con procedencia de
      // CI y anclaje al codigo juzgado; `schemas/phase-evidence.schema.json`
      // ya reserva `red_proof_run_id` y `red_proof_sha` para eso, y este
      // comando no lee ninguno de los dos: adjudica un reporte que el
      // evaluado produce y entrega, en la maquina que el evaluado controla.
      // Ademas la distincion asercion-real / error-colateral es una
      // heuristica de texto (ver el adapter), no una garantia.
      //
      // Entregar esto sin decirlo seria exactamente el fraude que P10 existe
      // para detectar: un control con apariencia de control. Por eso el
      // veredicto viaja siempre acompanado de su propio limite, y `ok`
      // significa "no encontre trampa", nunca "esto quedo demostrado".
      authoritative: false,
      advisory: true,
      proofStrength: "heuristic",
      limitations: [
        "no consume red_proof_run_id ni red_proof_sha: no hay procedencia de CI ni anclaje al codigo juzgado",
        "la distincion asercion-real / error-colateral es heuristica de texto sobre el mensaje del runner",
        "el reporte lo produce el propio evaluado: `ok` significa 'no se detecto trampa', no 'el rojo quedo demostrado'"
      ],
      findings
    }
  };
}
