#!/usr/bin/env node
// VERDICT_STEP: openspec (ADR 0007, P12).
//
// La validacion autoritativa de OpenSpec (specs bien formadas, changes con
// tareas y capacidades consistentes) la hace el CLI de `@fission-ai/openspec`
// -- reinventarla aqui seria exactamente el "engine reinventa lo que ya
// existe" que este framework evita en otros lados (ADR 0007, D5). Si el
// paquete no esta declarado, este paso falla con un mensaje accionable en vez
// de reportar `pass` por no encontrar nada que correr.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fail, ok } from "./_shared.mjs";

function resolveOpenspecCli() {
  try {
    const require = createRequire(import.meta.url);
    return require.resolve("@fission-ai/openspec/bin/openspec.js");
  } catch {
    return null;
  }
}

const cli = resolveOpenspecCli();
if (!cli) {
  fail("@fission-ai/openspec no resuelve como dependencia: declararlo para poder validar OpenSpec de verdad.");
  process.exit(1);
}

try {
  const stdout = execFileSync(process.execPath, [cli, "validate", "--strict"], { encoding: "utf8" });
  ok(`openspec validate --strict paso limpio\n${stdout.trim()}`);
} catch (error) {
  // Muchos CLIs escriben el detalle del fallo en stderr, no en stdout: sin
  // esto el mensaje salia vacio y poco accionable.
  const detail = [error.stdout, error.stderr, error.message].filter(Boolean).join("\n").trim();
  fail(`openspec validate --strict fallo:\n${detail}`);
  process.exit(1);
}
