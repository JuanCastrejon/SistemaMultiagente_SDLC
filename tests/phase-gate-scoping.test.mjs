// ---------------------------------------------------------------------------
// Issue reportado por un consumidor real, decision del lead 2026-08-18: `phase-gate`
// bloqueaba el 100% de los PRs del repo, sin importar que tocaran, por dos
// causas raiz:
//
// 1. `openspec/changes/<slice>/...` sustituia el slice ID literal como
//    nombre de carpeta de change, pero ningun change real se nombro asi
//    jamas (usan nombres descriptivos, mapeados via
//    `active-slices.yaml.openspec_change`). Confirmado bloqueando
//    `SLICE-HYB-001` (~3 meses sin detectarse) y `SLICE-DOC-001` (en vivo).
// 2. `phase-gate` evaluaba el slice/fase GLOBAL del repo
//    (`phase-status.yaml`), nunca lo que el PR realmente tocaba. El
//    mecanismo para scopear (`touches_locked`/`touches_proposed` en
//    `active-slices.yaml`) ya existia para F5 y no se reusaba aqui.
//
// Estos casos cubren ambos fixes y, critico, el caso de NO-bypass: un PR
// que SI toca la superficie del slice activo tiene que seguir bloqueando
// exactamente igual que antes de este cambio.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { commandPhaseGate } from "../src/harness.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-phase-gate-scoping-"));

const MINIMAL_CONTRACT = [
  "version: 2",
  "phases:",
  "  - id: TEST",
  "    inputs_required: [openspec/changes/<slice>/proposal.md]",
  ""
].join("\n");

// `evaluatePhaseReadiness` adjudica autorizacion (ADR 0008) SIEMPRE, incluso
// en fases sin `human_gate`: sin `quality-contract.yaml` con superficies
// clasificadas, `authz-surfaces-empty` bloquea por si solo -- ruido de un eje
// que estos casos no prueban. Mismo contrato "limpio" que
// `tests/authz-git.test.mjs` usa para aislar lo que si se prueba aqui.
const CONTRATO_LIMPIO = [
  "version: 1",
  "surfaces:",
  "  - id: app",
  "    path: src",
  "    tier: core",
  "    money_path: false",
  "    regulated_data: false",
  "    security_critical: false",
  "    state_machine_critical: false",
  ""
].join("\n");

function makeRepo(name, { activeSlicesYaml = null, writeRealProposalAt = null } = {}) {
  const target = path.join(tempRoot, name);
  fs.mkdirSync(path.join(target, ".github", "agent-state"), { recursive: true });
  fs.writeFileSync(path.join(target, "phase-contract.yaml"), MINIMAL_CONTRACT, "utf8");
  fs.writeFileSync(path.join(target, "quality-contract.yaml"), CONTRATO_LIMPIO, "utf8");
  if (activeSlicesYaml) {
    fs.writeFileSync(path.join(target, ".github", "agent-state", "active-slices.yaml"), activeSlicesYaml, "utf8");
  }
  if (writeRealProposalAt) {
    const proposalPath = path.join(target, writeRealProposalAt);
    fs.mkdirSync(path.dirname(proposalPath), { recursive: true });
    fs.writeFileSync(proposalPath, "# proposal\n", "utf8");
  }
  return target;
}

// --- 1. resolucion openspec_change: entrada en `active:` --------------------
{
  const target = makeRepo("openspec-active", {
    activeSlicesYaml: [
      "active:",
      "  - slice: SLICE-X",
      "    openspec_change: openspec/changes/real-name-x",
      "archive: []",
      ""
    ].join("\n"),
    writeRealProposalAt: "openspec/changes/real-name-x/proposal.md"
  });
  const result = commandPhaseGate({ target, phase: "TEST", slice: "SLICE-X" });
  assert.equal(result.payload.status, "ok", "el artefacto real se encuentra via openspec_change, no bloquea");
  assert.equal(result.payload.inputs[0].exists, true);
  assert.match(result.payload.inputs[0].absolute.replace(/\\/g, "/"), /real-name-x\/proposal\.md$/);
}

