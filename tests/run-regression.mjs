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

// Para los comandos que DEBEN salir en no-cero: devuelve su stdout en vez de
// tumbar la regresion.
function runAllowingFailure(args, options = {}) {
  try {
    return run(args, options);
  } catch (error) {
    return `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
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
// Un install de fabrica ya NO declara superficies: `doctor` sale en error
// hasta que se declaren las reales, que es el estado honesto de un repo a
// medio configurar. Se comprueba el error y despues se configura, como haria
// un consumidor.
const doctorSinSuperficies = runAllowingFailure(["doctor", "--target", greenfield, "--json"]);
assert.match(doctorSinSuperficies, /config-surfaces-empty/);

const greenfieldConfigPath = path.join(greenfield, ".sdlc", "config.json");
const configuredGreenfield = JSON.parse(fs.readFileSync(greenfieldConfigPath, "utf8"));
configuredGreenfield.surfaces = [{ id: "app", path: "src", owner: "api-agent", tier: "core" }];
fs.writeFileSync(greenfieldConfigPath, JSON.stringify(configuredGreenfield, null, 2), "utf8");
fs.mkdirSync(path.join(greenfield, "src"), { recursive: true });
fs.writeFileSync(path.join(greenfield, "src", "index.js"), "export const app = 1;\n", "utf8");
run(["upgrade", "--target", greenfield, "--accept-managed", ".sdlc/config.json", "--json"]);

run(["doctor", "--target", greenfield, "--json"]);
run(["diff", "--target", greenfield, "--json"]);

// El manifiesto se versiona, y en Windows con `core.autocrlf=true` git lo
// entrega en CRLF al hacer checkout. El checksum se comparaba sobre bytes
// crudos, asi que el hash cambiaba sin que nadie tocara el archivo: `doctor`
// daba `manifest-integrity` y `upgrade` quedaba bloqueado PARA SIEMPRE en ese
// repo — es decir, el consumidor no podia recibir ninguna correccion. Medido en
// manga-translator-mvp, donde impedia entregarle 1.8.3.
{
  const manifestPath = path.join(greenfield, ".sdlc", "install-manifest.json");
  const lf = fs.readFileSync(manifestPath, "utf8");
  fs.writeFileSync(manifestPath, lf.replace(/\n/g, "\r\n"), "utf8");

  const doctorCrlf = JSON.parse(run(["doctor", "--target", greenfield, "--json"]));
  assert.ok(
    !doctorCrlf.findings.some((finding) => finding.code === "manifest-integrity"),
    "CRLF en el manifiesto no puede leerse como manipulacion"
  );
  const upgradeCrlf = JSON.parse(runAllowingFailure(["upgrade", "--target", greenfield, "--dry-run", "--json"]));
  assert.notEqual(upgradeCrlf.status, "error", JSON.stringify(upgradeCrlf));

  // Una edicion REAL del manifiesto sigue detectandose: la normalizacion cubre
  // los finales de linea, no el contenido.
  const manipulado = fs.readFileSync(manifestPath, "utf8").replace(/"manifestVersion": 1/, '"manifestVersion": 99');
  fs.writeFileSync(manifestPath, manipulado, "utf8");
  const doctorManipulado = JSON.parse(runAllowingFailure(["doctor", "--target", greenfield, "--json"]));
  assert.ok(
    doctorManipulado.findings.some((finding) => finding.code === "manifest-integrity"),
    "una edicion real del manifiesto tiene que seguir bloqueando"
  );

  fs.writeFileSync(manifestPath, lf, "utf8");
}

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
// Los validate:* son contrato del consumidor, no artefactos del framework: se
// reportan como no configurados y no abortan el gate.
assert.match(localGatePortable, /Scripts no configurados en este consumidor/);

// -Strict solo exige lo que el framework SI entrega. En un repo recien
// instalado eso significa que falla por la dependencia ausente del framework,
// no por los validate:* que el consumidor todavia no escribio.
const localGateStrict = runPowerShellScriptStatus(
  path.join(greenfield, "scripts", "validate-local-gate.ps1"),
  ["-SkipInstall", "-SkipBootstrap", "-Strict"],
  greenfield
);
assert.notEqual(localGateStrict.status, 0);
const strictOutput = `${localGateStrict.stdout}\n${localGateStrict.stderr}`;
assert.match(strictOutput, /Dependencia sistema-multiagente-sdlc ausente/);
assert.ok(
  !/Script npm ausente/.test(strictOutput),
  "-Strict no debe abortar por un validate:* que el framework nunca entrega"
);

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

// Un repo recien instalado no tiene NINGUNA muestra de calibracion. Antes esto
// devolvia agreement 1.0 y status "ok": concordancia perfecta sobre el conjunto
// vacio, el mismo falso verde por denominador vacio que los gates de calidad
// rechazan. Ahora dice lo que realmente sabe.
const calibrationOutput = JSON.parse(runPowerShellScript(path.join(greenfield, "scripts", "compute-calibration.ps1"), ["-Json"], greenfield));
assert.equal(calibrationOutput.status, "not-measured");
assert.equal(calibrationOutput.agreement, null, "sin muestras no hay concordancia que reportar");
assert.equal(calibrationOutput.scored, 0);
assert.equal(calibrationOutput.graduation_threshold, 0.8);
assert.equal(calibrationOutput.freeze_threshold, 0.75);
assert.match(calibrationOutput.interpretation, /falta evidencia/);

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

// El interpolador preserva las expresiones de GitHub Actions: sin esto, cada
// workflow instalado perdia sus ${{ ... }} y llegaba roto al consumidor.
const { interpolate } = await import(new URL("../src/template-loader.js", import.meta.url).href);
const workflowSample = "on:\n  push:\n    branches: [{{gitFlow.integrationBranch}}]\nname: x-${{ github.sha }}\nrun: echo ${{ steps.a.outputs.b }}";
const interpolated = interpolate(workflowSample, { gitFlow: { integrationBranch: "develop" } });
assert.match(interpolated, /branches: \[develop\]/);
assert.match(interpolated, /x-\$\{\{ github\.sha \}\}/);
assert.match(interpolated, /echo \$\{\{ steps\.a\.outputs\.b \}\}/);

// El workflow arbitro llega instalado y con sus expresiones intactas.
const installedWorkflow = fs.readFileSync(path.join(greenfield, ".github", "workflows", "quality-verify.yml"), "utf8");
assert.match(installedWorkflow, /\$\{\{ github\.ref \}\}/);
assert.match(installedWorkflow, /branches: \[develop, main\]/);
assert.ok(fs.existsSync(path.join(greenfield, "scripts", "validate-spec-boundary.mjs")));
assert.ok(fs.existsSync(path.join(greenfield, "quality-contract.yaml")));

// phase-gate ahora ABRE la evidencia en vez de solo comprobar que exista.
function writeEvidence(repo, slice, phase, body) {
  const dir = path.join(repo, ".github", "agent-state", "evidence", slice);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${phase}.yaml`), body, "utf8");
}

