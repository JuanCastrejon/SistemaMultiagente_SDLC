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
// Ligado a package.json a proposito: hardcodear la version aqui fue lo que dejo
// pasar el drift entre FRAMEWORK_VERSION (1.6.0) y el paquete publicado (1.7.0).
const FRAMEWORK_VERSION = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")
).version;

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
  throw new Error("PowerShell runtime not found. v1.5.0 requires pwsh/powershell for wrapper regression tests.");
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

function runPowerShellScriptStatus(scriptPath, args = [], cwd = repoRoot) {
  const command = findPowerShell();
  const prefix = process.platform === "win32" ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"] : ["-NoProfile", "-File"];
  return spawnSync(command, [...prefix, scriptPath, ...args], {
    cwd,
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
assert.equal(greenfieldConfig.frameworkVersion, FRAMEWORK_VERSION);
assert.equal(greenfieldConfig.scale, "feature");
run(["doctor", "--target", greenfield, "--json"]);
run(["diff", "--target", greenfield, "--json"]);

const phaseGateF0 = JSON.parse(run(["phase-gate", "--target", greenfield, "--phase", "F0", "--slice", "harness-bootstrap", "--json"]));
assert.equal(phaseGateF0.status, "ok");

const governanceCheck = JSON.parse(run(["governance-check", "--target", greenfield, "--json"]));
assert.equal(governanceCheck.status, "ok");
assert.ok(governanceCheck.canonicalSkills > 0);

const localGatePortable = runPowerShellScript(
  path.join(greenfield, "scripts", "validate-local-gate.ps1"),
  ["-SkipInstall", "-SkipBootstrap"],
  greenfield
);
assert.match(localGatePortable, /Local gate OK/);

const localGateStrict = runPowerShellScriptStatus(
  path.join(greenfield, "scripts", "validate-local-gate.ps1"),
  ["-SkipInstall", "-SkipBootstrap", "-Strict"],
  greenfield
);
assert.notEqual(localGateStrict.status, 0);
assert.match(`${localGateStrict.stdout}\n${localGateStrict.stderr}`, /modo -Strict/);

const toolsDoctor = runStatus(["tools-doctor", "--target", greenfield, "--profile", "full", "--json"]);
assert.ok([0, 2].includes(toolsDoctor.status));
const toolsDoctorOutput = JSON.parse(toolsDoctor.stdout);
assert.ok(["ok", "warning"].includes(toolsDoctorOutput.status));

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

const continuaNodeOutput = JSON.parse(run(["continua", "--target", greenfield, "--platform", "codex", "--json"]));
assert.equal(continuaNodeOutput.status, "ok");
assert.equal(continuaNodeOutput.platform, "codex");

const sessionStartOutput = JSON.parse(run(["session-start", "--target", greenfield, "--json"]));
assert.ok(["ok", "warning"].includes(sessionStartOutput.status));
assert.ok(fs.existsSync(path.join(greenfield, ".sdlc", "session.json")));

const resumeOutput = JSON.parse(run(["resume", "--target", greenfield, "--json"]));
assert.equal(resumeOutput.status, "ok");
assert.equal(resumeOutput.sliceId, "bootstrap-task-manager-saas");

const resumeMarkdown = run(["resume", "--target", greenfield, "--markdown"]);
assert.match(resumeMarkdown, /SDLC Resume/);

const savePreview = JSON.parse(run(["save", "--target", greenfield, "--event", "manual", "--no-mutate", "--json"]));
assert.equal(savePreview.status, "ok");
assert.equal(savePreview.dry_run, true);

const memoryHealth = JSON.parse(run(["memory-sync", "--target", greenfield, "--mode", "health", "--json"]));
assert.equal(memoryHealth.status, "ok");

const hooksInstall = JSON.parse(run(["hooks", "install", "--target", greenfield, "--post-merge-checkpoint", "--json"]));
assert.equal(hooksInstall.status, "ok");
assert.ok(fs.existsSync(path.join(greenfield, ".git", "hooks", "post-merge")) || hooksInstall.hook.endsWith(path.join(".git", "hooks", "post-merge")));

const validateRuntime = runStatus(["validate-runtime", "--target", greenfield, "--json"]);
assert.ok([0, 2].includes(validateRuntime.status));
const validateRuntimeOutput = JSON.parse(validateRuntime.stdout);
assert.ok(["ok", "warning"].includes(validateRuntimeOutput.status));

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

const initAlias = makeRepo("init-alias");
const initAliasOutput = JSON.parse(run(["init", "--target", initAlias, "--mode", "greenfield", "--project-name", "Init Alias", "--dry-run", "--json"]));
assert.equal(initAliasOutput.status, "ok");
assert.ok(initAliasOutput.files.includes(".sdlc/config.json"));

// v1.2.1: init --dry-run sin --target debe usar process.cwd() como destino.
const initCwdDefault = makeRepo("init-cwd-default");
const initCwdDefaultOutput = JSON.parse(
  execFileSync("node", [cli, "init", "--mode", "greenfield", "--project-name", "Init Cwd Default", "--dry-run", "--json"], {
    cwd: initCwdDefault,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  })
);
assert.equal(initCwdDefaultOutput.status, "ok");
assert.ok(initCwdDefaultOutput.files.includes(".sdlc/config.json"));
assert.ok(!fs.existsSync(path.join(initCwdDefault, ".sdlc", "config.json")), "dry-run no debe escribir archivos en cwd");

const legacy100 = makeRepo("legacy-upgrade-1-0-0");
fs.copyFileSync(path.join(repoRoot, "examples", "legacy-inventory-modernization", "README.md"), path.join(legacy100, "README.md"));
run(["install", "--target", legacy100, "--mode", "legacy", "--project-name", "Legacy Inventory Modernization", "--json"]);
simulateInstalledFrameworkVersion(legacy100, "1.0.0");

const upgrade100Output = JSON.parse(run(["upgrade", "--target", legacy100, "--to-version", "1.5.0", "--json"]));
assert.equal(upgrade100Output.status, "ok");
assert.ok(upgrade100Output.backup);
assert.ok(fs.existsSync(path.join(legacy100, ".sdlc", "migrations", "1.0.1-applied.txt")));
assert.ok(fs.existsSync(path.join(legacy100, ".sdlc", "migrations", "1.1.0-applied.txt")));
assert.ok(fs.existsSync(path.join(legacy100, ".sdlc", "migrations", "1.2.0-applied.txt")));
assert.ok(fs.existsSync(path.join(legacy100, ".sdlc", "migrations", "1.3.0-applied.txt")));
assert.ok(fs.existsSync(path.join(legacy100, ".sdlc", "migrations", "1.4.0-applied.txt")));
assert.ok(fs.existsSync(path.join(legacy100, ".sdlc", "migrations", "1.5.0-applied.txt")));
const upgraded100Config = JSON.parse(fs.readFileSync(path.join(legacy100, ".sdlc", "config.json"), "utf8"));
assert.equal(upgraded100Config.frameworkVersion, "1.5.0");
assert.equal(upgraded100Config.scale, "feature");
run(["diff", "--target", legacy100, "--json"]);
run(["rollback", "--target", legacy100, "--to", upgrade100Output.backup, "--json"]);
assert.ok(!fs.existsSync(path.join(legacy100, ".sdlc", "migrations", "1.0.1-applied.txt")));
assert.ok(!fs.existsSync(path.join(legacy100, ".sdlc", "migrations", "1.1.0-applied.txt")));
assert.ok(!fs.existsSync(path.join(legacy100, ".sdlc", "migrations", "1.2.0-applied.txt")));
assert.ok(!fs.existsSync(path.join(legacy100, ".sdlc", "migrations", "1.3.0-applied.txt")));
assert.ok(!fs.existsSync(path.join(legacy100, ".sdlc", "migrations", "1.4.0-applied.txt")));
assert.ok(!fs.existsSync(path.join(legacy100, ".sdlc", "migrations", "1.5.0-applied.txt")));

const legacy110 = makeRepo("legacy-upgrade-1-1-0");
fs.copyFileSync(path.join(repoRoot, "examples", "legacy-inventory-modernization", "README.md"), path.join(legacy110, "README.md"));
run(["install", "--target", legacy110, "--mode", "legacy", "--project-name", "Legacy Inventory Modernization", "--json"]);
simulateInstalledFrameworkVersion(legacy110, "1.1.0");

const upgrade110Output = JSON.parse(run(["upgrade", "--target", legacy110, "--to-version", "1.5.0", "--json"]));
assert.equal(upgrade110Output.status, "ok");
assert.ok(upgrade110Output.backup);
assert.ok(!fs.existsSync(path.join(legacy110, ".sdlc", "migrations", "1.0.1-applied.txt")));
assert.ok(!fs.existsSync(path.join(legacy110, ".sdlc", "migrations", "1.1.0-applied.txt")));
assert.ok(fs.existsSync(path.join(legacy110, ".sdlc", "migrations", "1.2.0-applied.txt")));
assert.ok(fs.existsSync(path.join(legacy110, ".sdlc", "migrations", "1.3.0-applied.txt")));
assert.ok(fs.existsSync(path.join(legacy110, ".sdlc", "migrations", "1.4.0-applied.txt")));
assert.ok(fs.existsSync(path.join(legacy110, ".sdlc", "migrations", "1.5.0-applied.txt")));
const upgraded110Config = JSON.parse(fs.readFileSync(path.join(legacy110, ".sdlc", "config.json"), "utf8"));
assert.equal(upgraded110Config.frameworkVersion, "1.5.0");
assert.equal(upgraded110Config.scale, "feature");
run(["diff", "--target", legacy110, "--json"]);

const conflict = makeRepo("existing-governance");
fs.mkdirSync(path.join(conflict, ".github"), { recursive: true });
fs.writeFileSync(path.join(conflict, ".github", "AGENTS.md"), "# Existing governance\n", "utf8");
const conflictResult = runStatus(["install", "--target", conflict, "--mode", "greenfield", "--json"]);
assert.equal(conflictResult.status, 2);
assert.ok(fs.existsSync(path.join(conflict, ".sdlc", "patch-plan.json")));

run(["prune-backups", "--target", legacy100, "--keep", "1", "--json"]);

// Deteccion de package manager: el harness ya no asume pnpm.
const { detectPackageManager } = await import(
  new URL("../src/harness.js", import.meta.url).href
);

const pmNpm = makeRepo("pm-npm");
fs.writeFileSync(
  path.join(pmNpm, "package.json"),
  JSON.stringify({ name: "pm-npm", packageManager: "npm@11.9.0" }, null, 2),
  "utf8"
);
const detectedNpm = detectPackageManager(pmNpm);
assert.equal(detectedNpm.name, "npm");
assert.equal(detectedNpm.source, "packageManager");
assert.deepEqual(detectedNpm.runScript("validate:drift"), ["npm", ["run", "--if-present", "validate:drift"]]);

const pmYarnLock = makeRepo("pm-yarn-lock");
fs.writeFileSync(path.join(pmYarnLock, "yarn.lock"), "", "utf8");
const detectedYarn = detectPackageManager(pmYarnLock);
assert.equal(detectedYarn.name, "yarn");
assert.equal(detectedYarn.source, "yarn.lock");

const pmDefault = makeRepo("pm-default");
const detectedDefault = detectPackageManager(pmDefault);
assert.equal(detectedDefault.name, "pnpm");
assert.equal(detectedDefault.source, "default");
assert.deepEqual(detectedDefault.runScript("validate:drift"), [
  "corepack",
  ["pnpm", "run", "validate:drift", "--if-present"]
]);

// tools-doctor reporta el package manager detectado en vez de exigir pnpm.
const pmNpmInstalled = makeRepo("pm-npm-installed");
fs.writeFileSync(
  path.join(pmNpmInstalled, "package.json"),
  JSON.stringify({ name: "pm-npm-installed", packageManager: "npm@11.9.0" }, null, 2),
  "utf8"
);
run(["install", "--target", pmNpmInstalled, "--mode", "greenfield", "--project-name", "PM npm", "--json"]);
const npmToolsDoctorOutput = JSON.parse(
  runStatus(["tools-doctor", "--target", pmNpmInstalled, "--profile", "full", "--json"]).stdout
);
assert.equal(npmToolsDoctorOutput.packageManager.name, "npm");
const packageManagerTool = npmToolsDoctorOutput.tools.find((tool) => tool.name === "package-manager");
assert.ok(packageManagerTool, "tools-doctor debe reportar el tool package-manager");
assert.equal(packageManagerTool.manager, "npm");
assert.ok(!npmToolsDoctorOutput.findings.some((finding) => finding.code === "tool-pnpm"));

// Los scripts de headroom que documenta el README ahora se entregan de verdad.
assert.ok(fs.existsSync(path.join(pmNpmInstalled, "scripts", "headroom-start.ps1")));
assert.ok(fs.existsSync(path.join(pmNpmInstalled, "scripts", "register-headroom-task.ps1")));

// Gate fantasma: un paso BLOCKING cuyo script no existe se reportaba pass
// porque npm/pnpm salen 0 con --if-present. Ahora es not-configured.
const verdictOutput = JSON.parse(
  runStatus(["verdict", "--target", pmNpmInstalled, "--json"]).stdout
);
assert.ok(Array.isArray(verdictOutput.notConfigured));
assert.ok(verdictOutput.notConfigured.includes("control-plane"));
const controlPlaneStep = verdictOutput.steps.find((step) => step.key === "control-plane");
assert.equal(controlPlaneStep.status, "not-configured");
assert.equal(controlPlaneStep.exitCode, null);
assert.ok(!verdictOutput.steps.some((step) => step.status === "pass"));
assert.deepEqual(verdictOutput.blockers, []);

// Entregabilidad: un archivo gestionado con personalizacion local bloqueaba el
// upgrade COMPLETO. Ahora se puede aceptar por archivo y queda registrado.
const overrideRepo = makeRepo("upgrade-accept-managed");
fs.copyFileSync(path.join(repoRoot, "examples", "task-manager-saas", "README.md"), path.join(overrideRepo, "README.md"));
run(["install", "--target", overrideRepo, "--mode", "greenfield", "--project-name", "Override Repo", "--json"]);

const customizedPath = path.join(overrideRepo, ".github", "AGENTS.md");
const customizedContent = `${fs.readFileSync(customizedPath, "utf8")}\n\n## Personalizacion local\n\nRegla propia del consumidor.\n`;
fs.writeFileSync(customizedPath, customizedContent, "utf8");

// Sin flags sigue bloqueando, pero ahora dice que el conflicto es aceptable.
const blockedUpgrade = runStatus(["upgrade", "--target", overrideRepo, "--to-version", FRAMEWORK_VERSION, "--json"]);
assert.equal(blockedUpgrade.status, 2);
const blockedPayload = JSON.parse(blockedUpgrade.stdout);
assert.equal(blockedPayload.status, "conflict");
assert.ok(blockedPayload.acceptable.includes(".github/AGENTS.md"));

// Aceptar una ruta inexistente en el conflicto es un error de uso, no un no-op.
const badAccept = runStatus([
  "upgrade", "--target", overrideRepo, "--to-version", FRAMEWORK_VERSION,
  "--accept-managed", "docs/no-existe.md", "--json"
]);
assert.equal(badAccept.status, 1);
assert.ok(JSON.parse(badAccept.stdout).unknownAccepts.includes("docs/no-existe.md"));

// Con --accept-managed el upgrade completa y el archivo local se conserva.
const acceptedUpgrade = JSON.parse(run([
  "upgrade", "--target", overrideRepo, "--to-version", FRAMEWORK_VERSION,
  "--accept-managed", ".github/AGENTS.md", "--json"
]));
assert.equal(acceptedUpgrade.status, "ok");
assert.deepEqual(acceptedUpgrade.accepted, [".github/AGENTS.md"]);
assert.equal(fs.readFileSync(customizedPath, "utf8"), customizedContent);
assert.ok(fs.existsSync(path.join(overrideRepo, ".sdlc", "overrides.yaml")));

// doctor deja de reportarlo como drift anonimo y lo reporta como override.
const overrideDoctor = JSON.parse(runStatus(["doctor", "--target", overrideRepo, "--json"]).stdout);
assert.ok(overrideDoctor.findings.some((f) => f.code === "managed-file-override" && f.path === ".github/AGENTS.md"));
assert.ok(!overrideDoctor.findings.some((f) => f.code === "managed-file-drift" && f.path === ".github/AGENTS.md"));

// Un segundo upgrade ya no pide aceptar de nuevo lo mismo.
assert.equal(JSON.parse(run(["upgrade", "--target", overrideRepo, "--to-version", FRAMEWORK_VERSION, "--json"])).status, "ok");

// Si el archivo cambia despues de aceptarlo, el override queda stale.
fs.writeFileSync(customizedPath, `${customizedContent}\nOtra edicion posterior.\n`, "utf8");
const staleDoctor = JSON.parse(runStatus(["doctor", "--target", overrideRepo, "--json"]).stdout);
assert.ok(staleDoctor.findings.some((f) => f.code === "managed-file-override-stale" && f.path === ".github/AGENTS.md"));

// Un vaultRoot relativo se resuelve contra el repo destino, no contra el cwd.
fs.writeFileSync(
  path.join(pmNpmInstalled, "scripts", "obsidian-memory.config.local.json"),
  JSON.stringify({ vaultRoot: ".sdlc/vault", projectSlug: "pm-npm-installed" }, null, 2),
  "utf8"
);
fs.mkdirSync(path.join(pmNpmInstalled, ".sdlc", "vault"), { recursive: true });
const runtimeWithVault = JSON.parse(
  runStatus(["validate-runtime", "--target", pmNpmInstalled, "--json"]).stdout
);
assert.equal(runtimeWithVault.runtime.vault.root, path.join(pmNpmInstalled, ".sdlc", "vault"));
assert.equal(runtimeWithVault.runtime.vault.exists, true);
assert.ok(!runtimeWithVault.findings.some((finding) => finding.code === "vault-missing"));

console.log("Regression suite: PASS");
