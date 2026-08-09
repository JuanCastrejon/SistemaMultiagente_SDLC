// ---------------------------------------------------------------------------
// P14 (ADR 0007): documentacion generada desde el contrato, no escrita a
// mano. Una prosa que describe umbrales diverge del contrato real la primera
// vez que alguien edita quality-contract.yaml y se olvida de actualizarla —
// el mismo problema de dos fuentes de verdad que P6 cerro para superficies.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderQualityDocs } from "../src/quality-docs.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "sdlc.js");

// --- unidad: renderQualityDocs ----------------------------------------------
const contract = {
  enforcement: "observe",
  tiers: { core: { description: "dinero" } },
  surfaces: [{ id: "s", path: "packages/s", tier: "core", money_path: true, has_ui: false }],
  probes: [{ id: "coverage", command: "validate:coverage", format: "istanbul-summary", emits: "coverage/coverage-summary.json" }],
  gates: [
    { id: "F8.gate-a", phase: "F8", metric: "coverage.changed_lines_pct", op: "gte", mode: "ratchet", thresholds: { core: 90 }, provenance: "decision-de-equipo", min_denominator: { metric: "coverage.changed_lines_total", value: 1 } },
    { id: "F10.gate-b", phase: "F10", metric: "dependencies.violations", op: "eq", mode: "ratchet", threshold: 0, provenance: "decision-de-equipo", min_denominator: { metric: "dependencies.modules_scanned", value: 10 } },
    { id: "F9.gate-sin-denominador", phase: "F9", metric: "mutation.survived", op: "eq", mode: "observe", threshold: 0, provenance: "decision-de-equipo" }
  ]
};
const phaseContract = {
  phases: [
    { id: "F8", quality_gates: ["F8.gate-a"] },
    { id: "F14", quality_gates: ["F8.gate-a", "F10.gate-b"] }
  ]
};
const markdown = renderQualityDocs({ contract, phaseContract });

assert.match(markdown, /F8\.gate-a/);
assert.match(markdown, /F10\.gate-b/);
assert.match(markdown, /core=90/);
assert.match(markdown, /No editar a mano/);
// F8 declara su propio gate; F14 hereda ambos (ninguno tiene phase:"F14").
const f14Row = markdown.split("\n").find((line) => line.startsWith("| F14"));
assert.ok(f14Row, "debe listar F14 en la tabla de gates por fase");
assert.match(f14Row, /ninguno/, "F14 no tiene gates propios");
assert.match(f14Row, /F8\.gate-a.*F10\.gate-b|F10\.gate-b.*F8\.gate-a/);
const f8Row = markdown.split("\n").find((line) => line.startsWith("| F8"));
assert.match(f8Row, /F8\.gate-a/);

// El denominador minimo es lo que separa un gate que juzga de uno VACUO:
// "0 violaciones" y "0 violaciones, y solo cuenta si se escanearon >=10
// modulos" son controles distintos. La doc lo omitia por completo, asi que
// quien la leia no podia saber si el gate era satisfacible por vacio.
const gateRowA = markdown.split("\n").find((line) => line.startsWith("| F8.gate-a"));
assert.match(gateRowA, /coverage\.changed_lines_total.*>= 1/, "la tabla de gates debe declarar el denominador minimo");
const gateRowB = markdown.split("\n").find((line) => line.startsWith("| F10.gate-b"));
assert.match(gateRowB, /dependencies\.modules_scanned.*>= 10/);
const gateRowSin = markdown.split("\n").find((line) => line.startsWith("| F9.gate-sin-denominador"));
assert.match(gateRowSin, /ninguno/, "un gate sin denominador declarado tiene que decirlo, no dejar la celda ambigua");

console.log("quality-docs unit: PASS");

// --- E2E: sdlc quality-docs sobre un install real --------------------------
const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-quality-docs-")), "consumidor");
fs.mkdirSync(target, { recursive: true });
execFileSync("node", [cli, "install", "--target", target, "--mode", "greenfield", "--project-name", "Demo", "--json"], {
  cwd: repoRoot,
  encoding: "utf8"
});
const result = JSON.parse(
  execFileSync("node", [cli, "quality-docs", "--target", target, "--json"], { cwd: repoRoot, encoding: "utf8" })
);
assert.equal(result.status, "ok");
const generatedPath = path.join(target, result.path);
assert.ok(fs.existsSync(generatedPath));
const generated = fs.readFileSync(generatedPath, "utf8");
assert.match(generated, /F8\.changed-lines-coverage/);
// F14 (del phase-contract real, P7) hereda F8/F10; no tiene gates propios.
const installedF14Row = generated.split("\n").find((line) => line.startsWith("| F14"));
assert.ok(installedF14Row);
assert.match(installedF14Row, /F10\.dependency-violations/);

console.log("quality-docs cli e2e: PASS");

// --- DIVERGENCIA: una doc comiteada que ya no describe el contrato ---------
// Sin esto la pieza no cerraba su propia tesis. El comando solo sabia
// SOBREESCRIBIR: `--dry-run` se saltaba la escritura y devolvia `status: ok`
// sin haber leido siquiera el archivo existente, asi que una doc
// desactualizada era indetectable — el modo de fallo (dos fuentes de verdad
// divergiendo en silencio) que P14 existe para cerrar, dentro de P14.
function docsCommand(args) {
  const result = execFileSync("node", [cli, "quality-docs", "--target", target, ...args, "--json"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  return JSON.parse(result);
}
function docsCommandExpectingFailure(args) {
  try {
    execFileSync("node", [cli, "quality-docs", "--target", target, ...args, "--json"], { cwd: repoRoot, encoding: "utf8" });
    return { threw: false };
  } catch (error) {
    return { threw: true, payload: JSON.parse(error.stdout.toString()), status: error.status };
  }
}

// 1. Recien generada: --check pasa. Sin este caso el modo podria bloquear
// siempre y el test no notaria la diferencia (muro, no control).
const fresh = docsCommand(["--check"]);
assert.equal(fresh.status, "ok");
assert.equal(fresh.drifted, false);

// 2. Cambia el contrato y la doc se queda vieja: --check tiene que fallar.
const contractPath = path.join(target, "quality-contract.yaml");
fs.writeFileSync(contractPath, fs.readFileSync(contractPath, "utf8").replace("core: 90", "core: 55"), "utf8");

const stale = docsCommandExpectingFailure(["--check"]);
assert.equal(stale.threw, true, "una doc que ya no describe el contrato no puede salir con exito");
assert.equal(stale.status, 2);
assert.equal(stale.payload.status, "stale");
assert.equal(stale.payload.drifted, true);
assert.match(stale.payload.hint, /quality-docs/, "el fallo debe decir como regenerarla, no solo que algo no cuadra");

// 3. --dry-run sobre la misma divergencia: antes devolvia `ok` a ciegas.
const dry = docsCommand(["--dry-run"]);
assert.equal(dry.dryRun, true);
assert.equal(dry.drifted, true, "dry-run debe informar que la corrida real habria cambiado el archivo");

// 4. Regenerar cierra la divergencia: el control vuelve a verde.
docsCommand([]);
assert.equal(docsCommand(["--check"]).drifted, false);
assert.match(fs.readFileSync(path.join(target, "docs", "quality-gates.md"), "utf8"), /core=55/);

console.log("quality-docs divergencia: PASS");
