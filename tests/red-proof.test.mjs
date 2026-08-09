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

// --- unidad: un test_ref no puede acreditar varios escenarios ---------------
// Sin esto, N escenarios apuntando al mismo test cobraban credito de UNA sola
// asercion: se demuestra un rojo y se acreditan N. Misma vacuidad por
// denominador que el resto del gauntlet rechaza, con otra forma.
{
  const colision = verifyRedProof({
    scenarios: [
      { sc_id: "SC-A", test_ref: "a.test.ts > uno", status: "red" },
      { sc_id: "SC-B", test_ref: "a.test.ts > uno", status: "red" }
    ],
    report: { results: [{ test_ref: "a.test.ts > uno", outcome: "assertion-failed" }] }
  });
  assert.equal(colision.length, 2, "los dos escenarios en colision tienen que reportarse, no solo uno");
  assert.ok(colision.every((f) => f.code === "red-proof-test-ref-collision"));
  assert.deepEqual(colision.find((f) => f.sc_id === "SC-A").sharedWith, ["SC-B"], "el hallazgo debe nombrar con quien colisiona");

  // Contracara: un test_ref por escenario sigue dando credito limpio.
  const sinColision = verifyRedProof({
    scenarios: [
      { sc_id: "SC-A", test_ref: "a.test.ts > uno", status: "red" },
      { sc_id: "SC-B", test_ref: "a.test.ts > dos", status: "red" }
    ],
    report: {
      results: [
        { test_ref: "a.test.ts > uno", outcome: "assertion-failed" },
        { test_ref: "a.test.ts > dos", outcome: "assertion-failed" }
      ]
    }
  });
  assert.deepEqual(sinColision, [], "un test por escenario es el caso legitimo y debe pasar");
}

// --- unidad: resultado duplicado en el reporte es indecidible ---------------
// `new Map(lista)` se queda con la ULTIMA entrada en silencio: un test que
// falla por asercion podia quedar tapado por otro homonimo que pasa, o al
// reves, segun el orden de aparicion.
{
  const ambiguo = verifyRedProof({
    scenarios: [{ sc_id: "SC-A", test_ref: "a.test.ts > uno", status: "red" }],
    report: {
      results: [
        { test_ref: "a.test.ts > uno", outcome: "passed" },
        { test_ref: "a.test.ts > uno", outcome: "assertion-failed" }
      ]
    }
  });
  assert.equal(ambiguo.length, 1);
  assert.equal(ambiguo[0].code, "red-proof-ambiguous-result", "elegir uno de los dos seria inventar la respuesta");
}

console.log("red-proof colisiones: PASS");

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

// --- unidad: hasta donde llega la heuristica del adapter --------------------
// Las formas de abajo son las MEDIDAS con node:assert, no supuestas. La
// fabricacion perezosa (`new AssertionError({})`) deja la huella degenerada
// `undefined undefined undefined` y se puede cerrar; una asercion legitima con
// mensaje propio y un `throw new AssertionError('texto plausible')` son
// IDENTICAS por texto y no se pueden separar sin un wrapper que ejecute la
// comparacion. Eso ultimo esta declarado en `limitations`, no disimulado.
{
  function classify(message) {
    const report = {
      testResults: [
        {
          name: "t.test.ts",
          assertionResults: [{ ancestorTitles: [], title: "caso", status: "failed", failureMessages: [message] }]
        }
      ]
    };
    return parse(JSON.stringify(report)).results[0].outcome;
  }

  // Se cierra: AssertionError construido sin argumentos.
  assert.equal(
    classify("AssertionError [ERR_ASSERTION]: undefined undefined undefined\n    at ..."),
    "collateral-error",
    "un AssertionError sin argumentos no describe comparacion alguna: no es prueba de nada"
  );
  assert.equal(classify("AssertionError [ERR_ASSERTION]:\n    at ..."), "collateral-error", "nombre de clase sin mensaje tampoco");

  // Sigue dando credito: aserciones reales, con y sin diff estructurado.
  assert.equal(classify("AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n\n1 !== 2\n"), "assertion-failed");
  assert.equal(
    classify("AssertionError [ERR_ASSERTION]: el pago debe rechazarse sin fondos\n    at ..."),
    "assertion-failed",
    "una asercion legitima con mensaje propio no puede quedar fuera: seria un falso negativo que empuja a no adoptar la pieza"
  );

  // LIMITE DECLARADO, verificado a proposito: esta forma es fabricable y pasa.
  // El test lo fija para que nadie crea que la heuristica cubre mas de lo que
  // cubre; cerrarlo exige procedencia de CI o un wrapper de asercion.
  assert.equal(
    classify("AssertionError [ERR_ASSERTION]: expected 1 to be 2\n    at ..."),
    "assertion-failed",
    "limite conocido: un mensaje fabricado que imita una asercion es indistinguible por texto"
  );
}

