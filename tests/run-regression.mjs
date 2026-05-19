import assert from "node:assert/strict";
import crypto from "node:crypto";
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

function sha256Text(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function simulateInstalledFrameworkVersion(target, version) {
  const configPath = path.join(target, ".sdlc", "config.json");
  const manifestPath = path.join(target, ".sdlc", "install-manifest.json");
  const checksumPath = path.join(target, ".sdlc", "install-manifest.sha256");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  config.frameworkVersion = version;
  if (version !== "1.2.0") {
    delete config.scale;
  }
  const configText = `${JSON.stringify(config, null, 2)}\n`;
  fs.writeFileSync(configPath, configText, "utf8");

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.frameworkVersion = version;
  const configEntry = manifest.managedFiles.find((entry) => entry.path === ".sdlc/config.json");
  assert.ok(configEntry, "historical fixture must include managed .sdlc/config.json");
  configEntry.sha256 = sha256Text(configText);
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(manifestPath, manifestText, "utf8");
  fs.writeFileSync(checksumPath, `${sha256Text(manifestText)}\n`, "utf8");
}

const greenfield = makeRepo("task-manager-saas");
fs.copyFileSync(path.join(repoRoot, "examples", "task-manager-saas", "README.md"), path.join(greenfield, "README.md"));
run(["install", "--target", greenfield, "--mode", "greenfield", "--project-name", "Task Manager SaaS", "--json"]);
const greenfieldConfig = JSON.parse(fs.readFileSync(path.join(greenfield, ".sdlc", "config.json"), "utf8"));
assert.equal(greenfieldConfig.frameworkVersion, "1.2.0");
assert.equal(greenfieldConfig.scale, "feature");
run(["doctor", "--target", greenfield, "--json"]);
run(["diff", "--target", greenfield, "--json"]);

const legacy100 = makeRepo("legacy-upgrade-1-0-0");
fs.copyFileSync(path.join(repoRoot, "examples", "legacy-inventory-modernization", "README.md"), path.join(legacy100, "README.md"));
run(["install", "--target", legacy100, "--mode", "legacy", "--project-name", "Legacy Inventory Modernization", "--json"]);
simulateInstalledFrameworkVersion(legacy100, "1.0.0");

const upgrade100Output = JSON.parse(run(["upgrade", "--target", legacy100, "--to-version", "1.2.0", "--json"]));
assert.equal(upgrade100Output.status, "ok");
assert.ok(upgrade100Output.backup);
assert.ok(fs.existsSync(path.join(legacy100, ".sdlc", "migrations", "1.0.1-applied.txt")));
assert.ok(fs.existsSync(path.join(legacy100, ".sdlc", "migrations", "1.1.0-applied.txt")));
assert.ok(fs.existsSync(path.join(legacy100, ".sdlc", "migrations", "1.2.0-applied.txt")));
const upgraded100Config = JSON.parse(fs.readFileSync(path.join(legacy100, ".sdlc", "config.json"), "utf8"));
assert.equal(upgraded100Config.frameworkVersion, "1.2.0");
assert.equal(upgraded100Config.scale, "feature");
run(["diff", "--target", legacy100, "--json"]);
run(["rollback", "--target", legacy100, "--to", upgrade100Output.backup, "--json"]);
assert.ok(!fs.existsSync(path.join(legacy100, ".sdlc", "migrations", "1.0.1-applied.txt")));
assert.ok(!fs.existsSync(path.join(legacy100, ".sdlc", "migrations", "1.1.0-applied.txt")));
assert.ok(!fs.existsSync(path.join(legacy100, ".sdlc", "migrations", "1.2.0-applied.txt")));

const legacy110 = makeRepo("legacy-upgrade-1-1-0");
fs.copyFileSync(path.join(repoRoot, "examples", "legacy-inventory-modernization", "README.md"), path.join(legacy110, "README.md"));
run(["install", "--target", legacy110, "--mode", "legacy", "--project-name", "Legacy Inventory Modernization", "--json"]);
simulateInstalledFrameworkVersion(legacy110, "1.1.0");

const upgrade110Output = JSON.parse(run(["upgrade", "--target", legacy110, "--to-version", "1.2.0", "--json"]));
assert.equal(upgrade110Output.status, "ok");
assert.ok(upgrade110Output.backup);
assert.ok(!fs.existsSync(path.join(legacy110, ".sdlc", "migrations", "1.0.1-applied.txt")));
assert.ok(!fs.existsSync(path.join(legacy110, ".sdlc", "migrations", "1.1.0-applied.txt")));
assert.ok(fs.existsSync(path.join(legacy110, ".sdlc", "migrations", "1.2.0-applied.txt")));
const upgraded110Config = JSON.parse(fs.readFileSync(path.join(legacy110, ".sdlc", "config.json"), "utf8"));
assert.equal(upgraded110Config.frameworkVersion, "1.2.0");
assert.equal(upgraded110Config.scale, "feature");
run(["diff", "--target", legacy110, "--json"]);

const conflict = makeRepo("existing-governance");
fs.mkdirSync(path.join(conflict, ".github"), { recursive: true });
fs.writeFileSync(path.join(conflict, ".github", "AGENTS.md"), "# Existing governance\n", "utf8");
const conflictResult = runStatus(["install", "--target", conflict, "--mode", "greenfield", "--json"]);
assert.equal(conflictResult.status, 2);
assert.ok(fs.existsSync(path.join(conflict, ".sdlc", "patch-plan.json")));

run(["prune-backups", "--target", legacy100, "--keep", "1", "--json"]);

console.log("Regression suite: PASS");
