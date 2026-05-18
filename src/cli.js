import fs from "node:fs";
import path from "node:path";
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
  result.command = positionals[0] ?? "help";
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
    const error = new Error("Falta --target <repo>");
    error.exitCode = EXIT_ERROR;
    throw error;
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

function writeManagedFiles(target, files, config, previousManifest = null) {
  for (const [relativePath, content] of Object.entries(files)) {
    writeText(path.join(target, relativePath), content);
  }
  const manifest = buildManifest(config, files, previousManifest ?? {});
  writeManifest(target, manifest);
  return manifest;
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
  for (const [relativePath, content] of Object.entries(files)) {
    const absolute = path.join(target, relativePath);
    const existing = readTextIfExists(absolute);
    if (existing === null) {
      missing.push(relativePath);
      continue;
    }
    if (normalizeLF(existing) !== content) {
      drift.push({
        path: relativePath,
        actualSha256: sha256Text(existing),
        expectedSha256: sha256Text(content)
      });
    }
  }
  const managedPathSet = getManagedPathSet(manifest);
  const unmanaged = Object.keys(files).filter((filePath) => !managedPathSet.has(filePath));
  return { files, drift, missing, unmanaged };
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
  if (toVersion !== "1.0.0" && toVersion !== "1.0.1") {
    return { exitCode: EXIT_ERROR, payload: { status: "error", message: `Version no soportada: ${toVersion}` } };
  }
  const nextConfig = { ...config, frameworkVersion: toVersion };
  const files = buildManagedFiles(nextConfig);
  const conflicts = detectConflicts(target, files, manifest);
  if (conflicts.length > 0) {
    if (!dryRun) {
      createBackup(target, [".sdlc/patch-plan.json"], "patch-plan-conflict");
    }
    const patchPlan = dryRun ? { conflicts, proposedFiles: Object.keys(files).sort() } : writePatchPlan(target, conflicts, files);
    return { exitCode: EXIT_ACTION_REQUIRED, payload: { status: "conflict", conflicts, patchPlan } };
  }
  if (dryRun) {
    return { exitCode: EXIT_OK, payload: { status: "ok", message: `Dry-run upgrade a ${toVersion}` } };
  }
  const backup = createBackup(target, [...new Set([...Object.keys(files), ...manifest.managedFiles.map((entry) => entry.path)])], "upgrade");
  const nextManifest = writeManagedFiles(target, files, nextConfig, {
    ...manifest,
    migrationsApplied: toVersion === "1.0.1"
      ? [...new Set([...(manifest.migrationsApplied ?? []), "1.0.1"])]
      : manifest.migrationsApplied ?? []
  });
  pruneBackupsInternal(target, nextConfig.backup?.keepLast ?? 5);
  return { exitCode: EXIT_OK, payload: { status: "ok", backup, frameworkVersion: nextManifest.frameworkVersion } };
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
      message: "Uso: sdlc <install|upgrade|rollback|doctor|diff|prune-backups|migrate-config> --target <repo> [--json]"
    }
  };
}

export function run(argv) {
  const parsed = parseArgs(argv);
  switch (parsed.command) {
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
    case "help":
    default:
      return commandHelp();
  }
}

export function main(argv) {
  const parsed = parseArgs(argv);
  try {
    const result = run(argv);
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
