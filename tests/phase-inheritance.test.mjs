// ---------------------------------------------------------------------------
// P7 (ADR 0007): F14 (merge) no mide nada propio. La sintesis original
// proponia un guard anti-regresion en F14 antes de fusionar; quedo sin
// conectar en 1.11.0 porque el mecanismo de quality_gates por fase adjudica
// sobre la evidencia de ESA MISMA fase, y F14 nunca produce mediciones
// propias (gap documentado, no resuelto). Este test prueba la herencia: F14
// declara gates de F8/F10 y se re-verifican leyendo la evidencia de la fase
// que SI midio, sin fabricar un mecanismo de arrastre.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { computeTreeHash } from "../src/evidence-writer.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "sdlc.js");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-phase-inheritance-"));
const target = path.join(tempRoot, "consumidor");

function run(args) {
  return execFileSync("node", [cli, ...args], { cwd: repoRoot, encoding: "utf8" });
}
function phaseGate(phase, slice) {
  return JSON.parse(run(["phase-gate", "--target", target, "--phase", phase, "--slice", slice, "--json"]));
}
function writeEvidence(slice, phase, body) {
  const dir = path.join(target, ".github", "agent-state", "evidence", slice);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${phase}.yaml`), YAML.stringify(body), "utf8");
}
function baseEvidence(phase, slice, extra = {}) {
  return {
    phase,
    slice,
    agent_id: "test",
    started_at: new Date(0).toISOString(),
    outputs: [],
    validators_run: [],
    ...extra
  };
}

fs.mkdirSync(target, { recursive: true });
run(["install", "--target", target, "--mode", "greenfield", "--project-name", "Demo", "--json"]);
// El instalador ya no escribe superficies de ejemplo: las declara este test,
// que es lo que hace un consumidor real. Tienen que existir tambien en disco,
// porque si no checkSurfaces las marca fantasma y bloquea SIEMPRE,
// independiente de lo que digan los gates.
{
  const configPath = path.join(target, ".sdlc", "config.json");
  const installed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  // Los cuatro riesgos van CLASIFICADOS, como los declara un consumidor real
  // desde 2.0.0: sin clasificar, el ADR 0008 obliga a atestacion firmada en toda
  // fase con gate humano, y este caso —que mide herencia de gates de CALIDAD— se
  // pondria rojo por una razon que no esta midiendo.
  const sinRiesgos = { moneyPath: false, regulatedData: false, securityCritical: false, stateMachineCritical: false };
  installed.surfaces = [
    { id: "backend", path: "apps/api", owner: "api-agent", tier: "core", ...sinRiesgos },
    { id: "web", path: "apps/web", owner: "web-agent", tier: "standard", hasUi: true, ...sinRiesgos }
  ];
  fs.writeFileSync(configPath, JSON.stringify(installed, null, 2), "utf8");
  run(["upgrade", "--target", target, "--accept-managed", ".sdlc/config.json", "--json"]);
}
// El consumidor tiene que ser un repo git con rama de integracion REMOTA: desde
// 2.0.0 `phase-gate` compara la obligacion de autorizacion contra la base
// declarada, y no poder resolverla bloquea a proposito.
for (const args of [
  ["init", "--quiet"],
  ["config", "user.email", "test@example.com"],
  ["config", "user.name", "Test"],
  ["add", "-A"],
  ["commit", "--quiet", "-m", "consumidor instalado"],
  ["update-ref", "refs/remotes/origin/develop", "HEAD"]
]) {
  execFileSync("git", args, { cwd: target });
}

fs.mkdirSync(path.join(target, "apps", "api"), { recursive: true });
fs.writeFileSync(path.join(target, "apps", "api", "index.ts"), "export const api = 1;\n", "utf8");
fs.mkdirSync(path.join(target, "apps", "web"), { recursive: true });
fs.writeFileSync(path.join(target, "apps", "web", "index.ts"), "export const web = 1;\n", "utf8");

const slice = "slice-f14";

// --- F8 y F10: mediciones reales que F14 va a heredar -----------------------
writeEvidence(slice, "F8", baseEvidence("F8", slice, {
  quality_metrics: {
    measured_at: new Date(0).toISOString(),
    source: "ci",
    tree_hash: "hash-f8",
    probes: [],
    metrics: { coverage: { changed_lines_pct: 95, changed_lines_total: 20 } }
  }
}));
writeEvidence(slice, "F10", baseEvidence("F10", slice, {
  quality_metrics: {
    measured_at: new Date(0).toISOString(),
    source: "ci",
    tree_hash: "hash-f10",
    probes: [],
    metrics: { dependencies: { violations: 0, cycles: 0, modules_scanned: 12 } }
  }
}));

// F14 exige F13.yaml como input (QA de caja negra previo al merge).
writeEvidence(slice, "F13", baseEvidence("F13", slice, {
  human_gate_signoff: { approved_by: "maintainer", review_id: "PR-1" }
}));

// --- F14: NUNCA mide nada propio, solo trae la firma humana -----------------
writeEvidence(slice, "F14", baseEvidence("F14", slice, {
  human_gate_signoff: { approved_by: "maintainer", review_id: "PR-1" }
}));

// --- 1. Sano: F14 hereda F8/F10, todos pasan, y NO se le exige medicion propia
const healthy = phaseGate("F14", slice);
assert.equal(healthy.status, "ok", JSON.stringify(healthy));
assert.ok(healthy.quality, "F14 debe adjudicar calidad aunque no mida nada propio");
const healthyIds = healthy.quality.evaluated.map((entry) => entry.id);
assert.ok(healthyIds.includes("F8.changed-lines-coverage"));
assert.ok(healthyIds.includes("F10.dependency-violations"));
assert.ok(healthyIds.includes("F10.dependency-cycles"));
assert.ok(
  healthy.quality.evaluated.every((entry) => entry.status === "pass"),
  JSON.stringify(healthy.quality.evaluated)
);
assert.ok(
  !healthy.blockers.some((blocker) => blocker.includes("quality-metrics-absent")),
  "F14 sin quality_metrics propio es legitimo: sus gates son heredados, no propios"
);
assert.ok(!(healthy.evidence.smells ?? []).some((smell) => smell.code === "quality-metrics-absent"));

// --- Se promueve un baseline: sin el, un ratchet fallido en el absoluto es
// solo warning (se comporta como observe puro hasta la primera promocion,
// por diseño). Con baseline, F10 pasando de 0 a 5 violaciones es una
// REGRESION real, que ratchet SI bloquea.
writeEvidence(slice, "F15", baseEvidence("F15", slice, {
  quality_metrics: {
    measured_at: new Date(0).toISOString(),
    source: "ci",
    tree_hash: "hash-baseline",
    probes: [],
    metrics: {
      coverage: { changed_lines_pct: 95, changed_lines_total: 20 },
      dependencies: { violations: 0, cycles: 0, modules_scanned: 12 }
    }
  }
}));
const promoted = JSON.parse(run(["quality-baseline", "--target", target, "--promote", "--slice", slice, "--allow-local", "--json"]));
assert.equal(promoted.status, "ok", JSON.stringify(promoted));

// --- 2. F10 regresiono (5 violaciones): F14 bloquea el merge ----------------
writeEvidence(slice, "F10", baseEvidence("F10", slice, {
  quality_metrics: {
    measured_at: new Date(0).toISOString(),
    source: "ci",
    tree_hash: "hash-f10-bis",
    probes: [],
    metrics: { dependencies: { violations: 5, cycles: 0, modules_scanned: 12 } }
  }
}));
const regressed = phaseGate("F14", slice);
assert.equal(regressed.status, "blocked", JSON.stringify(regressed));
assert.ok(regressed.blockers.some((blocker) => blocker.includes("F10.dependency-violations")));
const depGate = regressed.quality.evaluated.find((entry) => entry.id === "F10.dependency-violations");
assert.equal(depGate.actual, 5);
assert.equal(depGate.status, "regression");
assert.equal(depGate.baseline, 0, "el baseline promovido, no la fase actual, es la comparacion");

// --- 3. F10 nunca corrio (evidencia ausente): F14 bloquea, no pasa por vacio
fs.rmSync(path.join(target, ".github", "agent-state", "evidence", slice, "F10.yaml"));
const skipped = phaseGate("F14", slice);
assert.equal(skipped.status, "blocked", JSON.stringify(skipped));
assert.ok(
  skipped.blockers.some((blocker) => blocker.includes("gate-not-measured") && blocker.includes("F10")),
  "fusionar sin que F10 haya corrido nunca no puede pasar en silencio"
);

// --- 4. EL ARBITRO tambien adjudica los gates heredados -------------------
// `phase-gate` y `status` los adjudicaban desde el principio (casos 1-3), pero
// el comando que corre `quality-verify.yml` en F14 es `quality-gate --run`, y
// ESE filtraba por fase y descartaba los heredados: devolvia `evaluated: []`
// y `status: ok`. La pieza entera era decorativa justo donde importa — un
// merge con la evidencia de F10 diciendo 42 violaciones pasaba en verde.
const AS_CI = { ...process.env, GITHUB_ACTIONS: "true", GITHUB_RUN_ID: "run-arbitro" };
const sliceArbitro = "slice-arbitro";
function evidenciaCi(phase, metrics) {
  return baseEvidence(phase, sliceArbitro, {
    quality_metrics: {
      measured_at: new Date(0).toISOString(),
      source: "ci",
      ci_provider: "github-actions",
      ci_run_id: "run-arbitro",
      tree_hash: "arbol-1",
      probes: [],
      metrics
    }
  });
}
// Baseline sano promovido desde F15: sin el, un gate ratchet sin linea base se
// comporta como observe puro y no habria regresion que detectar.
writeEvidence(sliceArbitro, "F15", evidenciaCi("F15", {
  coverage: { changed_lines_pct: 95, changed_lines_total: 50 },
  dependencies: { violations: 0, cycles: 0, modules_scanned: 30 }
}));
const promovido = JSON.parse(
  spawnSync("node", [cli, "quality-baseline", "--target", target, "--promote", "--slice", sliceArbitro, "--source", "ci", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: AS_CI
  }).stdout
);
assert.equal(promovido.status, "ok", JSON.stringify(promovido));

// Ahora el slice empeora de verdad: 0% de cobertura, 42 violaciones, 7 ciclos.
writeEvidence(sliceArbitro, "F8", evidenciaCi("F8", { coverage: { changed_lines_pct: 0, changed_lines_total: 50 } }));
writeEvidence(sliceArbitro, "F10", evidenciaCi("F10", { dependencies: { violations: 42, cycles: 7, modules_scanned: 30 } }));

const arbitro = JSON.parse(
  spawnSync(
    "node",
    [cli, "quality-gate", "--target", target, "--slice", sliceArbitro, "--phase", "F14", "--run", "--source", "ci", "--exit-code", "--json"],
    { cwd: repoRoot, encoding: "utf8", env: AS_CI }
  ).stdout
);
assert.ok(arbitro.evaluated.length > 0, "el arbitro NO puede devolver evaluated: [] en una fase que declara gates heredados");
assert.equal(arbitro.status, "blocked", JSON.stringify(arbitro.evaluated));
assert.ok(
  arbitro.evaluated.some((entry) => entry.id === "F10.dependency-violations" && entry.actual === 42),
  "el gate heredado se evalua contra la evidencia de F10, no contra las metricas de F14"
);
assert.ok(
  arbitro.inherited?.some((entry) => entry.phase === "F10"),
  "el payload declara de que fases hereda, para que 'adjudico' y 'no adjudico nada' no se vean igual"
);

// --- 5. HERENCIA OBSOLETA: la metrica heredada midio OTRO arbol ------------
// Los casos 1-4 cerraron "que los gates heredados se adjudiquen". Faltaba la
// otra mitad: que lo heredado se haya medido sobre EL ARBOL QUE SE VA A
// FUSIONAR. Sin este anclaje, F14 -- que existe justamente como guard
// anti-regresion antes del merge -- adjudicaba con la foto de un arbol
// anterior. Reproducido con PoC antes del fix: con F8/F10 medidos sobre un
// arbol limpio, se ensucia el arbol, la corrida fresca de F14 mide 7
// violaciones / 3 ciclos / 12% de cobertura, las escribe en F14.yaml, y los
// tres gates salen `pass` con los valores viejos: `status: ok`, exit 0. Los dos
// tree_hash ya estaban en disco, en los mismos archivos que el codigo lee.
const sliceStale = "slice-stale";
const surfacePaths = ["apps/api", "apps/web"];
const treeAntes = computeTreeHash(target, surfacePaths);

function evidenciaConArbol(phase, metrics, treeHash) {
  return baseEvidence(phase, sliceStale, {
    quality_metrics: {
      measured_at: new Date(0).toISOString(),
      source: "ci",
      ci_provider: "github-actions",
      ci_run_id: "run-stale",
      tree_hash: treeHash,
      probes: [],
      metrics
    }
  });
}
function arbitroSobre(slice) {
  return JSON.parse(
    spawnSync(
      "node",
      [cli, "quality-gate", "--target", target, "--slice", slice, "--phase", "F14", "--run", "--source", "ci", "--exit-code", "--json"],
      { cwd: repoRoot, encoding: "utf8", env: { ...AS_CI, GITHUB_RUN_ID: "run-stale" } }
    ).stdout
  );
}

// 5a. CONTROL: medido sobre el arbol actual y sin regresion -> el merge pasa.
// Sin este caso, el fix podria ser un muro (bloquear siempre) en vez de un
// control, y el test no notaria la diferencia.
writeEvidence(sliceStale, "F8", evidenciaConArbol("F8", { coverage: { changed_lines_pct: 95, changed_lines_total: 50 } }, treeAntes.hash));
writeEvidence(sliceStale, "F10", evidenciaConArbol("F10", { dependencies: { violations: 0, cycles: 0, modules_scanned: 30 } }, treeAntes.hash));
const fresco = arbitroSobre(sliceStale);
assert.equal(fresco.status, "ok", JSON.stringify(fresco.surfaceFindings ?? fresco));
assert.ok(
  fresco.inherited?.every((entry) => entry.treeMatches === true),
  "medido sobre el arbol actual, la herencia es valida y el merge debe poder avanzar"
);

// 5b. Se ensucia el arbol DESPUES de que F8/F10 quedaron medidos. Las metricas
// heredadas siguen diciendo que todo esta bien, porque miraron otra cosa.
fs.writeFileSync(path.join(target, "apps", "api", "backdoor.ts"), "export const backdoor = 1;\n", "utf8");
const treeDespues = computeTreeHash(target, surfacePaths);
assert.notEqual(treeDespues.hash, treeAntes.hash, "el arbol tiene que haber cambiado de verdad para que el caso pruebe algo");

const obsoleto = arbitroSobre(sliceStale);
assert.equal(obsoleto.status, "blocked", JSON.stringify(obsoleto.evaluated));
const stale = (obsoleto.surfaceFindings ?? []).filter((finding) => finding.code === "inherited-evidence-stale");
assert.equal(stale.length, 2, "las dos fases de origen (F8 y F10) midieron un arbol que ya no es el que se fusiona");
assert.ok(
  stale.every((finding) => finding.actual === treeAntes.hash && finding.expected === treeDespues.hash),
  "el hallazgo debe nombrar los dos hashes, no solo decir que algo no cuadra"
);
assert.ok(
  obsoleto.inherited?.every((entry) => entry.treeMatches === false),
  "el payload debe dejar ver que la herencia no corresponde al arbol actual"
);
// Los gates en si siguen 'pass' con los valores viejos: por eso el bloqueo NO
// puede depender de que alguna metrica falle. Es la frescura lo que falta.
assert.ok(
  obsoleto.evaluated.every((entry) => entry.status === "pass"),
  "el bypass consistia justo en esto: las metricas heredadas pasan, y sin anclaje eso bastaba para fusionar"
);

console.log("phase-inheritance: PASS");
console.log("phase-inheritance herencia obsoleta: PASS");

// --- 6. EL ANCLA TIENE QUE VER TODO EL ARBOL --------------------------------
// `computeTreeHash` es lo que ancla la frescura de la evidencia heredada (caso
// 5) y tambien el sujeto de la firma humana. Excluia cualquier entrada que
// empezara por punto, y eso lo hacia CIEGO a `.env`, `.eslintrc` o un
// `.config/` entero dentro de una superficie declarada: se podia cambiar
// configuracion versionada sin invalidar ni el veredicto ni la firma.
//
// El criterio viejo fallaba en las dos direcciones: excluia dotfiles
// versionados e INCLUIA `dist/`, que no empieza por punto. Ahora se pregunta a
// git que esta ignorado, que es la pregunta correcta.
{
  const anchorTarget = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-tree-anchor-"));
  execFileSync("git", ["init", "--quiet"], { cwd: anchorTarget });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: anchorTarget });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: anchorTarget });
  fs.writeFileSync(path.join(anchorTarget, ".gitignore"), "node_modules/\n.turbo/\ndist/\n", "utf8");
  fs.mkdirSync(path.join(anchorTarget, "apps", "api"), { recursive: true });
  fs.writeFileSync(path.join(anchorTarget, "apps", "api", "index.ts"), "export const api = 1;\n", "utf8");
  execFileSync("git", ["add", "-A"], { cwd: anchorTarget });
  execFileSync("git", ["commit", "--quiet", "-m", "base"], { cwd: anchorTarget });

  const soloFuente = computeTreeHash(anchorTarget, ["apps/api"]);

  // Un dotfile versionado DEBE mover el ancla.
  fs.writeFileSync(path.join(anchorTarget, "apps", "api", ".env"), "SECRET=cambiado\n", "utf8");
  const conDotfile = computeTreeHash(anchorTarget, ["apps/api"]);
  assert.notEqual(
    conDotfile.hash,
    soloFuente.hash,
    "un .env dentro de una superficie es parte del arbol: si no mueve el hash, se puede cambiar sin invalidar la firma"
  );
  assert.equal(conDotfile.files, soloFuente.files + 1);

  // Lo que git ignora NO puede moverla: un cache de build cambia en cada
  // corrida y haria ver la evidencia obsoleta sin que nadie tocara el codigo.
  fs.mkdirSync(path.join(anchorTarget, "apps", "api", ".turbo"), { recursive: true });
  fs.writeFileSync(path.join(anchorTarget, "apps", "api", ".turbo", "cache.bin"), "basura", "utf8");
  fs.mkdirSync(path.join(anchorTarget, "apps", "api", "dist"), { recursive: true });
  fs.writeFileSync(path.join(anchorTarget, "apps", "api", "dist", "out.js"), "build", "utf8");
  const conBasura = computeTreeHash(anchorTarget, ["apps/api"]);
  assert.equal(
    conBasura.hash,
    conDotfile.hash,
    "cachés y build output estan ignorados por git: incluirlos produciria un falso 'obsoleto' en cada corrida"
  );

  // `dist/` es el caso que prueba que el criterio no es "empieza por punto":
  // no lleva punto y aun asi queda fuera, porque git lo ignora.
  assert.equal(conBasura.files, conDotfile.files);
}

console.log("phase-inheritance ancla de arbol: PASS");
