#!/usr/bin/env node
// VERDICT_STEP: semantic-guardrails (ADR 0007, P12).
//
// `docs/agents/guardrails-semanticos-del-dominio.md` es donde el equipo
// escribe las reglas de dominio que ningun gate mecanico puede verificar
// (invariantes de negocio, cosas que "no se hacen asi aqui"). Un archivo
// presente pero vacio es indistinguible de "no hay guardrails" para un
// agente que lo lee: por eso el chequeo real es longitud minima, no solo
// existencia.
import fs from "node:fs";
import path from "node:path";
import { fail, ok } from "./_shared.mjs";

const MIN_BYTES = 200;
const target = process.cwd();
const guardrailsPath = path.join(target, "docs", "agents", "guardrails-semanticos-del-dominio.md");

if (!fs.existsSync(guardrailsPath)) {
  fail(`no existe ${path.relative(target, guardrailsPath)}`);
  process.exit(1);
}
const content = fs.readFileSync(guardrailsPath, "utf8").trim();
if (content.length < MIN_BYTES) {
  fail(`${path.relative(target, guardrailsPath)} tiene ${content.length} bytes (< ${MIN_BYTES}): parece un stub, no guardrails reales`);
  process.exit(1);
}
ok(`guardrails semanticos presentes (${content.length} bytes)`);
