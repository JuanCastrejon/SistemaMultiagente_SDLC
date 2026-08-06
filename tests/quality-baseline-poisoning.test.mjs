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

function run(args) {
  return spawnSync("node", [cli, ...args], { cwd: repoRoot, encoding: "utf8" });
}
function writeF15Evidence(evidenceSource, metrics) {
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
const poisoned = run(["quality-baseline", "--target", target, "--promote", "--slice", "slice-a", "--source", "ci", "--json"]);
assert.notEqual(poisoned.status, 0);
const poisonedPayload = JSON.parse(poisoned.stdout);
assert.equal(poisonedPayload.code, "baseline-source-not-ci");
assert.ok(!fs.existsSync(path.join(target, ".github", "agent-state", "quality-baseline.yaml")), "el baseline no debe escribirse");

// --- 2. --source ci contra evidencia que SI declara source: ci: se acepta --
writeF15Evidence("ci", { coverage: { changed_lines_pct: 95, changed_lines_total: 20 } });
const legit = run(["quality-baseline", "--target", target, "--promote", "--slice", "slice-a", "--source", "ci", "--json"]);
assert.equal(legit.status, 0, legit.stdout);
const legitPayload = JSON.parse(legit.stdout);
assert.equal(legitPayload.status, "ok");
const promotedDoc = YAML.parse(fs.readFileSync(path.join(target, ".github", "agent-state", "quality-baseline.yaml"), "utf8"));
assert.equal(promotedDoc.promoted_by, "ci");

// --- 3. --allow-local sigue sin esta exigencia: es advisory, nunca autoritativa
fs.rmSync(path.join(target, ".github", "agent-state", "quality-baseline.yaml"));
writeF15Evidence("harness", { coverage: { changed_lines_pct: 80, changed_lines_total: 20 } });
const local = run(["quality-baseline", "--target", target, "--promote", "--slice", "slice-a", "--allow-local", "--json"]);
assert.equal(local.status, 0, local.stdout);
const localDoc = YAML.parse(fs.readFileSync(path.join(target, ".github", "agent-state", "quality-baseline.yaml"), "utf8"));
assert.match(localDoc.promoted_by, /^local:/);

console.log("quality-baseline-poisoning: PASS");
