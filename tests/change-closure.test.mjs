// ---------------------------------------------------------------------------
// P11 (ADR 0007): cierre de change por HECHOS, no por checkbox. Evidencia
// real del repo padre: un change se archivo con 8 tareas sin marcar,
// incluida literalmente "T6.3 — Merge a develop" que ya habia ocurrido; y
// firmas humanas (qa-security-review) marcadas [x] ocho dias despues del
// merge. El ledger (checkbox) y la realidad (git, evidencia) divergieron y
// nada lo detecto.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { parseTasksFile, verifyChangeClosure } from "../src/change-closure.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "sdlc.js");

function run(args) {
  return spawnSync("node", [cli, ...args], { cwd: repoRoot, encoding: "utf8" });
}

// --- unidad: parseTasksFile --------------------------------------------------
const tasksRaw = [
  "## Tareas",
  "- [x] T1 implementar endpoint",
  "- [ ] T2 agregar tests",
  "- [X] T3 — Merge a develop"
].join("\n");
const parsedTasks = parseTasksFile(tasksRaw);
assert.equal(parsedTasks.length, 3);
assert.equal(parsedTasks[1].checked, false);
assert.equal(parsedTasks[2].title, "T3 — Merge a develop");
assert.equal(parsedTasks[2].checked, true, "[X] mayuscula tambien cuenta como marcada");

// --- E2E con git real: el caso exacto del repo padre ------------------------
const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-change-closure-")), "consumidor");
fs.mkdirSync(target, { recursive: true });
function git(args) {
  return execFileSync("git", args, { cwd: target, encoding: "utf8" });
}
git(["init", "--quiet"]);
git(["config", "user.email", "test@example.com"]);
git(["config", "user.name", "Test"]);
fs.writeFileSync(path.join(target, "README.md"), "# demo\n", "utf8");
git(["add", "."]);
git(["commit", "--quiet", "-m", "base"]);
git(["branch", "-M", "develop"]);
git(["checkout", "--quiet", "-b", "feature/pagos"]);
fs.writeFileSync(path.join(target, "feature.txt"), "x\n", "utf8");
git(["add", "."]);
git(["commit", "--quiet", "-m", "feature"]);

// Estos casos aislan el chequeo de tareas/merge: sin fases con gate humano
// declaradas no hay nada que cruzar. El CLI nunca vacia esta lista (default
// F13/F14), asi que no es una via de escape para un consumidor real.
const soloTareas = { humanGatePhases: [] };

// 1. El merge NUNCA paso: la tarea se marco [x] de todas formas. Debe
// bloquear, exactamente el caso real.
const notMergedYet = verifyChangeClosure({
  target,
  raw: "- [x] T1 — Merge a develop",
  integrationBranch: "develop",
  ...soloTareas
});
assert.equal(notMergedYet.ok, false);
assert.ok(notMergedYet.findings.some((f) => f.code === "merge-task-not-true"));

// 2. Ahora el merge SI pasa de verdad.
git(["checkout", "--quiet", "develop"]);
git(["merge", "--quiet", "--no-ff", "-m", "merge", "feature/pagos"]);
git(["checkout", "--quiet", "feature/pagos"]);
const merged = verifyChangeClosure({ target, raw: "- [x] T1 — Merge a develop", integrationBranch: "develop", ...soloTareas });
assert.equal(merged.ok, true, JSON.stringify(merged.findings));

// 3. Sin rama de integracion resoluble, una tarea de merge marcada [x] es una
// afirmacion sin verificar y BLOQUEA. Antes era warning: apuntar
// gitFlow.integrationBranch —dato que escribe el evaluado— a un nombre
// inexistente degradaba el error a aviso y devolvia exit 0.
const noBranch = verifyChangeClosure({ target, raw: "- [x] T1 — Merge a develop", ...soloTareas });
assert.equal(noBranch.ok, false);
assert.ok(noBranch.findings.some((f) => f.code === "merge-task-unverifiable" && f.level === "error"));

// 4. Una tarea sin marcar bloquea siempre, sin importar de que se trate.
const unchecked = verifyChangeClosure({ target, raw: "- [ ] T2 agregar tests", ...soloTareas });
assert.equal(unchecked.ok, false);
assert.equal(unchecked.findings[0].code, "task-unchecked");

// 5. NO-VACUIDAD: un tasks.md sin una sola tarea reconocible no cierra nada.
// Borrar el archivo se detectaba; VACIARLO no. Cero pendientes sobre cero
// tareas no es un change terminado.
for (const vacio of ["", "# Tareas\n\nprosa sin checkboxes\n"]) {
  const r = verifyChangeClosure({ target, raw: vacio, integrationBranch: "develop", ...soloTareas });
  assert.equal(r.ok, false, `un tasks.md vacuo no puede cerrar el change: ${JSON.stringify(vacio)}`);
  assert.ok(r.findings.some((f) => f.code === "tasks-file-vacuous"));
}

