import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "sdlc.js");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-regression-"));

function run(args, options = {}) {
  return execFileSync("node", [cli, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  });
}

function runStatus(args) {
  return spawnSync("node", [cli, ...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });
}

function makeRepo(name) {
  const target = path.join(tempRoot, name);
  fs.mkdirSync(target, { recursive: true });
  return target;
}

const greenfield = makeRepo("task-manager-saas");
fs.copyFileSync(path.join(repoRoot, "examples", "task-manager-saas", "README.md"), path.join(greenfield, "README.md"));
run(["install", "--target", greenfield, "--mode", "greenfield", "--project-name", "Task Manager SaaS", "--json"]);
run(["doctor", "--target", greenfield, "--json"]);
run(["diff", "--target", greenfield, "--json"]);

const legacy = makeRepo("legacy-inventory-modernization");
fs.copyFileSync(path.join(repoRoot, "examples", "legacy-inventory-modernization", "README.md"), path.join(legacy, "README.md"));
run(["install", "--target", legacy, "--mode", "legacy", "--project-name", "Legacy Inventory Modernization", "--json"]);
run(["doctor", "--target", legacy, "--json"]);

const upgradeOutput = JSON.parse(run(["upgrade", "--target", legacy, "--to-version", "1.0.1", "--json"]));
assert.equal(upgradeOutput.status, "ok");
assert.ok(upgradeOutput.backup);
assert.ok(fs.existsSync(path.join(legacy, ".sdlc", "migrations", "1.0.1-applied.txt")));
run(["rollback", "--target", legacy, "--to", upgradeOutput.backup, "--json"]);
assert.ok(!fs.existsSync(path.join(legacy, ".sdlc", "migrations", "1.0.1-applied.txt")));

const conflict = makeRepo("existing-governance");
fs.mkdirSync(path.join(conflict, ".github"), { recursive: true });
fs.writeFileSync(path.join(conflict, ".github", "AGENTS.md"), "# Existing governance\n", "utf8");
const conflictResult = runStatus(["install", "--target", conflict, "--mode", "greenfield", "--json"]);
assert.equal(conflictResult.status, 2);
assert.ok(fs.existsSync(path.join(conflict, ".sdlc", "patch-plan.json")));

run(["prune-backups", "--target", legacy, "--keep", "1", "--json"]);

console.log("Regression suite: PASS");
