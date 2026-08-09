// Helper compartido por los 8 VERDICT_STEPS (ADR 0007, P12).
//
// Los validadores invocan el CLI `sdlc` en vez de importar el paquete: no hay
// superficie publica estable para importar (solo `bin`), y shelling-out es lo
// mismo que ya hace `quality-verify.yml`. `createRequire(...).resolve(...)`
// encuentra el binario por resolucion real de node_modules -- funciona igual
// con npm y con pnpm estricto, a diferencia de asumir una ruta fija.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

export function resolveSdlcCli() {
  const require = createRequire(import.meta.url);
  return require.resolve("sistema-multiagente-sdlc/bin/sdlc.js");
}

export function runSdlc(args, cwd = process.cwd()) {
  const cli = resolveSdlcCli();
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args, "--json"], { cwd, encoding: "utf8" });
    return { ok: true, payload: JSON.parse(stdout) };
  } catch (error) {
    const stdout = error.stdout ? String(error.stdout) : "";
    let payload = null;
    try {
      payload = stdout ? JSON.parse(stdout) : null;
    } catch {
      payload = null;
    }
    return { ok: false, payload, error: error.message };
  }
}

export function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

export function ok(message) {
  console.log(`OK: ${message}`);
}
