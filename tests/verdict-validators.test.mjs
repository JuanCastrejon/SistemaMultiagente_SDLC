// ---------------------------------------------------------------------------
// P12 (ADR 0007): los 8 VERDICT_STEPS de `sdlc verdict` (control-plane, drift,
// slice-traceability, surface-traceability, semantic-guardrails,
// adr-integrity, openspec, active-slices) eran solo NOMBRES de scripts que el
// framework esperaba que el consumidor escribiera — sin ninguna
// implementacion de referencia, cada uno quedaba `not-configured` para
// siempre. Este test corre las 8 implementaciones reales
// (templates/scripts/validators/) contra un install de verdad.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "sdlc.js");
const validatorsSource = path.join(repoRoot, "templates", "scripts", "validators");
const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-verdict-validators-")), "consumidor");

function runValidator(name) {
  return spawnSync("node", [path.join(target, "scripts", "validators", `validate-${name}.mjs`)], { cwd: target, encoding: "utf8" });
}

// --- consumidor real: install de fabrica + validadores + CLI resoluble ------
fs.mkdirSync(target, { recursive: true });
execFileSync("node", [cli, "install", "--target", target, "--mode", "greenfield", "--project-name", "Demo", "--json"], {
  cwd: repoRoot,
  encoding: "utf8"
});
fs.mkdirSync(path.join(target, "scripts", "validators"), { recursive: true });
for (const file of fs.readdirSync(validatorsSource)) {
  fs.copyFileSync(path.join(validatorsSource, file), path.join(target, "scripts", "validators", file));
}
// `_shared.mjs` resuelve el CLI via `require.resolve("sistema-multiagente-sdlc/...")`:
// necesita el paquete real en node_modules, como en cualquier devDependency.
const linkPath = path.join(target, "node_modules", "sistema-multiagente-sdlc");
fs.mkdirSync(path.dirname(linkPath), { recursive: true });
fs.symlinkSync(repoRoot, linkPath, os.platform() === "win32" ? "junction" : "dir");

// --- drift: un install de fabrica NO esta configurado, y se ve --------------
// El instalador ya no escribe superficies de ejemplo, asi que `doctor` sale en
// error hasta que alguien declare las reales. Es el estado correcto: antes el
// repo parecia listo y los gates median sobre paths inexistentes.
const driftSinSuperficies = runValidator("drift");
assert.notEqual(driftSinSuperficies.status, 0);
assert.match(driftSinSuperficies.stdout + driftSinSuperficies.stderr, /config-surfaces-empty/);

// Declaradas las superficies reales (lo que hace un consumidor), no hay drift.
const configPath = path.join(target, ".sdlc", "config.json");
const installedConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
// Clasificadas, como las declara un consumidor real desde 2.0.0: sin los cuatro
// riesgos, `upgrade` termina en `action-required` por el eje de autorizacion y
// este caso mide validators, no autorizacion.
const sinRiesgos = { moneyPath: false, regulatedData: false, securityCritical: false, stateMachineCritical: false };
installedConfig.surfaces = [
  { id: "backend", path: "apps/api", owner: "api-agent", tier: "core", ...sinRiesgos },
  { id: "web", path: "apps/web", owner: "web-agent", tier: "standard", hasUi: true, ...sinRiesgos }
];
fs.writeFileSync(configPath, JSON.stringify(installedConfig, null, 2), "utf8");
execFileSync("node", [cli, "upgrade", "--target", target, "--accept-managed", ".sdlc/config.json", "--json"], {
  cwd: repoRoot,
  encoding: "utf8"
});

const drift = runValidator("drift");
assert.equal(drift.status, 0, drift.stdout + drift.stderr);

