import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import {
  copyFilePreservingPath,
  ensureDir,
  normalizeLF,
  pathExists,
  readJson,
  readTextIfExists,
  removePath,
  sha256File,
  sha256Text,
  toPosixPath,
  writeJson,
  writeText
} from "./file-utils.js";
import { buildManagedFiles, defaultConfig, FRAMEWORK_VERSION, validateConfigShape } from "./render.js";
import { applyMigrations, migrationsToRun, SUPPORTED_VERSIONS } from "./migrations.js";
import {
  commandContinua,
  commandHooks,
  commandMemorySync,
  commandResume,
  commandSave,
  commandSessionStart,
  commandValidateRuntime
} from "./runtime.js";
import {
  commandGovernanceCheck,
  commandPhaseGate,
  commandPrBodyCheck,
  commandStatus,
  commandToolsDoctor,
  commandVerdict
} from "./harness.js";
import {
  commandSkillEval,
  commandSkillPropose
} from "./eval-runner.js";
import { commandQualityGate, commandQualityBaseline } from "./quality.js";
import { baselineDoctorFindings } from "./quality-baseline.js";
import { loadQualityContract, probeAnchorDoctorFindings } from "./quality-adjudicate.js";
import { commandCoverageDiff } from "./coverage-diff.js";
import { computeTreeHash } from "./evidence-writer.js";
import { createAttestationCommit, verifySignoff } from "./signoff.js";
import { verifyAcceptanceDir } from "./acceptance.js";
import { commandRedProofVerify } from "./red-proof.js";
import { verifyChangeClosure } from "./change-closure.js";
import { commandAdopt, detectCliLinked } from "./adopt.js";
import { commandQualityDocs } from "./quality-docs.js";
import { checkRetentionPolicy } from "./retention.js";

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_ACTION_REQUIRED = 2;

function parseArgs(argv) {
  const result = { command: null, options: {}, json: false };
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") {
      result.json = true;
      continue;
    }
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        result.options[key] = true;
      } else {
        result.options[key] = next;
        index += 1;
      }
      continue;
    }
    positionals.push(token);
  }
  result.positionals = positionals;
  result.command = positionals[0] === "hooks" && positionals[1] === "install"
    ? "hooks install"
    : positionals[0] ?? "help";
  return result;
}

function print(payload, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  if (payload.message) {
    console.log(payload.message);
  }
  if (payload.items) {
    for (const item of payload.items) {
      console.log(`- ${item}`);
    }
  }
}

function requireTarget(options) {
  if (!options.target) {
    return path.resolve(process.cwd());
  }
  return path.resolve(options.target);
}

function loadConfig(target) {
  const configPath = path.join(target, ".sdlc", "config.json");
  if (!pathExists(configPath)) {
    const error = new Error("No existe .sdlc/config.json. Ejecute sdlc install primero.");
    error.exitCode = EXIT_ACTION_REQUIRED;
    throw error;
  }
  return readJson(configPath);
}

function manifestPaths(target) {
  return {
    manifest: path.join(target, ".sdlc", "install-manifest.json"),
    checksum: path.join(target, ".sdlc", "install-manifest.sha256")
  };
}

function readManifest(target) {
  const paths = manifestPaths(target);
  if (!pathExists(paths.manifest)) {
    return null;
  }
  return readJson(paths.manifest);
}

function verifyManifestIntegrity(target) {
  const paths = manifestPaths(target);
  if (!pathExists(paths.manifest) || !pathExists(paths.checksum)) {
    return {
      ok: false,
      message: "Manifest o checksum ausente"
    };
  }
  const expected = fs.readFileSync(paths.checksum, "utf8").trim();
  const actual = sha256File(paths.manifest);
  return {
    ok: expected === actual,
    expected,
    actual,
    message: expected === actual ? "Manifest integro" : "Manifest corrupto o editado manualmente"
  };
}

function writeManifest(target, manifest) {
  const paths = manifestPaths(target);
  writeJson(paths.manifest, manifest);
  writeText(paths.checksum, `${sha256File(paths.manifest)}\n`);
}

function buildManifest(config, files, previous = {}) {
  return {
    manifestVersion: 1,
    frameworkVersion: config.frameworkVersion,
    schemaVersion: config.schemaVersion,
    projectSlug: config.project.slug,
    mode: config.mode,
    installedAt: previous.installedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    migrationsApplied: previous.migrationsApplied ?? [],
    managedFiles: Object.entries(files)
      .map(([filePath, content]) => ({
        path: filePath,
        sha256: sha256Text(content)
      }))
      .sort((left, right) => left.path.localeCompare(right.path))
  };
}

function getManagedPathSet(manifest) {
  return new Set((manifest?.managedFiles ?? []).map((entry) => entry.path));
}

function detectConflicts(target, files, manifest) {
  const managed = getManagedPathSet(manifest);
  const conflicts = [];
  for (const [relativePath, content] of Object.entries(files)) {
    const absolute = path.join(target, relativePath);
    if (!pathExists(absolute)) {
      continue;
    }
    const existing = normalizeLF(fs.readFileSync(absolute, "utf8"));
    if (existing === content) {
      continue;
    }
    if (!managed.has(relativePath)) {
      conflicts.push({
        path: relativePath,
        reason: "archivo preexistente no gestionado por SistemaMultiagente_SDLC",
        existingSha256: sha256Text(existing),
        proposedSha256: sha256Text(content)
      });
      continue;
    }
    const manifestEntry = manifest.managedFiles.find((entry) => entry.path === relativePath);
    if (manifestEntry && sha256Text(existing) !== manifestEntry.sha256) {
      conflicts.push({
        path: relativePath,
        reason: "archivo gestionado modificado localmente",
        existingSha256: sha256Text(existing),
        expectedSha256: manifestEntry.sha256,
        proposedSha256: sha256Text(content)
      });
    }
  }
  return conflicts;
}

