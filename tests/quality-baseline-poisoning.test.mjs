// ---------------------------------------------------------------------------
// P8 (ADR 0007): "baseline no envenenable" -- `--source ci` en los argumentos
// de `sdlc quality-baseline --promote` era una AFIRMACION de quien invocaba
// el comando, nunca verificada contra la evidencia real. Cualquiera podia
// correr `--source ci` localmente contra evidencia que el harness local
// escribio (nunca recomputada por el arbitro) y el baseline quedaba marcado
// `promoted_by: ci` -- autoritativo -- sin que nada lo haya comprobado.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "sdlc.js");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-baseline-poison-"));
const target = path.join(tempRoot, "consumidor");

// `--source ci` solo cuenta si el proceso corre de verdad en un runner
// (ADR 0007, P8): el test que ejercita el camino autoritativo tiene que
// SIMULAR el runner en vez de confiar en el flag.
function run(args, extraEnv = {}) {
  return spawnSync("node", [cli, ...args], { cwd: repoRoot, encoding: "utf8", env: { ...process.env, ...extraEnv } });
}
const AS_CI = { GITHUB_ACTIONS: "true", GITHUB_RUN_ID: "test-run-1" };

// Un test cuyo resultado depende de DONDE corre no es un control.
//
// Los casos "fabricado en local" heredaban el entorno del proceso, y este
// mismo suite corre dentro de GitHub Actions: ahi el ambiente ES un runner, el
// `--source ci` resulta legitimo y la promocion sale con exit 0. El test pasaba
// en la maquina del autor y fallaba en CI — y el que estaba equivocado era el
// test, no el codigo: en un runner real, una promocion de CI SI es autoritativa.
//
// El entorno local se fuerza, no se asume. `detectCiEnvironment` mira
// `GITHUB_ACTIONS` y `CI`; se borran ambas para que "local" signifique local en
// cualquier maquina.
const CI_MARKERS = ["GITHUB_ACTIONS", "GITHUB_RUN_ID", "CI"];
function runLocal(args) {
  const env = { ...process.env };
  for (const marker of CI_MARKERS) delete env[marker];
  return spawnSync("node", [cli, ...args], { cwd: repoRoot, encoding: "utf8", env });
}
// `ciTrace` simula lo que SOLO deja una corrida real dentro de un runner.
// Omitirlo reproduce la evidencia escrita a mano que se autoproclama de CI.
function writeF15Evidence(evidenceSource, metrics, { ciTrace = true } = {}) {
  const dir = path.join(target, ".github", "agent-state", "evidence", "slice-a");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "F15.yaml"),
    YAML.stringify({
      phase: "F15",
      slice: "slice-a",
      agent_id: "test",
      started_at: new Date(0).toISOString(),
      outputs: [],
      validators_run: [],
      quality_metrics: {
        measured_at: new Date(0).toISOString(),
        source: evidenceSource,
        ci_provider: evidenceSource === "ci" && ciTrace ? "github-actions" : null,
        ci_run_id: evidenceSource === "ci" && ciTrace ? "test-run-1" : null,
        tree_hash: "hash-1",
        probes: [],
        metrics
      }
    }),
    "utf8"
  );
}

execFileSync("node", [cli, "install", "--target", target, "--mode", "greenfield", "--project-name", "Demo", "--json"], {
  cwd: repoRoot,
  encoding: "utf8"
});

// --- 1. --source ci contra evidencia de harness (nunca recomputada): rechazo
writeF15Evidence("harness", { coverage: { changed_lines_pct: 95, changed_lines_total: 20 } });
const poisoned = runLocal(["quality-baseline", "--target", target, "--promote", "--slice", "slice-a", "--source", "ci", "--json"]);
assert.notEqual(poisoned.status, 0);
const poisonedPayload = JSON.parse(poisoned.stdout);
assert.equal(poisonedPayload.code, "baseline-source-not-ci");
assert.ok(!fs.existsSync(path.join(target, ".github", "agent-state", "quality-baseline.yaml")), "el baseline no debe escribirse");

