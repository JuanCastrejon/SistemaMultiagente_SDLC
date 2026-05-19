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

function findPowerShell() {
  const candidates = process.platform === "win32" ? ["pwsh", "powershell"] : ["pwsh"];
  for (const command of candidates) {
    const probe = spawnSync(command, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    if (probe.status === 0) {
      return command;
    }
  }
  throw new Error("PowerShell runtime not found. v1.2.0 requires pwsh/powershell for script regression tests.");
}

function runPowerShellScript(scriptPath, args = [], cwd = repoRoot) {
  const command = findPowerShell();
  const prefix = process.platform === "win32" ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"] : ["-NoProfile", "-File"];
  return execFileSync(command, [...prefix, scriptPath, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
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

function readGolden(name) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, "tests", "golden", name), "utf8"));
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

const continuaOutput = JSON.parse(runPowerShellScript(path.join(greenfield, "scripts", "continua.ps1"), ["-NoLock", "-Json"], greenfield));
assert.deepEqual(
  {
    status: continuaOutput.status,
    project: continuaOutput.project,
    platform: continuaOutput.platform,
    lock_written: continuaOutput.lock_written
  },
  readGolden("continua-output.json")
);

const publishTraceOutput = JSON.parse(runPowerShellScript(path.join(greenfield, "scripts", "publish-trace.ps1"), ["-DryRun", "-Json"], greenfield));
assert.deepEqual(
  {
    status: publishTraceOutput.status,
    dry_run: publishTraceOutput.dry_run,
    processed: publishTraceOutput.processed
  },
  readGolden("publish-trace-dryrun.json")
);

const registerTaskOutput = JSON.parse(runPowerShellScript(path.join(greenfield, "scripts", "register-claude-sync-task.ps1"), ["-DryRun", "-Json"], greenfield));
assert.deepEqual(
  {
    status: registerTaskOutput.status,
    dry_run: registerTaskOutput.dry_run,
    task_name: registerTaskOutput.task_name
  },
  readGolden("register-task-dryrun.json")
);

const calibrationOutput = JSON.parse(runPowerShellScript(path.join(greenfield, "scripts", "compute-calibration.ps1"), ["-Json"], greenfield));
assert.equal(calibrationOutput.status, "ok");
assert.equal(typeof calibrationOutput.agreement, "number");

const bootstrapSkillsOutput = JSON.parse(runPowerShellScript(path.join(greenfield, "scripts", "bootstrap-agent-skills.ps1"), ["-SkipExternalInstall", "-Json"], greenfield));
assert.equal(bootstrapSkillsOutput.status, "ok");
assert.equal(bootstrapSkillsOutput.external.attempted, false);
assert.ok(bootstrapSkillsOutput.mirrors.some((entry) => entry.status === "written"));

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