// --- control-plane: toda persona declarada en config resuelve a un archivo -
// La convencion de nombre NO es uniforme (`<id>.agent.md` vs `<id>.md`): esto
// prueba que el validador no produce falsos positivos contra un install real.
const controlPlaneOk = runValidator("control-plane");
assert.equal(controlPlaneOk.status, 0, controlPlaneOk.stdout + controlPlaneOk.stderr);
// Se borra una persona real: debe fallar.
fs.rmSync(path.join(target, ".github", "agents", "analista-requisitos.agent.md"));
const controlPlaneMissing = runValidator("control-plane");
assert.notEqual(controlPlaneMissing.status, 0);
assert.match(controlPlaneMissing.stdout + controlPlaneMissing.stderr, /analista-requisitos/);

// --- surface-traceability: las superficies de fabrica no existen aun -------
const surfacesMissing = runValidator("surface-traceability");
assert.notEqual(surfacesMissing.status, 0);
assert.match(surfacesMissing.stdout + surfacesMissing.stderr, /apps\/api|apps\\api/);
// Se crean de verdad: pasa.
fs.mkdirSync(path.join(target, "apps", "api"), { recursive: true });
fs.mkdirSync(path.join(target, "apps", "web"), { recursive: true });
const surfacesOk = runValidator("surface-traceability");
assert.equal(surfacesOk.status, 0, surfacesOk.stdout + surfacesOk.stderr);

// --- semantic-guardrails: el doc de fabrica ya supera el minimo -------------
const guardrailsOk = runValidator("semantic-guardrails");
assert.equal(guardrailsOk.status, 0, guardrailsOk.stdout + guardrailsOk.stderr);
// Un stub vacio no puede pasar como "guardrails reales".
fs.writeFileSync(path.join(target, "docs", "agents", "guardrails-semanticos-del-dominio.md"), "TODO\n", "utf8");
const guardrailsStub = runValidator("semantic-guardrails");
assert.notEqual(guardrailsStub.status, 0);

// --- adr-integrity: sin docs/adr todavia, falla claro (no un crash) --------
const adrMissing = runValidator("adr-integrity");
assert.notEqual(adrMissing.status, 0);
assert.match(adrMissing.stdout + adrMissing.stderr, /no existe/);
// Dos ADRs bien enlazados: pasa.
fs.mkdirSync(path.join(target, "docs", "adr"), { recursive: true });
fs.writeFileSync(path.join(target, "docs", "adr", "0001-primero.md"), "# ADR 1\n", "utf8");
fs.writeFileSync(path.join(target, "docs", "adr", "0002-segundo.md"), "# ADR 2\n", "utf8");
fs.appendFileSync(path.join(target, "indice-operativo.md"), "\n- 0001-primero.md\n- 0002-segundo.md\n");
const adrOk = runValidator("adr-integrity");
assert.equal(adrOk.status, 0, adrOk.stdout + adrOk.stderr);
// Un tercer ADR sin enlazar: falla.
fs.writeFileSync(path.join(target, "docs", "adr", "0003-huerfano.md"), "# ADR 3\n", "utf8");
const adrOrphan = runValidator("adr-integrity");
assert.notEqual(adrOrphan.status, 0);
assert.match(adrOrphan.stdout + adrOrphan.stderr, /0003-huerfano/);

// --- active-slices: F0 (bootstrap) no exige change propio -------------------
const activeSlicesBootstrap = runValidator("active-slices");
assert.equal(activeSlicesBootstrap.status, 0, activeSlicesBootstrap.stdout + activeSlicesBootstrap.stderr);

// --- slice-traceability: en F0 no hay fases anteriores que trazar ----------
const sliceTraceability = runValidator("slice-traceability");
assert.equal(sliceTraceability.status, 0, sliceTraceability.stdout + sliceTraceability.stderr);

// --- openspec: sin @fission-ai/openspec declarado, falla claro -------------
const openspecMissing = runValidator("openspec");
assert.notEqual(openspecMissing.status, 0);
assert.match(openspecMissing.stdout + openspecMissing.stderr, /no resuelve/);

