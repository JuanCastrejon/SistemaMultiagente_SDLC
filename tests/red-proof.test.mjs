// ---------------------------------------------------------------------------
// P10 (ADR 0007): "prueba de rojo" con credito solo por ASERCION real. El
// hallazgo documentado en la investigacion: `it('SC-001', () => { throw new
// Error('not implemented') })` es rojo GRATIS -- cualquier modulo nuevo falla
// al importarse, cualquier `throw` arbitrario cuenta como "fallo", sin que
// eso demuestre que el escenario esta bien especificado. Solo una asercion
// real (expect/assert comparando lo esperado contra lo real y perdiendo) da
// credito.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import YAML from "yaml";
import { verifyRedProof } from "../src/red-proof.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "sdlc.js");
const adapterSource = path.join(repoRoot, "templates", "scripts", "red-proof-adapters", "vitest-json.mjs");

// --- unidad: verifyRedProof --------------------------------------------------
const scenarios = [
  { sc_id: "SC-1", test_ref: "a.test.ts > real", status: "red" },
  { sc_id: "SC-2", test_ref: "b.test.ts > colateral", status: "red" },
  { sc_id: "SC-3", test_ref: "c.test.ts > ya-verde", status: "red" },
  { sc_id: "SC-4", test_ref: "d.test.ts > no-corrio", status: "red" },
  { sc_id: "SC-5", test_ref: null, status: "red" },
  { sc_id: "SC-6", test_ref: "e.test.ts > ignorado", status: "green" }
];
const report = {
  results: [
    { test_ref: "a.test.ts > real", outcome: "assertion-failed" },
    { test_ref: "b.test.ts > colateral", outcome: "collateral-error" },
    { test_ref: "c.test.ts > ya-verde", outcome: "passed" }
  ]
};
const findings = verifyRedProof({ scenarios, report });
const codesBySc = Object.fromEntries(findings.map((f) => [f.sc_id, f.code]));

assert.equal(codesBySc["SC-1"], undefined, "asercion real: credito, sin hallazgo");
assert.equal(codesBySc["SC-2"], "red-proof-collateral-error");
assert.equal(codesBySc["SC-3"], "red-proof-not-red");
assert.equal(codesBySc["SC-4"], "red-proof-test-not-found");
assert.equal(codesBySc["SC-5"], "red-proof-missing-test-ref");
assert.equal(codesBySc["SC-6"], undefined, "status:green no se verifica aqui");
assert.equal(findings.length, 4);

console.log("red-proof unit: PASS");

// --- unidad: adapter vitest-json ---------------------------------------------
const { parse } = await import(pathToFileURL(adapterSource).href);

const vitestReport = {
  testResults: [
    {
      name: "tests/payment.test.ts",
      assertionResults: [
        {
          ancestorTitles: ["cobro"],
          title: "autoriza el cobro",
          status: "failed",
          failureMessages: ["AssertionError: expected 200 to be 402 // Object.is equality\n    at ..."]
        },
        {
          ancestorTitles: ["cobro"],
          title: "rechaza sin fondos",
          status: "failed",
          failureMessages: ["TypeError: authorize is not a function\n    at ..."]
        },
        {
          ancestorTitles: ["cobro"],
          title: "ya implementado",
          status: "passed",
          failureMessages: []
        }
      ]
    }
  ]
};
const parsed = parse(JSON.stringify(vitestReport));
const byRef = Object.fromEntries(parsed.results.map((r) => [r.test_ref, r.outcome]));
assert.equal(byRef["tests/payment.test.ts > cobro > autoriza el cobro"], "assertion-failed");
assert.equal(byRef["tests/payment.test.ts > cobro > rechaza sin fondos"], "collateral-error", "TypeError no es AssertionError: no da credito");
assert.equal(byRef["tests/payment.test.ts > cobro > ya implementado"], "passed");

console.log("red-proof adapter unit: PASS");

// --- E2E: sdlc red-proof-verify sobre evidencia F5 real ---------------------
const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-red-proof-")), "consumidor");
fs.mkdirSync(path.join(target, "scripts", "red-proof-adapters"), { recursive: true });
fs.copyFileSync(adapterSource, path.join(target, "scripts", "red-proof-adapters", "vitest-json.mjs"));

function writeF5(scenarioTraceability) {
  const dir = path.join(target, ".github", "agent-state", "evidence", "slice-red");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "F5.yaml"),
    YAML.stringify({
      phase: "F5",
      slice: "slice-red",
      agent_id: "test",
      started_at: new Date(0).toISOString(),
      outputs: [],
      validators_run: [],
      scenario_traceability: scenarioTraceability
    }),
    "utf8"
  );
}
function writeReport(testResults) {
  fs.mkdirSync(path.join(target, "reports"), { recursive: true });
  fs.writeFileSync(path.join(target, "reports", "red-proof.json"), JSON.stringify({ testResults }), "utf8");
}
function run(args) {
  return spawnSync("node", [cli, ...args], { cwd: repoRoot, encoding: "utf8" });
}

// 1. Asercion real: pasa limpio.
writeF5([{ sc_id: "SC-3f9a2b1c9d4e", test_ref: "tests/payment.test.ts > cobro > autoriza el cobro", status: "red" }]);
writeReport([
  {
    name: "tests/payment.test.ts",
    assertionResults: [
      {
        ancestorTitles: ["cobro"],
        title: "autoriza el cobro",
        status: "failed",
        failureMessages: ["AssertionError: expected 200 to be 402"]
      }
    ]
  }
]);
const healthy = JSON.parse(
  run(["red-proof-verify", "--target", target, "--slice", "slice-red", "--report", "reports/red-proof.json", "--format", "vitest-json", "--json"]).stdout
);
assert.equal(healthy.status, "ok", JSON.stringify(healthy));
assert.equal(healthy.scenariosChecked, 1);

// 2. Rojo gratis: `throw new Error('not implemented')` -- TypeError/Error
// generico, no AssertionError. Bloquea.
writeReport([
  {
    name: "tests/payment.test.ts",
    assertionResults: [
      {
        ancestorTitles: ["cobro"],
        title: "autoriza el cobro",
        status: "failed",
        failureMessages: ["Error: not implemented"]
      }
    ]
  }
]);
const gamedRun = run([
  "red-proof-verify",
  "--target",
  target,
  "--slice",
  "slice-red",
  "--report",
  "reports/red-proof.json",
  "--format",
  "vitest-json",
  "--json"
]);
assert.notEqual(gamedRun.status, 0);
const gamedPayload = JSON.parse(gamedRun.stdout);
assert.equal(gamedPayload.status, "blocked");
assert.ok(gamedPayload.findings.some((f) => f.code === "red-proof-collateral-error"));

console.log("red-proof cli e2e: PASS");