function writePatchPlan(target, conflicts, files) {
  const patchPlan = {
    generatedAt: new Date().toISOString(),
    status: "action-required",
    policy: "file-level conflicts block writes; no overwrite without human decision",
    conflicts,
    proposedFiles: Object.keys(files).sort()
  };
  writeJson(path.join(target, ".sdlc", "patch-plan.json"), patchPlan);
  return patchPlan;
}

function backupId() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function createBackup(target, relativePaths, reason) {
  const id = backupId();
  const root = path.join(target, ".sdlc", "backups", id);
  const filesRoot = path.join(root, "files");
  const existing = [];
  ensureDir(filesRoot);
  for (const relativePath of relativePaths) {
    const absolute = path.join(target, relativePath);
    if (!pathExists(absolute)) {
      continue;
    }
    existing.push(relativePath);
    copyFilePreservingPath(target, filesRoot, relativePath);
  }
  const manifest = readManifest(target);
  if (manifest) {
    writeJson(path.join(root, "install-manifest.json"), manifest);
  }
  writeJson(path.join(root, "backup.json"), {
    id,
    reason,
    createdAt: new Date().toISOString(),
    existing
  });
  return id;
}

function writeManagedFiles(target, files, config, previousManifest = null, skipWrite = new Set()) {
  for (const [relativePath, content] of Object.entries(files)) {
    if (skipWrite.has(relativePath)) {
      // Divergencia local aceptada: el archivo del consumidor se conserva tal
      // cual y solo se registra su hash en el manifiesto.
      continue;
    }
    writeText(path.join(target, relativePath), content);
  }
  const manifest = buildManifest(config, files, previousManifest ?? {});
  writeManifest(target, manifest);
  return manifest;
}

// ---------------------------------------------------------------------------
// Overrides de archivos gestionados (.sdlc/overrides.yaml)
//
// `upgrade` abortaba entero ante cualquier archivo gestionado modificado
// localmente, asi que un consumidor que personaliza gobernanza a proposito
// quedaba sin via de actualizacion. Un override declara que esa divergencia es
// intencional: el archivo local se conserva y doctor deja de reportarlo como
// drift anonimo.
// ---------------------------------------------------------------------------

function overridesPath(target) {
  return path.join(target, ".sdlc", "overrides.yaml");
}

function readOverrides(target) {
  const raw = readTextIfExists(overridesPath(target));
  if (!raw) {
    return { version: 1, overrides: [] };
  }
  try {
    const parsed = YAML.parse(raw);
    const overrides = Array.isArray(parsed?.overrides) ? parsed.overrides : [];
    return { version: parsed?.version ?? 1, overrides };
  } catch {
    return { version: 1, overrides: [] };
  }
}

function writeOverrides(target, document) {
  const header = [
    "# Archivos gestionados con divergencia local aceptada.",
    "# Cada entrada declara que el consumidor mantiene su propia version de un",
    "# archivo del framework. `sdlc doctor` los reporta como override y no como",
    "# drift; si el archivo cambia despues de aceptarlo, el override queda stale.",
    ""
  ].join("\n");
  writeText(overridesPath(target), `${header}${YAML.stringify(document)}`);
}

function overrideIndex(target) {
  const index = new Map();
  for (const entry of readOverrides(target).overrides) {
    if (entry && typeof entry.path === "string") {
      index.set(entry.path, entry);
    }
  }
  return index;
}

function parsePathList(value) {
  if (!value || value === true) return [];
  return String(value)
    .split(",")
    .map((item) => toPosixPath(item.trim()))
    .filter(Boolean);
}

function registerOverrides(target, entries, frameworkVersion) {
  const document = readOverrides(target);
  const byPath = new Map(document.overrides.filter((entry) => entry?.path).map((entry) => [entry.path, entry]));
  const acceptedAt = new Date().toISOString();
  for (const entry of entries) {
    byPath.set(entry.path, {
      path: entry.path,
      sha256: entry.sha256,
      reason: entry.reason,
      acceptedAt,
      frameworkVersion
    });
  }
  const next = { version: 1, overrides: [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)) };
  writeOverrides(target, next);
  return next;
}

