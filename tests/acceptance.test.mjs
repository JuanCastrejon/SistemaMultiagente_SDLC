// ---------------------------------------------------------------------------
// P9 (ADR 0007): artefacto OpenSpec "acceptance" con sc_id ESTABLE, derivado
// por hash de (capability, requirement, titulo) en vez de un contador
// secuencial. Un contador colisiona entre autores paralelos y se corre de
// lugar si alguien inserta un escenario en medio del archivo; un hash de
// contenido no.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeScenarioId, parseAcceptanceFile, verifyAcceptanceFile, verifyAcceptanceDir } from "../src/acceptance.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "sdlc.js");

// --- unidad: computeScenarioId ----------------------------------------------
const idA = computeScenarioId({ capability: "pagos", requirement: "autorizar cobro", title: "cobro exitoso" });
assert.match(idA, /^SC-[0-9a-f]{12}$/);
assert.equal(idA, computeScenarioId({ capability: "pagos", requirement: "autorizar cobro", title: "cobro exitoso" }), "determinista");
// Insensible a mayusculas y a espacios repetidos: dos autores escribiendo el
// mismo escenario con formato distinto no deben terminar con ids distintos.
assert.equal(idA, computeScenarioId({ capability: "  Pagos  ", requirement: "Autorizar   Cobro", title: "COBRO EXITOSO" }));
// Un titulo distinto es, por diseño, un escenario distinto.
assert.notEqual(idA, computeScenarioId({ capability: "pagos", requirement: "autorizar cobro", title: "cobro rechazado" }));

// --- unidad: parseAcceptanceFile --------------------------------------------
const wellFormed = [
  "## Capability: pagos-tarjeta",
  "",
  "### Requirement: autorizar cobro con tarjeta valida",
  "La API SHALL autorizar el cobro cuando hay fondos suficientes.",
  "",
  "#### Scenario: cobro exitoso con tarjeta valida",
  `<!-- sc_id: ${computeScenarioId({ capability: "pagos-tarjeta", requirement: "autorizar cobro con tarjeta valida", title: "cobro exitoso con tarjeta valida" })} -->`,
  "<!-- test_ref: tests/payment.test.ts > autoriza el cobro -->",
  "- **GIVEN** una tarjeta valida con fondos suficientes",
  "- **WHEN** el cliente confirma el pago",
  "- **THEN** el cobro se autoriza"
].join("\n");

const parsed = parseAcceptanceFile(wellFormed);
assert.equal(parsed.capability, "pagos-tarjeta");
assert.equal(parsed.scenarios.length, 1);
assert.equal(parsed.scenarios[0].requirement, "autorizar cobro con tarjeta valida");
assert.equal(parsed.scenarios[0].testRef, "tests/payment.test.ts > autoriza el cobro");

// --- unidad: verifyAcceptanceFile -------------------------------------------
const wellFormedResult = verifyAcceptanceFile(wellFormed);
assert.equal(wellFormedResult.findings.length, 0, JSON.stringify(wellFormedResult.findings));

// sc_id ausente.
const missingId = wellFormed.replace(/<!-- sc_id:.*-->\n/, "");
const missingResult = verifyAcceptanceFile(missingId);
assert.equal(missingResult.findings.length, 1);
assert.equal(missingResult.findings[0].code, "sc-id-missing");

// El titulo cambio pero el sc_id declarado se quedo atras (stale): el hash ya
// no coincide con lo que el archivo dice ahora.
const staleId = wellFormed.replace("cobro exitoso con tarjeta valida\n<!--", "cobro exitoso con tarjeta corporativa\n<!--");
const staleResult = verifyAcceptanceFile(staleId);
assert.ok(staleResult.findings.some((f) => f.code === "sc-id-mismatch"), JSON.stringify(staleResult.findings));

// sc_id duplicado dentro del mismo archivo (copy-paste de un escenario sin
// cambiar nada, o dos escenarios que casualmente hashean igual).
const duplicated = `${wellFormed}\n\n${wellFormed.split("\n").slice(2).join("\n")}`;
const duplicatedResult = verifyAcceptanceFile(duplicated);
assert.ok(duplicatedResult.findings.some((f) => f.code === "sc-id-duplicate"));

// Escenario fuera de cualquier Requirement: no hay que que hashear contra
// requirement=null en silencio.
const orphan = "#### Scenario: huerfano\n<!-- sc_id: SC-deadbeefdead -->\n- **GIVEN** x\n- **WHEN** y\n- **THEN** z";
const orphanResult = verifyAcceptanceFile(orphan);
assert.ok(orphanResult.findings.some((f) => f.code === "scenario-without-requirement"));

console.log("acceptance unit: PASS");

// --- E2E: sdlc acceptance-verify sobre un change real -----------------------
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-acceptance-"));
const target = path.join(tempRoot, "consumidor");
const acceptanceDir = path.join(target, "openspec", "changes", "cambio-pagos", "acceptance");
fs.mkdirSync(acceptanceDir, { recursive: true });
fs.writeFileSync(path.join(acceptanceDir, "pagos-tarjeta.feature.md"), wellFormed, "utf8");

function run(args) {
  return execFileSync("node", [cli, ...args], { cwd: repoRoot, encoding: "utf8" });
}
function runAllowFailure(args) {
  return spawnSync("node", [cli, ...args], { cwd: repoRoot, encoding: "utf8" });
}

// 1. Sano: pasa limpio.
const okOut = JSON.parse(run(["acceptance-verify", "--target", target, "--change", "cambio-pagos", "--json"]));
assert.equal(okOut.status, "ok", JSON.stringify(okOut));
assert.deepEqual(okOut.files, ["pagos-tarjeta.feature.md"]);

// 2. Un segundo archivo con el MISMO (capability, requirement, titulo) que el
// primero: colision de sc_id entre archivos distintos, no solo dentro de uno.
fs.writeFileSync(path.join(acceptanceDir, "otra-capability.feature.md"), wellFormed, "utf8");
const collided = runAllowFailure(["acceptance-verify", "--target", target, "--change", "cambio-pagos", "--json"]);
assert.notEqual(collided.status, 0);
const collidedPayload = JSON.parse(collided.stdout);
assert.equal(collidedPayload.status, "blocked");
assert.ok(collidedPayload.findings.some((f) => f.code === "sc-id-duplicate-cross-file"), JSON.stringify(collidedPayload.findings));

// 3. Sin directorio acceptance/ para el change: not-configured, no un crash.
const missingChange = runAllowFailure(["acceptance-verify", "--target", target, "--change", "no-existe", "--json"]);
assert.notEqual(missingChange.status, 0);
assert.equal(JSON.parse(missingChange.stdout).code, "acceptance-dir-missing");

console.log("acceptance cli e2e: PASS");