// --- 2. resolucion openspec_change: entrada en `archive:` (post-cierre) -----
{
  const target = makeRepo("openspec-archive", {
    activeSlicesYaml: [
      "active: []",
      "archive:",
      "  - slice: SLICE-Y",
      "    openspec_change: openspec/changes/archive/2026-08-18-real-name-y",
      ""
    ].join("\n"),
    writeRealProposalAt: "openspec/changes/archive/2026-08-18-real-name-y/proposal.md"
  });
  const result = commandPhaseGate({ target, phase: "TEST", slice: "SLICE-Y" });
  assert.equal(result.payload.status, "ok", "resuelve tambien contra una entrada de archive");
  assert.equal(result.payload.inputs[0].exists, true);
}

// --- 3. sin active-slices.yaml: comportamiento literal previo, sin cambios --
{
  const target = makeRepo("no-active-slices-file");
  const result = commandPhaseGate({ target, phase: "TEST", slice: "SLICE-Z" });
  assert.equal(result.payload.status, "blocked", "sin active-slices.yaml cae al path literal, que no existe");
  assert.equal(result.payload.inputs[0].exists, false);
  assert.match(result.payload.inputs[0].absolute.replace(/\\/g, "/"), /openspec\/changes\/SLICE-Z\/proposal\.md$/);
}

// --- 4. --touched-paths fuera de la superficie declarada: scoped-out --------
{
  const target = makeRepo("scoped-out", {
    activeSlicesYaml: [
      "active:",
      "  - slice: SLICE-DOC-001",
      "    touches_locked: [docs/legacy/**]",
      "    touches_proposed: []",
      "archive: []",
      ""
    ].join("\n")
  });
  const result = commandPhaseGate({
    target,
    phase: "TEST",
    slice: "SLICE-DOC-001",
    "exit-code": true,
    "touched-paths": "README.md,apps/api/src/foo.ts"
  });
  assert.equal(result.exitCode, 0, "un PR que no toca la superficie del slice no bloquea con --exit-code");
  assert.equal(result.payload.status, "scoped-out");
  assert.equal(result.payload.scoping.evaluated, true);
  assert.equal(result.payload.scoping.inScope, false);
}

// --- 5. caso critico de NO-bypass: --touched-paths SI toca la superficie ----
{
  const target = makeRepo("still-blocks", {
    activeSlicesYaml: [
      "active:",
      "  - slice: SLICE-DOC-001",
      "    touches_locked: [docs/legacy/**]",
      "    touches_proposed: []",
      "archive: []",
      ""
    ].join("\n")
  });
  const withoutFlag = commandPhaseGate({ target, phase: "TEST", slice: "SLICE-DOC-001", "exit-code": true });
  const withFlag = commandPhaseGate({
    target,
    phase: "TEST",
    slice: "SLICE-DOC-001",
    "exit-code": true,
    "touched-paths": "docs/legacy/pantallas/foo.md"
  });
  assert.equal(withoutFlag.exitCode, 2);
  assert.equal(withFlag.exitCode, 2, "un PR que SI toca la superficie del slice sigue bloqueando igual que antes");
  assert.equal(withFlag.payload.status, "blocked");
  assert.equal(withFlag.payload.scoping.inScope, true);
}

// --- 6. slice sin entrada en active-slices.yaml + --touched-paths: sin bypass
{
  const target = makeRepo("undeclared-slice-no-bypass", {
    activeSlicesYaml: ["active: []", "archive: []", ""].join("\n")
  });
  const result = commandPhaseGate({
    target,
    phase: "TEST",
    slice: "SLICE-NO-DECLARADO",
    "exit-code": true,
    "touched-paths": "README.md"
  });
  assert.equal(result.exitCode, 2, "sin datos de scoping, el gate se comporta como si el flag no existiera");
  assert.equal(result.payload.status, "blocked");
  assert.equal(result.payload.scoping.evaluated, false);
  assert.equal(result.payload.scoping.inScope, true);
}

// --- 7. sin --touched-paths: payload identico al de antes de este cambio ----
{
  const target = makeRepo("no-flag-at-all", {
    activeSlicesYaml: [
      "active:",
      "  - slice: SLICE-DOC-001",
      "    touches_locked: [docs/legacy/**]",
      "archive: []",
      ""
    ].join("\n")
  });
  const result = commandPhaseGate({ target, phase: "TEST", slice: "SLICE-DOC-001", "exit-code": true });
  assert.equal(result.exitCode, 2);
  assert.equal(result.payload.status, "blocked");
  assert.equal("scoping" in result.payload, false, "sin el flag no aparece el campo scoping en el payload");
}

console.log("phase-gate scoping (--touched-paths + openspec_change): PASS");
