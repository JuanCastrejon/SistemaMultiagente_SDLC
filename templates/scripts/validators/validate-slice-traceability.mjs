#!/usr/bin/env node
// VERDICT_STEP: slice-traceability (ADR 0007, P12).
//
// Que el slice activo este en F9 no dice nada sobre si F0-F8 tienen evidencia
// real: un salto de fase sin anexar evidencia deja un hueco que solo se nota
// si alguien audita hacia atras. Este validador recorre TODAS las fases
// anteriores a la actual y exige, para cada una que declare evidencia
// obligatoria, que exista y sea valida -- reusando `phase-gate`, no
// reinventando la lectura de evidencia.
import { runSdlc, fail, ok } from "./_shared.mjs";

const PHASE_ORDER = [
  "F0", "F1", "F2", "F3", "F3_5", "F4", "F5", "F6", "F7",
  "F8", "F9", "F10", "F11", "F12", "F13", "F14", "F15", "F16", "F17"
];

const status = runSdlc(["status"]);
const slice = status.payload?.phaseGate?.slice ?? null;
const currentPhase = status.payload?.phaseGate?.phase ?? null;

if (!slice || !currentPhase) {
  ok("sin slice/fase activos resolubles: nada que trazar");
  process.exit(0);
}

const currentIndex = PHASE_ORDER.indexOf(currentPhase);
if (currentIndex <= 0) {
  ok(`fase actual '${currentPhase}' es la primera de la cadena o no reconocida: nada anterior que trazar`);
  process.exit(0);
}

const gaps = [];
for (const phase of PHASE_ORDER.slice(0, currentIndex)) {
  const result = runSdlc(["phase-gate", "--phase", phase, "--slice", slice]);
  const evidence = result.payload?.evidence;
  if (!evidence) continue; // fase no declarada en el contrato instalado: no aplica
  if (evidence.required && !(evidence.exists && evidence.valid)) {
    gaps.push(`${phase}: evidencia ${evidence.exists ? "invalida" : "ausente"}`);
  }
}

if (gaps.length > 0) {
  fail(`el slice '${slice}' esta en ${currentPhase} pero tiene huecos de evidencia hacia atras: ${gaps.join("; ")}`);
  process.exit(1);
}
ok(`el slice '${slice}' tiene evidencia continua desde F0 hasta antes de ${currentPhase}`);