function pruneBackupsInternal(target, keep) {
  const backupRoot = path.join(target, ".sdlc", "backups");
  if (!pathExists(backupRoot)) {
    return [];
  }
  const backups = fs
    .readdirSync(backupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  const removed = backups.slice(keep);
  for (const id of removed) {
    removePath(path.join(backupRoot, id));
  }
  return removed;
}

function commandInstall(options) {
  const target = requireTarget(options);
  const mode = options.mode ?? "greenfield";
  const dryRun = Boolean(options["dry-run"]);
  const config = defaultConfig({
    target,
    mode,
    projectName: options["project-name"],
    projectSlug: options["project-slug"]
  });
  const configErrors = validateConfigShape(config);
  if (configErrors.length > 0) {
    return { exitCode: EXIT_ERROR, payload: { status: "error", errors: configErrors } };
  }
  const files = buildManagedFiles(config);
  const previousManifest = readManifest(target);
  const conflicts = detectConflicts(target, files, previousManifest);
  if (conflicts.length > 0) {
    if (!dryRun) {
      createBackup(target, [".sdlc/patch-plan.json"], "patch-plan-conflict");
    }
    const patchPlan = dryRun ? { conflicts, proposedFiles: Object.keys(files).sort() } : writePatchPlan(target, conflicts, files);
    return {
      exitCode: EXIT_ACTION_REQUIRED,
      payload: {
        status: "conflict",
        message: "Instalacion bloqueada por conflictos file-level.",
        conflicts,
        patchPlan
      }
    };
  }
  if (dryRun) {
    return {
      exitCode: EXIT_OK,
      payload: {
        status: "ok",
        message: "Dry-run OK. No se escribieron archivos.",
        files: Object.keys(files).sort()
      }
    };
  }
  const backup = createBackup(target, Object.keys(files), "install");
  const manifest = writeManagedFiles(target, files, config, previousManifest);
  pruneBackupsInternal(target, config.backup.keepLast ?? 5);
  return {
    exitCode: EXIT_OK,
    payload: {
      status: "ok",
      message: "SistemaMultiagente_SDLC instalado.",
      backup,
      managedFiles: manifest.managedFiles.length
    }
  };
}

function collectDrift(target, config, manifest) {
  const files = buildManagedFiles(config);
  const drift = [];
  const missing = [];
  const overridden = [];
  const staleOverrides = [];
  const overrides = overrideIndex(target);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolute = path.join(target, relativePath);
    const existing = readTextIfExists(absolute);
    if (existing === null) {
      missing.push(relativePath);
      continue;
    }
    if (normalizeLF(existing) !== content) {
      // Hash sobre el contenido normalizado: detectConflicts hace lo mismo, y
      // en Windows el CRLF del working tree daria dos hashes distintos para el
      // mismo archivo segun quien lo mire.
      const actualSha256 = sha256Text(normalizeLF(existing));
      const override = overrides.get(relativePath);
      if (override) {
        // La divergencia esta declarada. Solo sigue siendo la misma divergencia
        // si el archivo no cambio desde que se acepto.
        const entry = { path: relativePath, actualSha256, acceptedSha256: override.sha256, reason: override.reason };
        if (override.sha256 === actualSha256) {
          overridden.push(entry);
        } else {
          staleOverrides.push(entry);
        }
        continue;
      }
      drift.push({
        path: relativePath,
        actualSha256,
        expectedSha256: sha256Text(content)
      });
    }
  }
  const managedPathSet = getManagedPathSet(manifest);
  const unmanaged = Object.keys(files).filter((filePath) => !managedPathSet.has(filePath));
  return { files, drift, missing, unmanaged, overridden, staleOverrides };
}

function checkCommand(command, args = ["--version"]) {
  const result = spawnSync(command, args, { encoding: "utf8", shell: false });
  return {
    ok: result.status === 0,
    output: (result.stdout || result.stderr || "").trim().split(/\r?\n/)[0] ?? ""
  };
}

function checkPowerShell() {
  for (const command of process.platform === "win32" ? ["pwsh", "powershell"] : ["pwsh"]) {
    const result = spawnSync(command, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], {
      encoding: "utf8",
      shell: false
    });
    if (result.status === 0) {
      return { ok: true, command, version: result.stdout.trim() };
    }
  }
  return { ok: false, command: null, version: null };
}

function daysSince(filePath) {
  if (!pathExists(filePath)) return null;
  const ageMs = Date.now() - fs.statSync(filePath).mtimeMs;
  return Math.floor(ageMs / (24 * 60 * 60 * 1000));
}

