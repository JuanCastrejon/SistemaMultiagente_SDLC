#!/usr/bin/env node
// VERDICT_STEP: drift (ADR 0007, P12).
//
// Un archivo gestionado por el framework (AGENTS.md, phase-contract.yaml,
// workflows...) que alguien edito a mano diverge en silencio del original: la
// proxima `sdlc upgrade` lo pisaria, o peor, el consumidor cree que corre una
// version del contrato que ya no es la que tiene en disco. `sdlc doctor` ya
// calcula esto (`managed-file-drift`/`managed-file-missing`); este validador
// solo lo convierte en un paso BLOCKING de `sdlc verdict`.
import { runSdlc, fail, ok } from "./_shared.mjs";

const result = runSdlc(["doctor"]);
const findings = result.payload?.findings ?? [];
const errors = findings.filter((finding) => finding.level === "error");

if (errors.length > 0) {
  fail(`sdlc doctor encontro ${errors.length} error(es): ${errors.map((f) => f.code).join(", ")}`);
  process.exit(1);
}
ok(`sin drift bloqueante (${findings.length} hallazgo(s) informativo/warning)`);
