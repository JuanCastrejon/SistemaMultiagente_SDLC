// ---------------------------------------------------------------------------
// P14 (ADR 0007, decision 7 del cierre): "evidencia permanente append-only;
// reportes efimeros por path y sha256". Un .gitignore generico que excluya
// .github/agent-state/evidence/ por accidente borra el rastro de auditoria
// en silencio en el proximo commit; reportes nativos sin ignorar son el
// desperdicio que la decision 7 dice evitar.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isPathIgnored, checkRetentionPolicy } from "../src/retention.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "sdlc.js");

// --- unidad: isPathIgnored ---------------------------------------------
assert.equal(isPathIgnored("coverage/\n", "coverage/coverage-summary.json"), true);
assert.equal(isPathIgnored("coverage/", "coverage"), true);
assert.equal(isPathIgnored("*.log", "debug.log"), true);
assert.equal(isPathIgnored("*.log", ".github/agent-state/evidence"), false);
assert.equal(isPathIgnored(".github/", ".github/agent-state/evidence"), true, "un .gitignore demasiado amplio SI cuenta como ignorado");
assert.equal(isPathIgnored("", ".github/agent-state/evidence"), false);
assert.equal(isPathIgnored("coverage/\n!coverage/keep.txt", "coverage/keep.txt"), false, "negacion respetada");

console.log("retention isPathIgnored unit: PASS");

// --- E2E: checkRetentionPolicy sobre un install real ------------------------
const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-retention-")), "consumidor");
fs.mkdirSync(target, { recursive: true });
execFileSync("node", [cli, "install", "--target", target, "--mode", "greenfield", "--project-name", "Demo", "--json"], {
  cwd: repoRoot,
  encoding: "utf8"
});

// 1. Sin .gitignore: los reportes efimeros (coverage/) declarados en
// quality-contract.yaml no estan ignorados. Aviso, no error.
const noGitignore = checkRetentionPolicy(target);
assert.ok(noGitignore.some((f) => f.code === "retention-ephemeral-path-not-ignored" && f.path === "coverage"));
assert.ok(!noGitignore.some((f) => f.level === "error"));

// 2. .gitignore correcto: coverage/ ignorado, evidencia NO ignorada.
fs.writeFileSync(path.join(target, ".gitignore"), "node_modules/\ncoverage/\nreports/\n", "utf8");
const correct = checkRetentionPolicy(target);
assert.ok(!correct.some((f) => f.code === "retention-ephemeral-path-not-ignored"));
assert.ok(!correct.some((f) => f.code === "retention-permanent-path-ignored"));

// 3. .gitignore hostil: una regla amplia se traga la evidencia permanente.
// Este es el accidente real que la decision 7 no puede permitir en silencio.
fs.writeFileSync(path.join(target, ".gitignore"), "node_modules/\n.github/\n", "utf8");
const hostile = checkRetentionPolicy(target);
const evidenceFinding = hostile.find((f) => f.code === "retention-permanent-path-ignored" && f.path.includes("evidence"));
assert.ok(evidenceFinding, JSON.stringify(hostile));
assert.equal(evidenceFinding.level, "error");

console.log("retention checkRetentionPolicy unit: PASS");

// --- CLI: sdlc doctor surface los hallazgos de retencion --------------------
// doctor sale != 0 cuando hay errores: spawnSync, no execFileSync.
const doctorRun = spawnSync("node", [cli, "doctor", "--target", target, "--json"], { cwd: repoRoot, encoding: "utf8" });
const doctorOut = JSON.parse(doctorRun.stdout);
assert.ok(doctorOut.findings.some((f) => f.code === "retention-permanent-path-ignored"));

console.log("retention cli e2e: PASS");