function collectDoctorEnhancements(target, config) {
  const findings = [];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  findings.push({
    level: nodeMajor >= 18 ? "info" : "error",
    code: "runtime-node",
    message: `Node.js ${process.versions.node}`,
    required: ">=18"
  });

  const pwsh = checkPowerShell();
  findings.push({
    level: pwsh.ok ? "info" : "error",
    code: "runtime-pwsh",
    message: pwsh.ok ? `${pwsh.command} ${pwsh.version}` : "PowerShell runtime not found"
  });

  const git = checkCommand("git", ["--version"]);
  findings.push({
    level: git.ok ? "info" : "error",
    code: "runtime-git",
    message: git.ok ? git.output : "git not found"
  });

  const requiredAgentState = [
    ".github/agent-state/phase-graph.yaml",
    ".github/agent-state/phase-status.yaml",
    ".github/agent-state/active-slices.yaml",
    ".github/agent-state/current-slice.md",
    ".github/agent-state/platform-context.json"
  ];
  for (const relativePath of requiredAgentState) {
    if (!pathExists(path.join(target, relativePath))) {
      findings.push({ level: "error", code: "agent-state-missing", path: relativePath });
    }
  }

  if (!config || !config.scale) {
    findings.push({ level: "error", code: "scale-missing", message: "config.scale is required in v1.3.0" });
  } else {
    findings.push({ level: "info", code: "scale-present", message: `scale=${config.scale}` });
  }

  const canonicalSpecs = [
    "openspec/specs/business-production-readiness/spec.md",
    "openspec/specs/project-phases/spec.md"
  ];
  for (const relativePath of canonicalSpecs) {
    if (!pathExists(path.join(target, relativePath))) {
      findings.push({ level: "error", code: "openspec-canonical-missing", path: relativePath });
    }
  }

  const skillsManifest = path.join(target, "scripts", "agent-skills.manifest.json");
  if (!pathExists(skillsManifest)) {
    findings.push({ level: "error", code: "skill-manifest-missing", path: "scripts/agent-skills.manifest.json" });
  }

  const canonicalSkills = path.join(target, ".github", "skills");
  const mirrorRoots = [".claude/skills", ".agents/skills", ".windsurf/skills"];
  if (pathExists(canonicalSkills)) {
    for (const mirrorRoot of mirrorRoots) {
      const absoluteMirrorRoot = path.join(target, mirrorRoot);
      if (!pathExists(absoluteMirrorRoot)) {
        findings.push({ level: "info", code: "skill-mirror-not-generated", path: mirrorRoot });
        continue;
      }
      for (const entry of fs.readdirSync(absoluteMirrorRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const mirror = path.join(absoluteMirrorRoot, entry.name, "SKILL.md");
        if (!pathExists(mirror)) continue;
        const canonical = path.join(canonicalSkills, entry.name, "SKILL.md");
        if (!pathExists(canonical)) {
          findings.push({ level: "warning", code: "skill-mirror-without-canonical", path: `${mirrorRoot}/${entry.name}/SKILL.md` });
        }
      }
    }
  }

  const obsidianLocal = path.join(target, "scripts", "obsidian-memory.config.local.json");
  if (config?.obsidian?.enabled && !pathExists(obsidianLocal)) {
    findings.push({ level: "info", code: "obsidian-config-not-enabled", message: "Optional memory config not found" });
  }

  const graphReport = path.join(target, "graphify-out", "GRAPH_REPORT.md");
  const graphAge = daysSince(graphReport);
  if (graphAge === null) {
    findings.push({ level: "info", code: "graphify-report-missing", message: "Optional graphify report not found" });
  } else if (graphAge > 30) {
    findings.push({ level: "warning", code: "graphify-report-stale", message: `graphify report is ${graphAge} days old` });
  }

  return findings;
}

function commandDoctor(options) {
  const target = requireTarget(options);
  const findings = [];
  let config = null;
  let manifest = null;
  try {
    config = loadConfig(target);
    for (const error of validateConfigShape(config)) {
      findings.push({ level: "error", code: "config-schema", message: error });
    }
  } catch (error) {
    findings.push({ level: "error", code: "missing-config", message: error.message });
  }
  manifest = readManifest(target);
  if (!manifest) {
    findings.push({ level: "error", code: "missing-manifest", message: "No existe .sdlc/install-manifest.json" });
  } else {
    const integrity = verifyManifestIntegrity(target);
    if (!integrity.ok) {
      findings.push({ level: "error", code: "manifest-integrity", message: integrity.message, integrity });
    }
  }
  let drift = null;
  if (config && manifest) {
    drift = collectDrift(target, config, manifest);
    for (const filePath of drift.missing) {
      findings.push({ level: "error", code: "managed-file-missing", path: filePath });
    }
    for (const entry of drift.drift) {
      findings.push({ level: "warning", code: "managed-file-drift", ...entry });
    }
    for (const entry of drift.overridden) {
      findings.push({ level: "info", code: "managed-file-override", ...entry });
    }
    for (const entry of drift.staleOverrides) {
      findings.push({ level: "warning", code: "managed-file-override-stale", ...entry });
    }
  }
  findings.push(...collectDoctorEnhancements(target, config));
  findings.push(...baselineDoctorFindings(target));
  findings.push(...probeAnchorDoctorFindings(target));
  findings.push(...checkRetentionPolicy(target));
  const cliLinked = detectCliLinked();
  if (cliLinked.declared && cliLinked.linked) {
    findings.push({
      level: "warning",
      code: "cli-resolved-from-link",
      detail: `sistema-multiagente-sdlc resuelve fuera de node_modules (${cliLinked.resolved}): valido para desarrollo local, pero CI lo rechaza (decision 9, ADR 0007)`
    });
  }
  const hasErrors = findings.some((finding) => finding.level === "error");
  const hasWarnings = findings.some((finding) => finding.level === "warning");
  return {
    exitCode: hasErrors ? EXIT_ERROR : hasWarnings ? EXIT_ACTION_REQUIRED : EXIT_OK,
    payload: {
      status: hasErrors ? "error" : hasWarnings ? "drift" : "ok",
      message: hasErrors ? "Doctor encontro errores." : hasWarnings ? "Doctor encontro drift." : "Doctor OK.",
      findings,
      summary: {
        target,
        frameworkVersion: config?.frameworkVersion ?? null,
        managedFiles: manifest?.managedFiles?.length ?? 0
      }
    }
  };
}

/**
 * `sdlc signoff` (ADR 0007, P5)
 *
 * El sujeto que se aprueba/verifica es SIEMPRE { slice, phase, tree_hash },
 * recomputado sobre las superficies declaradas en quality-contract.yaml en
 * el momento de la llamada — nunca se confia en un tree_hash que alguien
 * declare por fuera, porque eso reabriria exactamente el hueco que esto
 * cierra (una firma que dice aprobar algo que nadie recomputo).
 */
function commandSignoff(options) {
  const target = requireTarget(options);
  const loaded = loadQualityContract(target);
  if (!loaded.ok) {
    return { exitCode: EXIT_ACTION_REQUIRED, payload: { status: "not-configured", code: loaded.code, path: loaded.path } };
  }
  const slice = options.slice ?? null;
  const phase = options.phase ?? null;
  if (!slice || !phase) {
    return { exitCode: EXIT_ERROR, payload: { status: "error", message: "signoff exige --slice y --phase." } };
  }
  const surfacePaths = (loaded.contract.surfaces ?? []).map((surface) => surface.path);
  const tree = computeTreeHash(target, surfacePaths);
  const subject = { slice, phase, tree_hash: tree.hash };

  if (options.create) {
    const created = createAttestationCommit({
      target,
      slice,
      phase,
      subject,
      signingKey: options["signing-key"] ?? options.signingKey ?? null
    });
    if (!created.ok) return { exitCode: EXIT_ERROR, payload: { status: "error", ...created, subject } };
    return { exitCode: EXIT_OK, payload: { status: "ok", ...created, subject } };
  }

  if (options.verify) {
    let config;
    try {
      config = loadConfig(target);
    } catch (error) {
      return { exitCode: error.exitCode ?? EXIT_ERROR, payload: { status: "error", message: error.message } };
    }
    const maintainers = config.governance?.maintainers ?? [];
    if (maintainers.length === 0) {
      return {
        exitCode: EXIT_ACTION_REQUIRED,
        payload: {
          status: "not-configured",
          code: "governance-maintainers-missing",
          message: "config.governance.maintainers esta vacio: ninguna firma puede resultar valida."
        }
      };
    }
    const result = verifySignoff({
      target,
      commitSha: options.commit ?? null,
      subject,
      maintainers,
      headRef: options["head-ref"] ?? options.headRef ?? "HEAD"
    });
    return { exitCode: result.ok ? EXIT_OK : EXIT_ACTION_REQUIRED, payload: { status: result.ok ? "ok" : "blocked", ...result, subject } };
  }

  return {
    exitCode: EXIT_ERROR,
    payload: { status: "error", message: "Uso: sdlc signoff --slice <id> --phase <F> <--create [--signing-key <id>] | --verify --commit <sha>>" }
  };
}

/**
 * `sdlc acceptance-verify` (ADR 0007, P9)
 *
 * Verifica openspec/changes/<slug>/acceptance/*.feature.md: cada escenario
 * debe traer un `sc_id` cuyo hash coincida con (capability, requirement,
 * titulo) ACTUALES. No ejecuta ningun test; eso es responsabilidad de
 * `test_ref` y del control spec-trace, fuera de esta pieza.
 */
function commandAcceptanceVerify(options) {
  const target = requireTarget(options);
  const changeSlug = options.change ?? null;
  if (!changeSlug) {
    return { exitCode: EXIT_ERROR, payload: { status: "error", message: "acceptance-verify exige --change <slug>." } };
  }
  const result = verifyAcceptanceDir(target, changeSlug);
  if (!result.exists) {
    return {
      exitCode: EXIT_ACTION_REQUIRED,
      payload: { status: "not-configured", code: "acceptance-dir-missing", change: changeSlug }
    };
  }
  return {
    exitCode: result.ok ? EXIT_OK : EXIT_ACTION_REQUIRED,
    payload: {
      status: result.ok ? "ok" : "blocked",
      change: changeSlug,
      files: result.files.map((entry) => entry.file),
      // Cuantos escenarios se verificaron de verdad: sin este numero, "verifique
      // 12" y "verifique 0" se veian identicos para quien lee el resultado.
      scenarioCount: result.scenarioCount ?? 0,
      findings: result.findings
    }
  };
}

/**
 * `sdlc change-close` (ADR 0007, P11)
 *
 * No archiva nada por si mismo: solo dice si el change puede cerrarse.
 * Archivar (mover openspec/changes/<slug> a archive/) sigue siendo accion del
 * CLI de OpenSpec; esta pieza es el gate que decide si corresponde llamarlo.
 */
function commandChangeClose(options) {
  const target = requireTarget(options);
  const changeSlug = options.change ?? null;
  if (!changeSlug) {
    return { exitCode: EXIT_ERROR, payload: { status: "error", message: "change-close exige --change <slug>." } };
  }
  const tasksPath = path.join(target, "openspec", "changes", changeSlug, "tasks.md");
  if (!pathExists(tasksPath)) {
    return { exitCode: EXIT_ACTION_REQUIRED, payload: { status: "not-configured", code: "tasks-file-missing", path: tasksPath } };
  }
  let integrationBranch = options["integration-branch"] ?? options.integrationBranch ?? null;
  if (!integrationBranch) {
    try {
      integrationBranch = loadConfig(target)?.gitFlow?.integrationBranch ?? null;
    } catch {
      integrationBranch = null;
    }
  }
  const raw = fs.readFileSync(tasksPath, "utf8");
  const result = verifyChangeClosure({ target, raw, slice: options.slice ?? null, integrationBranch });
  return {
    exitCode: result.ok ? EXIT_OK : EXIT_ACTION_REQUIRED,
    payload: { status: result.ok ? "ok" : "blocked", change: changeSlug, tasks: result.tasks, findings: result.findings }
  };
}

function commandDiff(options) {
  const target = requireTarget(options);
  const config = loadConfig(target);
  const manifest = readManifest(target);
  if (!manifest) {
    return { exitCode: EXIT_ACTION_REQUIRED, payload: { status: "missing-manifest" } };
  }
  const diff = collectDrift(target, config, manifest);
  const hasDiff = diff.missing.length > 0 || diff.drift.length > 0 || diff.unmanaged.length > 0;
  return {
    exitCode: hasDiff ? EXIT_ACTION_REQUIRED : EXIT_OK,
    payload: {
      status: hasDiff ? "diff" : "ok",
      missing: diff.missing,
      changed: diff.drift,
      unmanagedExpected: diff.unmanaged
    }
  };
}

function commandUpgrade(options) {
  const target = requireTarget(options);
  const toVersion = options["to-version"] ?? FRAMEWORK_VERSION;
  const dryRun = Boolean(options["dry-run"]);
  const config = loadConfig(target);
  const manifest = readManifest(target);
  if (!manifest) {
    return { exitCode: EXIT_ACTION_REQUIRED, payload: { status: "missing-manifest" } };
  }
  const integrity = verifyManifestIntegrity(target);
  if (!integrity.ok) {
    return { exitCode: EXIT_ERROR, payload: { status: "error", message: integrity.message, integrity } };
  }
  if (!SUPPORTED_VERSIONS.has(toVersion)) {
    return { exitCode: EXIT_ERROR, payload: { status: "error", message: `Version no soportada: ${toVersion}` } };
  }
  const fromVersion = config.frameworkVersion;
  const nextConfig = { ...config, frameworkVersion: toVersion };
  const migrations = migrationsToRun(fromVersion, toVersion);
  const migrationContext = {
    target,
    config: nextConfig,
    readDisk: (relativePath) => {
      const content = readTextIfExists(path.join(target, relativePath));
      return content === null ? null : normalizeLF(content);
    },
    existsOnDisk: (relativePath) => pathExists(path.join(target, relativePath))
  };
  const files = applyMigrations(buildManagedFiles(nextConfig), migrations, migrationContext);
  const conflicts = detectConflicts(target, files, manifest);

  // Resolucion por archivo: sin esto, un solo archivo gestionado con
  // personalizacion local bloquea el upgrade completo y el consumidor se queda
  // sin via de actualizacion. `--accept-managed` conserva la version local de
  // los paths indicados y la registra en .sdlc/overrides.yaml.
  const acceptAll = Boolean(options["accept-all-managed"]);
  const acceptRequested = new Set(parsePathList(options["accept-managed"]));
  const alreadyOverridden = overrideIndex(target);
  const accepted = [];
  const blocking = [];
  for (const conflict of conflicts) {
    const isManaged = conflict.reason === "archivo gestionado modificado localmente";
    const previouslyAccepted = alreadyOverridden.get(conflict.path)?.sha256 === conflict.existingSha256;
    if (isManaged && (acceptAll || acceptRequested.has(conflict.path) || previouslyAccepted)) {
      accepted.push(conflict);
    } else {
      blocking.push(conflict);
    }
  }
  const unknownAccepts = [...acceptRequested].filter(
    (candidate) => !conflicts.some((conflict) => conflict.path === candidate)
  );
  if (unknownAccepts.length > 0) {
    return {
      exitCode: EXIT_ERROR,
      payload: {
        status: "error",
        message: "Se pidio aceptar rutas que no estan en conflicto.",
        unknownAccepts
      }
    };
  }

  if (blocking.length > 0) {
    if (!dryRun) {
      createBackup(target, [".sdlc/patch-plan.json"], "patch-plan-conflict");
    }
    const patchPlan = dryRun
      ? { conflicts: blocking, proposedFiles: Object.keys(files).sort() }
      : writePatchPlan(target, blocking, files);
    return {
      exitCode: EXIT_ACTION_REQUIRED,
      payload: {
        status: "conflict",
        conflicts: blocking,
        acceptable: blocking.filter((conflict) => conflict.reason === "archivo gestionado modificado localmente").map((conflict) => conflict.path),
        hint: "Repetir con --accept-managed <paths separados por coma> o --accept-all-managed para conservar la version local de esos archivos.",
        patchPlan
      }
    };
  }

  if (dryRun) {
    return {
      exitCode: EXIT_OK,
      payload: {
        status: "ok",
        message: `Dry-run upgrade a ${toVersion}`,
        accepted: accepted.map((conflict) => conflict.path)
      }
    };
  }

  const backup = createBackup(target, [...new Set([...Object.keys(files), ...manifest.managedFiles.map((entry) => entry.path)])], "upgrade");

  // El manifiesto debe registrar lo que queda EN DISCO, no lo que el framework
  // habria escrito: si guardara el hash del framework, el archivo conservado
  // volveria a detectarse como conflicto en el siguiente upgrade.
  const effectiveFiles = { ...files };
  const skipWrite = new Set();
  const overrideEntries = [];
  for (const conflict of accepted) {
    const localContent = readTextIfExists(path.join(target, conflict.path));
    if (localContent === null) continue;
    const normalized = normalizeLF(localContent);
    effectiveFiles[conflict.path] = normalized;
    skipWrite.add(conflict.path);
    overrideEntries.push({
      path: conflict.path,
      sha256: sha256Text(normalized),
      reason: alreadyOverridden.get(conflict.path)?.reason ?? "divergencia local aceptada en upgrade"
    });
  }
  if (overrideEntries.length > 0) {
    registerOverrides(target, overrideEntries, toVersion);
  }

  const nextManifest = writeManagedFiles(
    target,
    effectiveFiles,
    nextConfig,
    {
      ...manifest,
      migrationsApplied: [...new Set([...(manifest.migrationsApplied ?? []), ...migrations.map((m) => m.version)])]
    },
    skipWrite
  );
  pruneBackupsInternal(target, nextConfig.backup?.keepLast ?? 5);
  return {
    exitCode: EXIT_OK,
    payload: {
      status: "ok",
      backup,
      frameworkVersion: nextManifest.frameworkVersion,
      accepted: overrideEntries.map((entry) => entry.path)
    }
  };
}

function commandMigrateConfig(options) {
  const target = requireTarget(options);
  const dryRun = Boolean(options["dry-run"]);
  const config = loadConfig(target);
  const nextConfig = { ...config, schemaVersion: 1 };
  const errors = validateConfigShape(nextConfig);
  if (errors.length > 0) {
    return { exitCode: EXIT_ERROR, payload: { status: "error", errors } };
  }
  if (dryRun) {
    return { exitCode: EXIT_OK, payload: { status: "ok", message: "Dry-run migrate-config OK" } };
  }
  const backup = createBackup(target, [".sdlc/config.json"], "migrate-config");
  writeJson(path.join(target, ".sdlc", "config.json"), nextConfig);
  return { exitCode: EXIT_OK, payload: { status: "ok", backup } };
}

function commandRollback(options) {
  const target = requireTarget(options);
  const backup = options.to;
  if (!backup) {
    return { exitCode: EXIT_ERROR, payload: { status: "error", message: "Falta --to <backup-id>" } };
  }
  const backupRoot = path.join(target, ".sdlc", "backups", backup);
  const backupMetaPath = path.join(backupRoot, "backup.json");
  if (!pathExists(backupMetaPath)) {
    return { exitCode: EXIT_ERROR, payload: { status: "error", message: `Backup no encontrado: ${backup}` } };
  }
  const currentManifest = readManifest(target);
  const backupMeta = readJson(backupMetaPath);
  const existing = new Set(backupMeta.existing ?? []);
  if (currentManifest) {
    for (const entry of currentManifest.managedFiles ?? []) {
      if (!existing.has(entry.path)) {
        removePath(path.join(target, entry.path));
      }
    }
  }
  const filesRoot = path.join(backupRoot, "files");
  for (const relativePath of existing) {
    copyFilePreservingPath(filesRoot, target, relativePath);
  }
  const manifestBackup = path.join(backupRoot, "install-manifest.json");
  if (pathExists(manifestBackup)) {
    copyFilePreservingPath(backupRoot, path.join(target, ".sdlc"), "install-manifest.json");
    writeText(path.join(target, ".sdlc", "install-manifest.sha256"), `${sha256File(path.join(target, ".sdlc", "install-manifest.json"))}\n`);
  }
  return { exitCode: EXIT_OK, payload: { status: "ok", message: `Rollback aplicado: ${backup}` } };
}

function commandPruneBackups(options) {
  const target = requireTarget(options);
  const config = pathExists(path.join(target, ".sdlc", "config.json")) ? loadConfig(target) : {};
  const keep = Number(options.keep ?? config.backup?.keepLast ?? 5);
  const removed = pruneBackupsInternal(target, keep);
  return { exitCode: EXIT_OK, payload: { status: "ok", keep, removed } };
}

function commandHelp() {
  return {
    exitCode: EXIT_OK,
    payload: {
      status: "ok",
      message: "Uso: sdlc <init|install|upgrade|rollback|doctor|diff|prune-backups|migrate-config|session-start|resume|save|continua|memory-sync|validate-runtime|phase-gate|governance-check|tools-doctor|pr-body-check|verdict|status|quality-gate|quality-baseline|coverage-diff|signoff|acceptance-verify|red-proof-verify|change-close|adopt|quality-docs|hooks install> [--target <repo>] [--json]\nSi --target se omite, se usa el directorio actual (process.cwd()).\nverdict: veredicto READY/NOT-READY ordenado fail-fast [--write --slice --phase]\nstatus:  snapshot go/no-go agregado [--markdown --write --exit-code]\nupgrade: [--to-version <v>] [--dry-run] [--accept-managed <paths,coma>] [--accept-all-managed]\n         Los archivos aceptados conservan su version local y quedan registrados en .sdlc/overrides.yaml.\nquality-gate: --slice <id> --phase <F> <--run | --from-evidence> [--exit-code]\n         --run ejecuta los probes de quality-contract.yaml y anexa la evidencia medida.\n         --from-evidence solo adjudica lo ya escrito y se marca advisory.\nquality-baseline: --promote --slice <id> [--phase F15] [--source ci|local] [--allow-local]\n         Mueve la linea base de los gates ratchet a la evidencia de una fase ya escrita.\n         Sin --source ci exige --allow-local explicito.\ncoverage-diff: [--base-ref <ref>] [--coverage-final <ruta>] [--summary <ruta>]\n         Cruza git diff contra coverage-final.json y escribe `changed.pct/total` en coverage-summary.json.\n         Se encadena despues del test runner, antes de quality-gate --run.\nsignoff: --slice <id> --phase <F> <--create [--signing-key <id>] | --verify --commit <sha> [--head-ref <ref>]>\n         El sujeto (slice+phase+tree_hash de las superficies) se recomputa siempre, nunca se recibe declarado.\n         --verify exige config.governance.maintainers no vacio: sin maintainers ninguna firma es valida.\nacceptance-verify: --change <slug>\n         Verifica openspec/changes/<slug>/acceptance/*.feature.md: cada escenario debe traer sc_id\n         cuyo hash coincida con (capability, requirement, titulo) actuales.\nred-proof-verify: --slice <id> [--phase F5] --report <ruta> --format <formato>\n         Todo escenario en scenario_traceability con status:red exige que el reporte declare\n         outcome:assertion-failed. Un error colateral (import roto, throw arbitrario) no da credito.\nchange-close: --change <slug> [--slice <id>] [--integration-branch <rama>]\n         Ninguna tarea de tasks.md puede quedar sin marcar; una tarea de merge marcada [x]\n         exige que HEAD sea antepasado real de la rama de integracion; F13/F14 deben estar en ok.\nadopt: [--project-name <nombre>]\n         Aditivo puro: nunca sobreescribe lo que ya existe. Agrega sistema-multiagente-sdlc como\n         devDependency (nunca npm link), .sdlc/config.json minimo, quality-contract.yaml,\n         phase-contract.yaml y su schema, solo los que falten.\nquality-docs: [--out docs/quality-gates.md] [--dry-run]\n         Regenera la doc de tiers/superficies/probes/gates desde quality-contract.yaml y\n         phase-contract.yaml. No se edita a mano: se sobreescribe en cada corrida."
    }
  };
}

export function run(argv) {
  const parsed = parseArgs(argv);
  // `--version` se parsea como opcion booleana, no como subcomando, asi que caia
  // en la ayuda con exit 0 sin decir nunca la version.
  if (parsed.options.version === true || parsed.command === "version") {
    return { exitCode: EXIT_OK, payload: { status: "ok", version: FRAMEWORK_VERSION } };
  }
  switch (parsed.command) {
    case "init":
    case "install":
      return commandInstall(parsed.options);
    case "doctor":
      return commandDoctor(parsed.options);
    case "diff":
      return commandDiff(parsed.options);
    case "upgrade":
      return commandUpgrade(parsed.options);
    case "rollback":
      return commandRollback(parsed.options);
    case "prune-backups":
      return commandPruneBackups(parsed.options);
    case "migrate-config":
      return commandMigrateConfig(parsed.options);
    case "session-start":
      return commandSessionStart(parsed.options);
    case "resume":
      return commandResume(parsed.options);
    case "save":
      return commandSave(parsed.options);
    case "continua":
      return commandContinua(parsed.options);
    case "memory-sync":
      return commandMemorySync(parsed.options);
    case "validate-runtime":
      return commandValidateRuntime(parsed.options);
    case "phase-gate":
      return commandPhaseGate(parsed.options);
    case "governance-check":
      return commandGovernanceCheck(parsed.options);
    case "tools-doctor":
      return commandToolsDoctor(parsed.options);
    case "pr-body-check":
      return commandPrBodyCheck(parsed.options);
    case "verdict":
      return commandVerdict(parsed.options);
    case "status":
      return commandStatus(parsed.options);
    case "skill-eval": {
      const skillOpts = { ...parsed.options, skill: parsed.options.skill ?? parsed.positionals[1] };
      return commandSkillEval(skillOpts);
    }
    case "skill-propose": {
      const propOpts = {
        ...parsed.options,
        skill: parsed.options.skill ?? parsed.positionals[1],
        change: parsed.options.change ?? parsed.positionals[2],
      };
      return commandSkillPropose(propOpts);
    }
    case "quality-gate":
      return commandQualityGate(parsed.options);
    case "quality-baseline":
      return commandQualityBaseline(parsed.options);
    case "coverage-diff":
      return commandCoverageDiff(parsed.options);
    case "signoff":
      return commandSignoff(parsed.options);
    case "acceptance-verify":
      return commandAcceptanceVerify(parsed.options);
    case "red-proof-verify":
      return commandRedProofVerify(parsed.options);
    case "change-close":
      return commandChangeClose(parsed.options);
    case "adopt":
      return commandAdopt(parsed.options);
    case "quality-docs":
      return commandQualityDocs(parsed.options);
    case "hooks install":
      return commandHooks(parsed.options);
    case "help":
    case null:
    case undefined:
      return commandHelp();
    default:
      // Un subcomando desconocido salia 0 imprimiendo la ayuda: un typo en un
      // paso de CI se contabilizaba como exito.
      return {
        exitCode: EXIT_ERROR,
        payload: {
          status: "error",
          message: `Comando desconocido: ${parsed.command}`,
          help: commandHelp().payload.message
        }
      };
  }
}

export async function main(argv) {
  const parsed = parseArgs(argv);
  try {
    // `quality-gate` es asincrono (carga adapters del consumidor por import
    // dinamico); el resto de comandos sigue siendo sincrono y `await` sobre un
    // valor plano no cambia su comportamiento.
    const result = await run(argv);
    print(result.payload, parsed.json);
    process.exitCode = result.exitCode;
  } catch (error) {
    const payload = {
      status: "error",
      message: error.message,
      stack: process.env.SDLC_DEBUG ? error.stack : undefined
    };
    print(payload, parsed.json);
    process.exitCode = error.exitCode ?? EXIT_ERROR;
  }
}
