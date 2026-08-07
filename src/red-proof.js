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
  const resultsByRef = new Map((report?.results ?? []).map((result) => [result.test_ref, result]));

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
      scenariosChecked: scenarios.filter((scenario) => scenario.status === "red").length,
      findings
    }
  };
}