console.log("verdict-validators: PASS");

// --- CONSUMIDOR SIN package.json -------------------------------------------
// Encontrado instalando la 1.8.0 publicada en un repo brownfield real (una
// extension Chrome, sin package.json). `verdict` devolvia NOT-READY con
// bloqueante `control-plane`, mientras el validador corria solo con exit 0 y
// "OK: 10 referencias resuelven". El precheck de `not-configured` exigia
// `declaredScripts` truthy; sin package.json eso es null, el paso se ejecutaba
// igual, `pnpm run` fallaba, y el veredicto acusaba a un archivo sano.
{
  const sinPkg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-verdict-nopkg-")), "consumidor");
  fs.mkdirSync(sinPkg, { recursive: true });
  execFileSync("git", ["init", "--quiet"], { cwd: sinPkg });
  execFileSync("node", [cli, "install", "--target", sinPkg, "--mode", "legacy", "--project-name", "Sin Package", "--json"], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  const run = spawnSync("node", [cli, "verdict", "--target", sinPkg, "--json"], { cwd: repoRoot, encoding: "utf8" });
  const payload = JSON.parse(run.stdout);

  assert.deepEqual(payload.blockers, [], "no puede acusar a un validador que nunca llego a ejecutarse");
  assert.equal(payload.notConfigured.length, payload.steps.length, "sin package.json NINGUN paso esta configurado");
  assert.ok(
    payload.steps.every((step) => step.status === "not-configured"),
    "ni pass ni fail: no se pudo ejecutar"
  );
  assert.match(payload.steps[0].detail, /package\.json/, "el detalle tiene que nombrar la causa real");

  // Y NO puede ser READY: arreglar el falso rojo sin esto lo convertia en un
  // falso VERDE — 8 pasos sin correr y veredicto aprobado. El falso verde es
  // peor, porque nadie lo investiga.
  assert.equal(payload.verdict, "NOT-VERIFIABLE", "no se verifico nada: no es READY ni NOT-READY");
  assert.equal(payload.status, "not-configured");
  assert.match(payload.vacuousReason, /package\.json/);
  assert.notEqual(run.status, 0, "un veredicto no verificable no puede salir con exito");
}

// --- CONTRACARA: con scripts declarados, el veredicto vuelve a decidir ------
// Sin este caso el guard de vacuidad podria estar bloqueando siempre, y el
// test no notaria la diferencia entre un control y un muro.
{
  const conPkg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-verdict-conpkg-")), "consumidor");
  fs.mkdirSync(conPkg, { recursive: true });
  execFileSync("git", ["init", "--quiet"], { cwd: conPkg });
  execFileSync("node", [cli, "install", "--target", conPkg, "--mode", "legacy", "--project-name", "Con Package", "--json"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  // Script en ARCHIVO, no `node -e`: el runner anexa `--if-present` y `node -e`
  // lo toma como opcion propia ("bad option"), que es un fallo del fixture y no
  // del producto.
  fs.writeFileSync(path.join(conPkg, "ok.mjs"), "console.log('ok');\n", "utf8");
  fs.writeFileSync(
    path.join(conPkg, "package.json"),
    JSON.stringify({ name: "con-pkg", scripts: { "validate:control-plane": "node ok.mjs", "validate:drift": "node ok.mjs" } }, null, 2),
    "utf8"
  );

  const payload = JSON.parse(spawnSync("node", [cli, "verdict", "--target", conPkg, "--json"], { cwd: repoRoot, encoding: "utf8" }).stdout);
  assert.equal(payload.verdict, "READY", "con pasos declarados y en verde, el veredicto vuelve a aprobar");
  assert.equal(payload.steps.filter((step) => step.status === "pass").length, 2);
  assert.ok(payload.notConfigured.length > 0, "los no declarados siguen siendo not-configured, no fail");
}

console.log("verdict sin package.json: PASS");