// --- 1b. EL ATAQUE CONSISTENTE (gap P8 encontrado por auditoria adversarial)
// El caso 1 solo cierra al atacante ingenuo: evidencia `harness` + promocion
// mintiendo. Un atacante consistente escribe la evidencia declarando `ci`
// (nada se lo impedia) y DESPUES promueve con `--source ci`, produciendo una
// cadena internamente coherente y del todo falsa, sin pisar un runner jamas.
// Ahora el entorno tambien tiene que confirmarlo.
writeF15Evidence("ci", { coverage: { changed_lines_pct: 100, changed_lines_total: 20 } });
const consistentLie = runLocal(["quality-baseline", "--target", target, "--promote", "--slice", "slice-a", "--source", "ci", "--json"]);
assert.notEqual(consistentLie.status, 0, "una cadena ci-ci fabricada en local no puede producir un baseline autoritativo");
assert.equal(JSON.parse(consistentLie.stdout).code, "baseline-source-ci-unverified");
assert.ok(!fs.existsSync(path.join(target, ".github", "agent-state", "quality-baseline.yaml")));

// --- 1c. Evidencia que se autoproclama de CI sin rastro de runner ----------
// El agente edita `source: harness` -> `ci` en su propia evidencia (ruta NO
// protegida por el guard de frontera) y despues promueve desde un runner real.
// Sin exigir el rastro, esa palabra bastaba. Una corrida real SIEMPRE deja
// provider y run id; una evidencia sin ellos se escribio a mano.
writeF15Evidence("ci", { coverage: { changed_lines_pct: 100, changed_lines_total: 20 } }, { ciTrace: false });
const sinRastro = run(["quality-baseline", "--target", target, "--promote", "--slice", "slice-a", "--source", "ci", "--json"], AS_CI);
assert.notEqual(sinRastro.status, 0, "una evidencia que dice ci sin ci_run_id no puede promover el baseline");
assert.equal(JSON.parse(sinRastro.stdout).code, "baseline-evidence-without-ci-trace");
assert.ok(!fs.existsSync(path.join(target, ".github", "agent-state", "quality-baseline.yaml")));

// --- 2. --source ci REAL (dentro de un runner) contra evidencia ci: se acepta
writeF15Evidence("ci", { coverage: { changed_lines_pct: 95, changed_lines_total: 20 } });
const legit = run(["quality-baseline", "--target", target, "--promote", "--slice", "slice-a", "--source", "ci", "--json"], AS_CI);
assert.equal(legit.status, 0, legit.stdout);
const legitPayload = JSON.parse(legit.stdout);
assert.equal(legitPayload.status, "ok");
const promotedDoc = YAML.parse(fs.readFileSync(path.join(target, ".github", "agent-state", "quality-baseline.yaml"), "utf8"));
assert.equal(promotedDoc.promoted_by, "ci");
// El provider y el run id quedan en el baseline: "esto vino de CI" pasa de
// afirmacion a dato auditable.
assert.equal(promotedDoc.ci_provider, "github-actions");
assert.equal(promotedDoc.ci_run_id, "test-run-1");

// --- 3. --allow-local sigue sin esta exigencia: es advisory, nunca autoritativa
fs.rmSync(path.join(target, ".github", "agent-state", "quality-baseline.yaml"));
writeF15Evidence("harness", { coverage: { changed_lines_pct: 80, changed_lines_total: 20 } });
const local = run(["quality-baseline", "--target", target, "--promote", "--slice", "slice-a", "--allow-local", "--json"]);
assert.equal(local.status, 0, local.stdout);
const localDoc = YAML.parse(fs.readFileSync(path.join(target, ".github", "agent-state", "quality-baseline.yaml"), "utf8"));
assert.match(localDoc.promoted_by, /^local:/);

console.log("quality-baseline-poisoning: PASS");