console.log("red-proof limites del adapter: PASS");

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

// --- 3. NO-VACUIDAD: la ruta mas barata NO era falsear un outcome ---------
// Era borrar el bloque `scenario_traceability` del F5.yaml (el schema no lo
// exige) o no marcar ningun escenario como `red`. Con cero sujetos,
// verifyRedProof devolvia [] y el comando salia ok / exit 0: "no se pudo
// medir" indistinguible de "todo bien".
function writeF5Raw(scenarioTraceability) {
  const dir = path.join(target, ".github", "agent-state", "evidence", "slice-vacuo");
  fs.mkdirSync(dir, { recursive: true });
  const doc = {
    phase: "F5",
    slice: "slice-vacuo",
    agent_id: "test",
    started_at: new Date(0).toISOString(),
    outputs: [],
    validators_run: []
  };
  if (scenarioTraceability !== undefined) doc.scenario_traceability = scenarioTraceability;
  fs.writeFileSync(path.join(dir, "F5.yaml"), YAML.stringify(doc), "utf8");
}
const argsVacuo = [
  "red-proof-verify", "--target", target, "--slice", "slice-vacuo",
  "--report", "reports/red-proof.json", "--format", "vitest-json", "--json"
];

// (a) sin bloque scenario_traceability
writeF5Raw(undefined);
const sinBloque = run(argsVacuo);
assert.notEqual(sinBloque.status, 0, "una evidencia sin scenario_traceability no puede pasar el gate de rojo");
assert.equal(JSON.parse(sinBloque.stdout).code, "red-proof-vacuous");

// (b) bloque presente pero vacio
writeF5Raw([]);
assert.equal(JSON.parse(run(argsVacuo).stdout).code, "red-proof-vacuous");

// (c) escenarios declarados, pero ninguno en rojo: no hay nada que demostrar
writeF5Raw([{ sc_id: "SC-abc123abc123", test_ref: "a.test.ts > x", status: "green" }]);
const ningunRojo = JSON.parse(run(argsVacuo).stdout);
assert.equal(ningunRojo.code, "red-proof-vacuous");
assert.equal(ningunRojo.scenariosTotal, 1);
assert.equal(ningunRojo.scenariosChecked, 0, "el payload tiene que decir cuantos sujetos se evaluaron de verdad");

console.log("red-proof cli e2e: PASS");

// --- el veredicto viaja SIEMPRE con su propio limite ------------------------
// Esta pieza no es prueba autoritativa segun el ADR: no consume
// `red_proof_run_id` ni `red_proof_sha` (que el schema de evidencia ya
// reserva), asi que adjudica un reporte que el propio evaluado produce, en la
// maquina que el evaluado controla. Entregarla sin decirlo seria exactamente
// el fraude que P10 existe para detectar: un control con apariencia de
// control. Por eso `ok` significa "no se detecto trampa", nunca "el rojo quedo
// demostrado" -- y eso tiene que estar en el payload, no solo en un comentario.
{
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
  const limpio = run([
    "red-proof-verify", "--target", target, "--slice", "slice-red",
    "--report", "reports/red-proof.json", "--format", "vitest-json", "--json"
  ]);
  const payload = JSON.parse(limpio.stdout);
  assert.equal(payload.status, "ok");
  assert.equal(payload.authoritative, false, "no puede presentarse como prueba autoritativa mientras no ancle procedencia");
  assert.equal(payload.advisory, true);
  assert.equal(payload.proofStrength, "heuristic");
  assert.ok(Array.isArray(payload.limitations) && payload.limitations.length >= 3);
  assert.ok(
    payload.limitations.some((line) => line.includes("red_proof_run_id") && line.includes("red_proof_sha")),
    "la limitacion principal debe nombrar los campos concretos que faltan por consumir"
  );
}

console.log("red-proof limite declarado en el payload: PASS");
