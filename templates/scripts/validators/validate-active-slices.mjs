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

const changeDir = path.join(target, "openspec", "changes", slice);
if (!fs.existsSync(changeDir)) {
  fail(`phase-status.yaml declara el slice activo '${slice}' pero openspec/changes/${slice}/ no existe: el tracker y el ledger divergen`);
  process.exit(1);
}
ok(`slice activo '${slice}' tiene change correspondiente en openspec/changes/`);