// 6. Marcas que antes eran INVISIBLES. El patron original solo veia `[ ]`/`[x]`
// con bullet `-`/`*`, asi que `[-]`, `[~]`, `[/]`, listas numeradas y bullets
// `+` no contaban como tareas — incluida la del caso real que motivo la pieza.
const marcasRaras = "- [-] T1 en curso\n+ [~] T2 pausada\n1. [/] T3 parcial\n2) [ ] T4 pendiente\n";
assert.equal(parseTasksFile(marcasRaras).length, 4, "las cuatro formas tienen que verse");
const conMarcas = verifyChangeClosure({ target, raw: marcasRaras, integrationBranch: "develop", ...soloTareas });
assert.equal(conMarcas.ok, false);
assert.equal(conMarcas.findings.filter((f) => f.code === "task-unchecked").length, 4, "ninguna de las cuatro esta hecha");

// 7. `origin/<rama>` es FORJABLE sin red: `git update-ref` la reescribe. El
// codigo antes la PREFERIA sobre la rama local, asi que la forma mas facil de
// mentir ganaba. Ahora el merge debe ser cierto contra todas las refs
// resolubles.
git(["checkout", "--quiet", "-b", "feature/forjado"]);
fs.writeFileSync(path.join(target, "otro.txt"), "z\n", "utf8");
git(["add", "-A"]);
git(["commit", "--quiet", "-m", "trabajo sin mergear"]);
git(["update-ref", "refs/remotes/origin/develop", "HEAD"]); // la forja
const forjado = verifyChangeClosure({ target, raw: "- [x] T1 — Merge a develop", integrationBranch: "develop", ...soloTareas });
assert.equal(forjado.ok, false, "forjar origin no puede hacer cierto un merge que no ocurrio");
assert.ok(forjado.findings.some((f) => f.code === "merge-task-not-true"));
git(["checkout", "--quiet", "feature/pagos"]);

// 8. El cruce del gate humano NO es opt-in: omitir --slice lo saltaba entero.
const sinSlice = verifyChangeClosure({ target, raw: "- [x] T1 implementar", integrationBranch: "develop" });
assert.equal(sinSlice.ok, false);
assert.ok(sinSlice.findings.some((f) => f.code === "human-gate-not-verified"));

console.log("change-closure unit: PASS");

// --- E2E CLI: sdlc change-close, incluida la firma humana retroactiva ------
run(["install", "--target", target, "--mode", "greenfield", "--project-name", "Demo", "--json"]);
const changeSlug = "cambio-pagos";
const changeDir = path.join(target, "openspec", "changes", changeSlug);
fs.mkdirSync(changeDir, { recursive: true });
fs.writeFileSync(path.join(changeDir, "tasks.md"), "- [x] T1 implementar\n- [x] T2 — Merge a develop\n", "utf8");

function writeEvidence(slice, phase, body) {
  const dir = path.join(target, ".github", "agent-state", "evidence", slice);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${phase}.yaml`), YAML.stringify(body), "utf8");
}
function baseEvidence(phase, slice, extra = {}) {
  return { phase, slice, agent_id: "test", started_at: new Date(0).toISOString(), outputs: [], validators_run: [], ...extra };
}

const slice = "slice-cierre";

// F13 exige el cuerpo del PR como input, ademas de su propia evidencia.
fs.mkdirSync(path.join(target, ".github", "pr-bodies"), { recursive: true });
fs.writeFileSync(path.join(target, ".github", "pr-bodies", `${slice}.md`), "# PR\n", "utf8");

// Sin firma humana en F13/F14: change-close debe bloquear aunque tasks.md
// diga que todo esta hecho y el merge sea real.
writeEvidence(slice, "F13", baseEvidence("F13", slice));
writeEvidence(slice, "F14", baseEvidence("F14", slice));
const withoutSignoff = JSON.parse(
  run(["change-close", "--target", target, "--change", changeSlug, "--slice", slice, "--integration-branch", "develop", "--json"]).stdout
);
assert.equal(withoutSignoff.status, "blocked", JSON.stringify(withoutSignoff));
assert.ok(withoutSignoff.findings.some((f) => f.code === "human-gate-phase-not-ready" && f.phase === "F13"));
assert.ok(withoutSignoff.findings.some((f) => f.code === "human-gate-phase-not-ready" && f.phase === "F14"));

// Con firma verificable en ambas Y los gates heredados de F14 (P7) pasando:
// F13/F14 quedan en ok. El merge ya es real (paso en el bloque de unidad,
// arriba, sobre el mismo repo). Cierra limpio.
fs.mkdirSync(path.join(target, "apps", "api"), { recursive: true });
fs.writeFileSync(path.join(target, "apps", "api", "index.ts"), "export const api = 1;\n", "utf8");
fs.mkdirSync(path.join(target, "apps", "web"), { recursive: true });
fs.writeFileSync(path.join(target, "apps", "web", "index.ts"), "export const web = 1;\n", "utf8");
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
writeEvidence(slice, "F13", baseEvidence("F13", slice, { human_gate_signoff: { approved_by: "maintainer", review_id: "PR-1" } }));
writeEvidence(slice, "F14", baseEvidence("F14", slice, { human_gate_signoff: { approved_by: "maintainer", review_id: "PR-1" } }));
const withSignoff = JSON.parse(
  run(["change-close", "--target", target, "--change", changeSlug, "--slice", slice, "--integration-branch", "develop", "--json"]).stdout
);
assert.equal(withSignoff.status, "ok", JSON.stringify(withSignoff));

console.log("change-closure cli e2e: PASS");