// Evidencia ilegible: antes pasaba porque el archivo existia.
writeEvidence(greenfield, "slice-ev", "F1", "esto: no: es: yaml: valido:\n  - [\n");
const corruptGate = JSON.parse(
  run(["phase-gate", "--target", greenfield, "--phase", "F1", "--slice", "slice-ev", "--json"])
);
assert.equal(corruptGate.status, "blocked");
assert.ok(corruptGate.blockers.some((blocker) => blocker.startsWith("evidence-unparseable")));

// Evidencia con forma invalida segun el schema que el framework ya instalaba.
writeEvidence(greenfield, "slice-ev2", "F1", "phase: 123\nslice: []\n");
const invalidGate = JSON.parse(
  run(["phase-gate", "--target", greenfield, "--phase", "F1", "--slice", "slice-ev2", "--json"])
);
assert.equal(invalidGate.status, "blocked");
assert.ok(invalidGate.blockers.some((blocker) => blocker.startsWith("evidence-invalid")));

// Evidencia valida: el gate deja de bloquear por evidencia.
const validEvidence = [
  "phase: F1",
  "slice: slice-ev3",
  "agent_id: analista",
  "started_at: 2026-08-06T00:00:00Z",
  "outputs: []",
  "validators_run: []"
].join("\n");
writeEvidence(greenfield, "slice-ev3", "F1", validEvidence);
const validGate = JSON.parse(
  run(["phase-gate", "--target", greenfield, "--phase", "F1", "--slice", "slice-ev3", "--json"])
);
assert.equal(validGate.evidence.valid, true);
assert.ok(!validGate.blockers.some((blocker) => blocker.startsWith("evidence-")));

// Fase con gate humano: la firma no puede faltar, y si es texto libre sin
// review verificable se reporta como tal.
writeEvidence(
  greenfield,
  "slice-hg",
  "F13",
  ["phase: F13", "slice: slice-hg", "agent_id: pm", "started_at: 2026-08-06T00:00:00Z", "outputs: []", "validators_run: []"].join("\n")
);
const humanGateMissing = JSON.parse(
  run(["phase-gate", "--target", greenfield, "--phase", "F13", "--slice", "slice-hg", "--json"])
);
assert.ok(humanGateMissing.blockers.includes("human-gate-signoff-missing"));

