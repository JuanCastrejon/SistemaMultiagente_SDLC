#!/usr/bin/env node
// VERDICT_STEP: active-slices (ADR 0007, P12).
//
// phase-status.yaml (el tracker) y openspec/changes/ (el ledger) son dos
// archivos distintos que se pueden desincronizar: un slice que el tracker
// dice activo pero cuyo change ya se archivo (o nunca se creo) es exactamente
// el tipo de divergencia que paso desapercibida en el repo padre. `sdlc
// status` ya resuelve el slice/fase actuales desde el tracker; aqui solo se
// cruza contra el ledger.
import fs from "node:fs";
import path from "node:path";
import { runSdlc, fail, ok } from "./_shared.mjs";

const target = process.cwd();
const result = runSdlc(["status"]);
const slice = result.payload?.phaseGate?.slice ?? null;
const phase = result.payload?.phaseGate?.phase ?? null;

if (!slice) {
  ok("sin slice activo declarado en phase-status.yaml: nada que trazar");
  process.exit(0);
}
// F0 (bootstrap) es el placeholder de fabrica antes de que exista ningun
// change de OpenSpec: exigirle un directorio propio bloquearia todo install
// nuevo por diseño, no por una divergencia real.
if (phase === "F0") {
  ok(`slice '${slice}' esta en F0 (bootstrap): aun no se espera un change de OpenSpec`);
  process.exit(0);
}

// El puntero es UNO de los slices en vuelo. Si el tracker declara el mapa
// `slices:`, se cruzan TODOS: un slice que solo existe en el tracker es
// exactamente la divergencia que este validador busca, y limitarse al apuntado
// la dejaba pasar en cuanto habia mas de uno.
const declared = Array.isArray(result.payload?.slices) ? result.payload.slices : [];
const aTrazar = declared.length > 0
  ? declared.filter((entry) => entry.id && entry.phase !== "F0").map((entry) => entry.id)
  : [slice];

const divergentes = [...new Set(aTrazar)].filter((id) => !fs.existsSync(path.join(target, "openspec", "changes", id)));
if (divergentes.length > 0) {
  fail(
    `phase-status.yaml declara ${divergentes.length === 1 ? "el slice activo" : "los slices activos"} ` +
      `${divergentes.map((id) => `'${id}'`).join(", ")} pero no existe su directorio en openspec/changes/: el tracker y el ledger divergen`
  );
  process.exit(1);
}
ok(`${aTrazar.length} slice(s) activo(s) con change correspondiente en openspec/changes/`);