writeEvidence(
  greenfield,
  "slice-hg2",
  "F13",
  [
    "phase: F13",
    "slice: slice-hg2",
    "agent_id: pm",
    "started_at: 2026-08-06T00:00:00Z",
    "outputs: []",
    "validators_run: []",
    "human_gate_signoff:",
    "  required: true",
    "  approved_by: alguien"
  ].join("\n")
);
const humanGateUnverifiable = JSON.parse(
  run(["phase-gate", "--target", greenfield, "--phase", "F13", "--slice", "slice-hg2", "--json"])
);
assert.ok(!humanGateUnverifiable.blockers.includes("human-gate-signoff-missing"));
// Desde el ADR 0008 este repo greenfield tiene sus superficies SIN CLASIFICAR
// —el instalador no inventa los cuatro riesgos, porque *no clasificado* no es
// *no aplica*—, asi que la obligacion derivada de riesgos exige atestacion y un
// `approved_by` suelto deja de alcanzar. El bloqueo dice ademas que comando
// emite la firma.
assert.ok(
  humanGateUnverifiable.blockers.includes("authz-attestation-missing"),
  JSON.stringify(humanGateUnverifiable.blockers)
);
assert.equal(humanGateUnverifiable.evidence.authorization.exige, "attestation");

// Y la CONTRACARA, que es la que prueba que el coste sigue al riesgo en vez de
// caer sobre todo el mundo: con las cuatro clasificaciones en `false`, la misma
// evidencia declarativa vuelve a ser un AVISO y la fase no bloquea por
// autorizacion. Sin este caso, "obliga siempre" pasaria el test de arriba.
{
  const configPath = path.join(greenfield, ".sdlc", "config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const previas = config.surfaces;
  config.surfaces = previas.map((s) => ({
    ...s,
    moneyPath: false,
    regulatedData: false,
    securityCritical: false,
    stateMachineCritical: false
  }));
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
  run(["upgrade", "--target", greenfield, "--accept-managed", ".sdlc/config.json", "--json"]);

  const clasificado = JSON.parse(
    run(["phase-gate", "--target", greenfield, "--phase", "F13", "--slice", "slice-hg2", "--json"])
  );
  assert.ok(
    !clasificado.blockers.includes("authz-attestation-missing"),
    JSON.stringify(clasificado.blockers)
  );
  assert.ok(
    clasificado.warnings.includes("human-gate-signoff-declarative"),
    JSON.stringify(clasificado.warnings)
  );
  assert.equal(clasificado.evidence.signatureClass, "declarative");
}

// Una atestacion DECLARADA que no verifica es peor que ninguna: afirma una
// garantia que no existe, asi que bloquea en vez de avisar.
writeEvidence(
  greenfield,
  "slice-hg3",
  "F13",
  [
    "phase: F13",
    "slice: slice-hg3",
    "agent_id: pm",
    "started_at: 2026-08-06T00:00:00Z",
    "outputs: []",
    "validators_run: []",
    "human_gate_signoff:",
    "  required: true",
    "  approved_by: alguien",
    "  signature_class: attestation",
    '  attestation_commit: "0000000000000000000000000000000000000000"'
  ].join("\n")
);
const atestacionFalsa = JSON.parse(
  runAllowingFailure(["phase-gate", "--target", greenfield, "--phase", "F13", "--slice", "slice-hg3", "--json"])
);
assert.ok(
  atestacionFalsa.blockers.some((blocker) => blocker.startsWith("human-gate-attestation-invalid")),
  JSON.stringify(atestacionFalsa.blockers)
);

// Y declararse `attestation` sin commit que verificar tampoco cuela.
writeEvidence(
  greenfield,
  "slice-hg4",
  "F13",
  [
    "phase: F13",
    "slice: slice-hg4",
    "agent_id: pm",
    "started_at: 2026-08-06T00:00:00Z",
    "outputs: []",
    "validators_run: []",
    "human_gate_signoff:",
    "  required: true",
    "  approved_by: alguien",
    "  signature_class: attestation"
  ].join("\n")
);
const atestacionSinCommit = JSON.parse(
  runAllowingFailure(["phase-gate", "--target", greenfield, "--phase", "F13", "--slice", "slice-hg4", "--json"])
);
assert.ok(atestacionSinCommit.blockers.includes("human-gate-attestation-commit-missing"), JSON.stringify(atestacionSinCommit.blockers));

// tools-doctor detecta scripts de gate que resuelven @latest en cada corrida.
const floatingRepo = makeRepo("floating-tooling");
fs.writeFileSync(
  path.join(floatingRepo, "package.json"),
  JSON.stringify(
    {
      name: "floating-tooling",
      packageManager: "npm@11.9.0",
      scripts: {
        "validate:openspec": "npx @fission-ai/openspec@latest validate --all",
        "validate:drift": "node scripts/validate-drift.mjs"
      }
    },
    null,
    2
  ),
  "utf8"
);
run(["install", "--target", floatingRepo, "--mode", "greenfield", "--project-name", "Floating", "--json"]);
const floatingDoctor = JSON.parse(
  runStatus(["tools-doctor", "--target", floatingRepo, "--profile", "full", "--json"]).stdout
);
const pinnedTool = floatingDoctor.tools.find((tool) => tool.name === "pinned-tooling");
assert.equal(pinnedTool.status, "warning");
assert.deepEqual(pinnedTool.floatingScripts, ["validate:openspec"]);
assert.ok(floatingDoctor.findings.some((f) => f.code === "tool-pinned-tooling"));

// Inyeccion de shell: en Windows el harness ejecuta via cmd.exe por obligacion,
// asi que los tokens con metacaracteres se rechazan en vez de escaparse.
const { assertShellSafeToken } = await import(new URL("../src/harness.js", import.meta.url).href);
assert.equal(assertShellSafeToken("validate:drift", "argumento"), "validate:drift");
assert.equal(assertShellSafeToken("npm", "comando"), "npm");
for (const payload of [
  "validate:drift & calc.exe",
  "x | whoami",
  "a > out.txt",
  "b $(id)",
  "c `id`",
  'd " & del',
  "e %PATH%",
  "f ; rm -rf /"
]) {
  assert.throws(
    () => assertShellSafeToken(payload, "argumento"),
    (error) => error.code === "UNSAFE_COMMAND_TOKEN",
    `deberia rechazar: ${payload}`
  );
}

// Las migraciones pueden leer el disco del consumidor, no solo los archivos
// recien renderizados desde templates/.
const { applyMigrations: applyMigrationsFn } = await import(
  new URL("../src/migrations.js", import.meta.url).href
);
const migrationProbe = { seen: null, existed: null, hadContext: false };
const migrationsResult = applyMigrationsFn(
  { "a.md": "renderizado" },
  [
    {
      version: "test",
      up: (files, context) => {
        migrationProbe.hadContext = Boolean(context && typeof context.readDisk === "function");
        migrationProbe.seen = context.readDisk("README.md");
        migrationProbe.existed = context.existsOnDisk("README.md");
        return { "b.md": `desde disco: ${String(migrationProbe.seen).slice(0, 12)}` };
      }
    }
  ],
  {
    target: greenfield,
    config: greenfieldConfig,
    readDisk: (relativePath) => {
      const absolute = path.join(greenfield, relativePath);
      return fs.existsSync(absolute) ? fs.readFileSync(absolute, "utf8").replace(/\r\n/g, "\n") : null;
    },
    existsOnDisk: (relativePath) => fs.existsSync(path.join(greenfield, relativePath))
  }
);
assert.ok(migrationProbe.hadContext, "la migracion debe recibir contexto de disco");
assert.equal(migrationProbe.existed, true);
assert.ok(typeof migrationProbe.seen === "string" && migrationProbe.seen.length > 0);
assert.equal(migrationsResult["a.md"], "renderizado");
assert.ok(migrationsResult["b.md"].startsWith("desde disco: "));

// Una migracion que ignora el contexto (todas las historicas) sigue funcionando.
const legacyStyle = applyMigrationsFn({ "a.md": "x" }, [{ version: "legacy", up: (files) => ({ "c.md": files["a.md"] }) }]);
assert.equal(legacyStyle["c.md"], "x");

// Contrato de CLI: --version informa la version y un comando desconocido falla.
const versionOutput = JSON.parse(run(["--version", "--json"]));
assert.equal(versionOutput.version, FRAMEWORK_VERSION);
const unknownCommand = runStatus(["comando-que-no-existe", "--json"]);
assert.equal(unknownCommand.status, 1);
assert.match(JSON.parse(unknownCommand.stdout).message, /Comando desconocido/);
assert.equal(runStatus(["--json"]).status, 0);

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
