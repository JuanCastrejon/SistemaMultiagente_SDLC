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
  sha256FileNormalized,
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
  commandVerdict,
  auditAttestations
} from "./harness.js";
import {
  commandSkillEval,
  commandSkillPropose
} from "./eval-runner.js";
import { commandQualityGate, commandQualityBaseline } from "./quality.js";
import { baselineDoctorFindings } from "./quality-baseline.js";
import { loadQualityContract, probeAnchorDoctorFindings } from "./quality-adjudicate.js";
import { commandCoverageDiff } from "./coverage-diff.js";
import { computeTreeHashAtRef, evidencePath as evidencePathFor, recordAttestation } from "./evidence-writer.js";
import { buildSubject, createAttestationCommit, verifySignoff, worktreeDirtyForSurfaces } from "./signoff.js";
import { auditarAutorizacion } from "./authz-git.js";
import { verifyAcceptanceDir } from "./acceptance.js";
import { commandRedProofVerify } from "./red-proof.js";
import { verifyChangeClosure } from "./change-closure.js";
import { commandAdopt, detectCliLinked } from "./adopt.js";
import { commandQualityDocs } from "./quality-docs.js";
import { buildInstallPlan, runInstallPlan } from "./external-tools.js";
import { recordLesson, listLessons, promoteLesson, rejectLesson, DEFAULT_PROMOTION_THRESHOLD } from "./skill-lessons.js";
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
  // Se compara sobre contenido normalizado a LF, no sobre bytes crudos. El
  // manifiesto se versiona, y en Windows con `core.autocrlf=true` git lo
  // entrega en CRLF al hacer checkout: el hash cambiaba sin que nadie tocara el
  // archivo y `upgrade` quedaba bloqueado PARA SIEMPRE en ese repo, acusando
  // ademas una edicion manual que no existio. Reproducido en
  // manga-translator-mvp, donde impedia entregarle esta misma correccion.
  //
  // Se sigue aceptando el hash de bytes crudos: en un repo con finales LF los
  // dos coinciden, y asi ningun checksum ya escrito deja de validar.
  const actual = sha256FileNormalized(paths.manifest);
  const raw = sha256File(paths.manifest);
  const ok = expected === actual || expected === raw;
  return {
    ok,
    expected,
    actual,
    message: ok
      ? "Manifest integro"
      : "Manifest corrupto o editado manualmente: el contenido de .sdlc/install-manifest.json no coincide con .sdlc/install-manifest.sha256 (comparado con finales de linea normalizados, asi que CRLF no es la causa)"
  };
}

function writeManifest(target, manifest) {
  const paths = manifestPaths(target);
  writeJson(paths.manifest, manifest);
  writeText(paths.checksum, `${sha256FileNormalized(paths.manifest)}\n`);
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

// Strings compartidas entre `detectConflicts` y `commandUpgrade`: comparar
// literales sueltos en dos funciones fue justo lo que dejo pasar el bug de
// 2.0.2 (una tercera rama de `!pathExists` con su propio literal, invisible
// para el filtro que reconocia "modificado localmente"). Un solo lugar para
// los tres estados posibles de un archivo gestionado.
const CONFLICT_REASON = Object.freeze({
  UNMANAGED_EXISTING: "archivo preexistente no gestionado por SistemaMultiagente_SDLC",
  MANAGED_MODIFIED: "archivo gestionado modificado localmente",
  MANAGED_DELETED: "archivo gestionado eliminado localmente"
});

function detectConflicts(target, files, manifest) {
  const managed = getManagedPathSet(manifest);
  const overrides = overrideIndex(target);
  const conflicts = [];
  for (const [relativePath, content] of Object.entries(files)) {
    const absolute = path.join(target, relativePath);
    if (!pathExists(absolute)) {
      // Un archivo gestionado que el consumidor borro a proposito no debe
      // reaparecer en silencio. Si ya hay una eliminacion aceptada
      // (overrides.yaml con `deleted: true`) se respeta sin pedir nada de
      // nuevo; si no, se reporta como conflicto para que un `--accept-managed`
      // explicito lo confirme.
      const overrideEntry = overrides.get(relativePath);
      if (managed.has(relativePath) && !overrideEntry?.deleted) {
        conflicts.push({
          path: relativePath,
          reason: CONFLICT_REASON.MANAGED_DELETED,
          existingSha256: null,
          proposedSha256: sha256Text(content)
        });
      }
      continue;
    }
    const existing = normalizeLF(fs.readFileSync(absolute, "utf8"));
    if (existing === content) {
      continue;
    }
    if (!managed.has(relativePath)) {
      conflicts.push({
        path: relativePath,
        reason: CONFLICT_REASON.UNMANAGED_EXISTING,
        existingSha256: sha256Text(existing),
        proposedSha256: sha256Text(content)
      });
      continue;
    }
    const existingSha256 = sha256Text(existing);
    const manifestEntry = manifest.managedFiles.find((entry) => entry.path === relativePath);
    const overrideEntry = overrides.get(relativePath);
    // Un override vigente (el archivo en disco todavia coincide byte a byte
    // con lo que se acepto) SIEMPRE cuenta como conflicto, aunque tambien
    // coincida con el sha del manifiesto. El manifiesto guarda "lo ultimo
    // escrito", y tras aceptar un override eso ES el contenido del override:
    // comparar solo contra el manifiesto no distingue "sin cambios desde
    // instalacion" de "override vigente que hay que seguir preservando", asi
    // que un upgrade posterior que ni siquiera tocaba este archivo lo pisaba
    // en silencio con la plantilla nueva del framework (ver CHANGELOG 2.0.3).
    const matchesOverride = Boolean(overrideEntry) && overrideEntry.sha256 === existingSha256;
    const driftedFromManifest = Boolean(manifestEntry) && existingSha256 !== manifestEntry.sha256;
    if (driftedFromManifest || matchesOverride) {
      conflicts.push({
        path: relativePath,
        reason: CONFLICT_REASON.MANAGED_MODIFIED,
        existingSha256,
        expectedSha256: manifestEntry?.sha256 ?? null,
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
      // `deleted: true` marca una eliminacion deliberada del archivo gestionado
      // (no una divergencia de contenido). Sin este campo, `detectConflicts`
      // no puede distinguir "el consumidor lo borro a proposito" de "todavia
      // no existe", y la version 2.0.2 recreaba el archivo en el siguiente
      // upgrade.
      ...(entry.deleted ? { deleted: true } : {}),
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

  // El scaffold termina, pero la instalacion del sistema no: quedan las
  // herramientas externas. Antes el usuario se enteraba de que existian
  // corriendo `tools-doctor` por su cuenta, y aun asi solo veia "missing".
  // Aqui se le ofrece la lista completa —obligatorias y opcionales— con el
  // repo de cada una y el comando exacto, en el momento en que esta
  // instalando.
  //
  // Se OFRECE, no se instala: `install` sigue sin ejecutar software de
  // terceros (y sin `--with-tools` no toca nada), asi que sigue siendo apto
  // para CI y para un scaffold reproducible.
  const toolsOffer = buildToolsOffer(target, options);

  return {
    exitCode: EXIT_OK,
    payload: {
      status: "ok",
      message: "SistemaMultiagente_SDLC instalado.",
      backup,
      managedFiles: manifest.managedFiles.length,
      externalTools: toolsOffer
    }
  };
}

// Oferta de herramientas al cerrar el install. `--with-tools <ids|all>` instala
// las automatizables elegidas; sin el flag solo se informa.
function buildToolsOffer(target, options) {
  const doctor = commandToolsDoctor({ target });
  const detected = new Map((doctor.payload.tools ?? []).map((tool) => [tool.name, tool.status]));
  const plan = buildInstallPlan(target, { detected });
  if (!plan.ok) return { status: "unavailable", code: plan.code };

  const requested = String(options["with-tools"] ?? "").trim();
  const chosen = requested === "all"
    ? plan.installable.map((entry) => entry.id)
    : requested
      ? requested.split(",").map((value) => value.trim()).filter(Boolean)
      : [];

  const offer = {
    // Separadas por obligatoriedad, que es lo que el usuario necesita para
    // decidir: "opcional" a secas no le dice si puede seguir sin ella.
    required: [...plan.installable, ...plan.manualOnly]
      .filter((entry) => entry.required && entry.required !== false)
      .map((entry) => ({ id: entry.id, name: entry.name, required: entry.required, repo: entry.repo ?? null, command: entry.command ?? null, manual: entry.manual ?? null })),
    optional: [...plan.installable, ...plan.manualOnly]
      .filter((entry) => !entry.required || entry.required === false)
      .map((entry) => ({ id: entry.id, name: entry.name, repo: entry.repo ?? null, command: entry.command ?? null, manual: entry.manual ?? null })),
    alreadyPresent: plan.satisfied.map((entry) => entry.id),
    hint: "sdlc tools-install --target . --apply  (o --tool <id> --apply para una sola). Las marcadas como manuales se instalan desde su repo."
  };

  if (chosen.length === 0) return { status: "offered", applied: false, ...offer };

  const selected = { ...plan, installable: plan.installable.filter((entry) => chosen.includes(entry.id)) };
  const execution = runInstallPlan(target, selected, { apply: true });
  return { status: "offered", applied: true, results: execution.results, ...offer };
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
    const override = overrides.get(relativePath);
    if (existing === null) {
      // Una eliminacion aceptada (`overrides.yaml` con `deleted: true`, que
      // 2.0.3 introdujo del lado de `upgrade`) no es un archivo que falte:
      // es una divergencia declarada. Reportarla como `managed-file-missing`
      // dejaba al consumidor con un error permanente por haber usado el
      // mecanismo que el propio framework le ofrece para borrarlo.
      if (override?.deleted) {
        overridden.push({
          path: relativePath,
          actualSha256: null,
          acceptedSha256: null,
          reason: override.reason,
          deleted: true
        });
      } else {
        missing.push(relativePath);
      }
      continue;
    }
    // Hash sobre el contenido normalizado: detectConflicts hace lo mismo, y
    // en Windows el CRLF del working tree daria dos hashes distintos para el
    // mismo archivo segun quien lo mire.
    const actualSha256 = sha256Text(normalizeLF(existing));
    // El override se consulta ANTES de comparar contra la plantilla. Mientras
    // la comparacion iba primero, un archivo gestionado cuyo override habia
    // sido PISADO con la plantilla del framework coincidia con ella y no
    // producia ningun hallazgo: ni drift, ni override, ni stale. El registro
    // de `overrides.yaml` se evaporaba en silencio en vez de reportarse
    // obsoleto — que es exactamente lo que dejo el clobber de 2.0.2 invisible
    // para `doctor` en un consumidor real: dos specs canonicas de `openspec/`
    // pisadas el 2026-08-16 y no detectadas hasta el 2026-08-19, aun con su
    // entrada intacta en `overrides.yaml` apuntando a un sha ya inexistente.
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
    if (normalizeLF(existing) !== content) {
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
  // En WSL, `pwsh` a secas no resuelve: libuv busca el nombre literal en el
  // PATH y no prueba la extension `.exe` que el interop de WSL si ejecuta. Sin
  // el segundo intento, `doctor` reportaba `runtime-pwsh` en error en el
  // entorno POSIX declarado del proyecto, con PowerShell 7 instalado.
  for (const command of process.platform === "win32" ? ["pwsh", "powershell"] : ["pwsh", "pwsh.exe"]) {
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

// Nombres de skill que el manifiesto declara a proposito fuera de
// `.github/skills`: externas instaladas por npx (`externalCollections`) o
// espejadas entre stacks (`crossMirrorSkills`). Ninguna de las dos es una
// "canonica huerfana" — son la razon de ser de esos campos del manifiesto.
// Manifiesto ausente o ilegible ya se reporta aparte (`skill-manifest-missing`);
// aqui basta con no reventar y devolver el set vacio.
function readExternalSkillNames(manifestPath) {
  const names = new Set();
  const raw = readTextIfExists(manifestPath);
  if (!raw) return names;
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch {
    return names;
  }
  for (const collection of manifest.externalCollections ?? []) {
    for (const skill of collection.skills ?? []) {
      if (skill?.name) names.add(skill.name);
    }
  }
  for (const entry of manifest.crossMirrorSkills ?? []) {
    for (const name of entry.skills ?? []) {
      names.add(name);
    }
  }
  return names;
}

function collectDoctorEnhancements(target, config) {
  const findings = [];

  // Un repo recien instalado NO esta configurado, y tiene que verse asi. Antes
  // el instalador dejaba superficies y stack de ejemplo, el repo parecia listo,
  // y el precio se pagaba semanas despues: gates vacuos sobre paths que no
  // existen y una firma humana sobre el arbol vacio.
  if (config) {
    const surfaces = Array.isArray(config.surfaces) ? config.surfaces : [];
    if (surfaces.length === 0) {
      findings.push({
        level: "error",
        code: "config-surfaces-empty",
        message:
          "config.surfaces esta vacio: sin superficies declaradas ningun gate mide nada y `sdlc signoff` no puede atestar nada. " +
          "Declarar las superficies reales del repo en .sdlc/config.json y regenerar quality-contract.yaml."
      });
    }
    const placeholders = Object.entries(config.stack ?? {})
      .filter(([, value]) => typeof value === "string" && /^<.*>$/.test(value.trim()))
      .map(([key]) => key);
    if (placeholders.length > 0) {
      findings.push({
        level: "error",
        code: "config-stack-placeholder",
        fields: placeholders,
        message:
          `config.stack conserva placeholders de plantilla en: ${placeholders.join(", ")}. ` +
          "Poner la tecnologia real, o `null` si el proyecto no tiene esa superficie."
      });
    }
  }
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
    // Sin canonica no siempre es "huerfana": el manifiesto puede declararla a
    // proposito, como externa (`externalCollections`, instaladas por npx) o
    // como espejo cruzado (`crossMirrorSkills`, copiada entre stacks). Antes
    // este chequeo solo miraba `.github/skills` y avisaba de las dos por
    // igual — 76 avisos permanentes en un consumidor con un stack externo
    // real, indistinguibles de un espejo de verdad huerfano.
    const declaredExternalSkills = readExternalSkillNames(skillsManifest);
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
        if (!pathExists(canonical) && !declaredExternalSkills.has(entry.name)) {
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

async function commandDoctor(options) {
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
  // Toda atestacion declarada se re-verifica aqui, no solo cuando su fase llega
  // al gate. Una firma que dejo de valer —por una actualizacion que cambio el
  // formato del sujeto, o por un cambio posterior del contrato— se descubria
  // semanas despues, con el trabajo ya hecho.
  findings.push(...(await auditAttestations(target)).findings);
  // El eje de autorizacion (ADR 0008, G7). `doctor` REPORTA; quien adjudica es
  // `phase-gate` (D5). La severidad no es la misma en los dos: aqui una base
  // irresoluble es AVISO —un clon nuevo sin la rama remota es normal en la
  // maquina de quien desarrolla, y `doctor` no esta concediendo nada— y en el
  // gate bloquea.
  {
    const contratoCalidad = loadQualityContract(target);
    if (contratoCalidad.ok) {
      findings.push(...auditarAutorizacion(target, contratoCalidad.contract));
    } else {
      // Sin esta rama, un contrato ausente o ilegible dejaba el eje de
      // autorizacion en CERO hallazgos — indistinguible de "todo en orden".
      findings.push({
        level: "error",
        code: contratoCalidad.code,
        detail: `el eje de autorizacion no se pudo auditar: ${
          contratoCalidad.detail ?? "quality-contract.yaml no se puede leer"
        }. Sin contrato no hay superficies con las que auditar la obligacion`
      });
    }
  }
  findings.push(...baselineDoctorFindings(target));
  findings.push(...probeAnchorDoctorFindings(target));
  findings.push(...checkRetentionPolicy(target));
  const cliLinked = detectCliLinked(target);
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
 * recomputado sobre las superficies declaradas en quality-contract.yaml — nunca
 * se confia en un tree_hash que alguien declare por fuera, porque eso reabriria
 * exactamente el hueco que esto cierra (una firma que dice aprobar algo que
 * nadie recomputo).
 *
 * El arbol se lee de GIT, no del working tree, y en `--verify` se lee EN EL
 * COMMIT que se presenta como firma. Antes se leia del working tree en el
 * momento de la llamada, y eso hacia que la atestacion dejara de verificarse en
 * cuanto entraba el commit siguiente: no servia como registro de que una fase
 * se aprobo. Que el arbol se haya movido despues se reporta aparte, como
 * `fresh: false`, sin invalidar la firma.
 */
/**
 * Lo que hay que poder garantizar ANTES de crear un commit de atestacion con
 * `--record`: que exista evidencia de esa fase, que sea legible y que haya
 * maintainers con quien contrastar la firma. Ninguna de las tres cambia por
 * firmar, asi que comprobarlas despues solo sirve para dejar un commit
 * huerfano en la historia.
 */
function recordPreconditions(target, { slice, phase }) {
  let config;
  try {
    config = loadConfig(target);
  } catch (error) {
    return { ok: false, code: "config-missing", detail: error.message };
  }
  if ((config.governance?.maintainers ?? []).length === 0) {
    return {
      ok: false,
      code: "governance-maintainers-missing",
      detail: "config.governance.maintainers esta vacio: la firma no podria verificarse contra nadie, asi que no se crea"
    };
  }
  const evidenceAbsolute = evidencePathFor(target, slice, phase);
  const raw = readTextIfExists(evidenceAbsolute);
  if (!raw) {
    return {
      ok: false,
      code: "evidence-missing",
      detail: `no existe ${path.relative(target, evidenceAbsolute)}: escribir la evidencia de la fase antes de firmarla`
    };
  }
  try {
    YAML.parse(raw);
  } catch (error) {
    return { ok: false, code: "evidence-unparseable", detail: `${path.relative(target, evidenceAbsolute)}: ${error.message}` };
  }
  return { ok: true };
}

/**
 * Verifica un commit de atestacion ya existente y lo enlaza con su evidencia.
 * Comparte ruta de verificacion con el gate a proposito: enlazar algo que el
 * gate va a rechazar seria peor que no enlazarlo.
 */
function recordVerifiedAttestation(target, { slice, phase, surfacePaths, commitSha }) {
  if (!commitSha) {
    return { ok: false, code: "signoff-commit-missing", detail: "`--record` sin `--create` exige `--commit <sha>`" };
  }
  const ready = recordPreconditions(target, { slice, phase });
  if (!ready.ok) return ready;

  const config = loadConfig(target);
  const approved = computeTreeHashAtRef(target, surfacePaths, commitSha);
  if (!approved.ok) return { ok: false, code: approved.code, detail: approved.detail };

  const armado = buildSubject({ target, ref: commitSha, slice, phase, treeHash: approved.hash });
  if (!armado.ok) return { ok: false, code: armado.code, detail: armado.detail };

  const verification = verifySignoff({
    target,
    commitSha,
    subject: armado.subject,
    maintainers: config.governance?.maintainers ?? []
  });
  if (!verification.ok) {
    return { ok: false, code: verification.code, detail: `no se enlaza: ${verification.detail ?? verification.code}` };
  }

  const recorded = recordAttestation({ target, slice, phase, commitSha, signer: verification.signer });
  return recorded.ok ? { ...recorded, signer: verification.signer } : recorded;
}

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
  const headRef = options["head-ref"] ?? options.headRef ?? "HEAD";

  // `--record` sin `--create` enlaza un commit que YA existe y ya esta firmado.
  // Existe para el caso en que la firma se creo pero el enlace fallo despues
  // (disco lleno, YAML ilegible, interrupcion): obligar a firmar OTRA vez
  // dejaria dos commits de aprobacion para la misma cosa, y el segundo no seria
  // mas valido que el primero.
  if (options.record && !options.create) {
    const linked = recordVerifiedAttestation(target, {
      slice,
      phase,
      surfacePaths,
      commitSha: options.commit ?? null
    });
    return {
      exitCode: linked.ok ? EXIT_OK : EXIT_ACTION_REQUIRED,
      payload: linked.ok
        ? { status: "ok", recorded: true, commitSha: options.commit, evidence: linked.path, signer: linked.signer }
        : { status: "blocked", recorded: false, code: linked.code, detail: linked.detail }
    };
  }

  if (options.create) {
    // Precondiciones ANTES de firmar. El commit de atestacion es un efecto
    // secundario permanente en la historia: crearlo para descubrir despues que
    // la evidencia no existe deja un commit huerfano que nadie va a limpiar.
    // Lo barato se comprueba primero.
    if (options.record) {
      const ready = recordPreconditions(target, { slice, phase });
      if (!ready.ok) {
        return { exitCode: EXIT_ACTION_REQUIRED, payload: { status: "blocked", recorded: false, ...ready } };
      }
    }

    const tree = computeTreeHashAtRef(target, surfacePaths, "HEAD");
    if (!tree.ok) {
      return { exitCode: EXIT_ERROR, payload: { status: "error", code: tree.code, message: tree.detail } };
    }
    // El arbol sucio se comprueba ANTES de armar el sujeto: con cambios sin
    // commitear, el contrato tampoco esta en HEAD y `buildSubject` fallaria con
    // `contract-missing-at-ref`, escondiendo la causa real detras de un
    // sintoma. Quien tiene que commitear necesita enterarse de eso, no de dos
    // cosas a la vez.
    if (!Boolean(options["allow-dirty"] ?? options.allowDirty)) {
      const sucio = worktreeDirtyForSurfaces(target, surfacePaths);
      if (sucio.dirty) {
        return { exitCode: EXIT_ACTION_REQUIRED, payload: { status: "blocked", ok: false, code: sucio.code, detail: sucio.detail } };
      }
    }
    const armado = buildSubject({ target, ref: "HEAD", slice, phase, treeHash: tree.hash });
    if (!armado.ok) {
      return { exitCode: EXIT_ERROR, payload: { status: "error", code: armado.code, message: armado.detail } };
    }
    const subject = armado.subject;
    const created = createAttestationCommit({
      target,
      slice,
      phase,
      subject,
      signingKey: options["signing-key"] ?? options.signingKey ?? null,
      surfacePaths,
      allowDirty: Boolean(options["allow-dirty"] ?? options.allowDirty)
    });
    if (!created.ok) {
      const exitCode = created.code === "signoff-commit-failed" ? EXIT_ERROR : EXIT_ACTION_REQUIRED;
      return { exitCode, payload: { status: created.code === "signoff-commit-failed" ? "error" : "blocked", ...created, subject } };
    }

    // `--record` enlaza la firma recien creada con la evidencia de su fase.
    // Sin este paso, `signoff --create` deja el commit hecho y la evidencia
    // apuntando a la firma ANTERIOR: el gate sigue bloqueando y la reparacion
    // parece hecha. Se descubrio auditando la propia migracion de 2.0.0, donde
    // `attestation_commit` solo existia como campo LEIDO y nada lo escribia.
    if (options.record) {
      let recordConfig;
      try {
        recordConfig = loadConfig(target);
      } catch (error) {
        return { exitCode: error.exitCode ?? EXIT_ERROR, payload: { status: "error", message: error.message, ...created } };
      }
      // Se verifica por la MISMA ruta que usara el gate, y ANTES de escribir:
      // enlazar una firma que no verifica seria afirmar una garantia inexistente.
      const approved = computeTreeHashAtRef(target, surfacePaths, created.commitSha);
      const rearmado = approved.ok
        ? buildSubject({ target, ref: created.commitSha, slice, phase, treeHash: approved.hash })
        : { ok: false, code: approved.code, detail: approved.detail };
      const verification = rearmado.ok
        ? verifySignoff({
            target,
            commitSha: created.commitSha,
            subject: rearmado.subject,
            maintainers: recordConfig.governance?.maintainers ?? []
          })
        : { ok: false, code: rearmado.code, detail: rearmado.detail };
      if (!verification.ok) {
        return {
          exitCode: EXIT_ACTION_REQUIRED,
          payload: {
            status: "blocked",
            ...created,
            subject,
            recorded: false,
            code: verification.code,
            detail: `el commit se creo pero NO se enlazo con la evidencia: ${verification.detail ?? verification.code}`
          }
        };
      }
      // `approved_by` sale del firmante que reporta git, nunca de una opcion.
      const recorded = recordAttestation({
        target,
        slice,
        phase,
        commitSha: created.commitSha,
        signer: verification.signer
      });
      if (!recorded.ok) {
        return {
          exitCode: EXIT_ACTION_REQUIRED,
          payload: { status: "blocked", ...created, subject, recorded: false, code: recorded.code, detail: recorded.detail }
        };
      }
      return {
        exitCode: EXIT_OK,
        payload: { status: "ok", ...created, subject, files: tree.files, recorded: true, evidence: recorded.path, signer: verification.signer }
      };
    }

    return { exitCode: EXIT_OK, payload: { status: "ok", ...created, subject, files: tree.files } };
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
    const commitSha = options.commit ?? null;
    if (!commitSha) {
      return {
        exitCode: EXIT_ACTION_REQUIRED,
        payload: { status: "blocked", ok: false, code: "signoff-commit-missing", detail: "no se declaro que commit firma la aprobacion" }
      };
    }
    const approved = computeTreeHashAtRef(target, surfacePaths, commitSha);
    if (!approved.ok) {
      return { exitCode: EXIT_ERROR, payload: { status: "error", code: approved.code, message: approved.detail } };
    }
    const current = computeTreeHashAtRef(target, surfacePaths, headRef);
    const armadoVerify = buildSubject({ target, ref: commitSha, slice, phase, treeHash: approved.hash });
    if (!armadoVerify.ok) {
      return { exitCode: EXIT_ERROR, payload: { status: "error", code: armadoVerify.code, message: armadoVerify.detail } };
    }
    const subject = armadoVerify.subject;
    const result = verifySignoff({
      target,
      commitSha,
      subject,
      maintainers,
      headRef,
      currentTreeHash: current.ok ? current.hash : null
    });
    // Una firma valida sobre un arbol que ya se movio NO es un fallo de firma:
    // es una aprobacion que quedo atras. Se distingue con `--require-fresh`,
    // que es lo que debe usar el gate de la fase que aprueba esas superficies.
    const requireFresh = Boolean(options["require-fresh"] ?? options.requireFresh);
    if (result.ok && requireFresh && result.fresh === false) {
      return {
        exitCode: EXIT_ACTION_REQUIRED,
        payload: {
          status: "blocked",
          ...result,
          ok: false,
          code: "signoff-stale",
          detail: `la firma es valida pero aprobo el arbol ${subject.tree_hash.slice(0, 12)} y ${headRef} esta en ${String(current.hash).slice(0, 12)}: hay que volver a firmar`,
          subject
        }
      };
    }
    return { exitCode: result.ok ? EXIT_OK : EXIT_ACTION_REQUIRED, payload: { status: result.ok ? "ok" : "blocked", ...result, subject } };
  }

  return {
    exitCode: EXIT_ERROR,
    payload: {
      status: "error",
      message:
        "Uso: sdlc signoff --slice <id> --phase <F> <--create [--record] [--signing-key <id>] [--allow-dirty] | --verify --commit <sha> [--head-ref <ref>] [--require-fresh]>\n" +
        "  --record enlaza la firma con la evidencia de la fase. Sin el, el commit firmado existe pero\n" +
        "  la evidencia sigue apuntando a la anterior y el gate sigue bloqueando."
    }
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

async function commandUpgrade(options) {
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
  // A diferencia de `install`, `upgrade` lee `nextConfig` de `.sdlc/config.json`
  // en disco -- un archivo que spec-boundary-guard NO protege. `buildManagedFiles`
  // interpola sus campos (project.name, gitFlow.*, etc.) como texto crudo dentro
  // de YAML/comentarios (`template-loader.js: interpolate`), sin escapar. Sin este
  // chequeo, un `project.name` con un salto de linea inyectaba una key YAML real
  // (`enforcement: block`) en quality-contract.yaml -- el mismo archivo que
  // spec-boundary-guard bloquea editar directamente, alcanzado por la puerta de
  // al lado. Reproducido con PoC antes de este fix.
  const configErrors = validateConfigShape(nextConfig);
  if (configErrors.length > 0) {
    return { exitCode: EXIT_ERROR, payload: { status: "error", errors: configErrors } };
  }
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
    const isDeletion = conflict.reason === CONFLICT_REASON.MANAGED_DELETED;
    const isAcceptable = isDeletion || conflict.reason === CONFLICT_REASON.MANAGED_MODIFIED;
    const overrideEntry = alreadyOverridden.get(conflict.path);
    // Para una eliminacion, "ya aceptado antes" se decide por el flag
    // `deleted`, no por sha256 (no hay contenido que hashear). Para una
    // divergencia de contenido, por el sha256 aceptado la ultima vez.
    const previouslyAccepted = isDeletion
      ? Boolean(overrideEntry?.deleted)
      : overrideEntry?.sha256 === conflict.existingSha256;
    if (isAcceptable && (acceptAll || acceptRequested.has(conflict.path) || previouslyAccepted)) {
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
        acceptable: blocking
          .filter((conflict) => conflict.reason === CONFLICT_REASON.MANAGED_MODIFIED || conflict.reason === CONFLICT_REASON.MANAGED_DELETED)
          .map((conflict) => conflict.path),
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

  // Barrido de tombstones ya registrados en overrides.yaml de corridas
  // anteriores. Una eliminacion aceptada saca el path del manifiesto (deja de
  // estar "managed"), asi que en la corrida SIGUIENTE `detectConflicts` ya no
  // tiene nada que conflictuar para el -- pero sin este barrido, no haber
  // conflicto significaba "escribilo", y `writeManagedFiles` lo recreaba de
  // todos modos. Solo aplica si el archivo sigue ausente: si el consumidor lo
  // recreo a mano por su cuenta, eso se trata como un archivo no gestionado
  // normal, no se vuelve a pisar en silencio.
  for (const [overridePath, entry] of alreadyOverridden) {
    if (entry?.deleted && !pathExists(path.join(target, overridePath))) {
      delete effectiveFiles[overridePath];
    }
  }

  const overrideEntries = [];
  for (const conflict of accepted) {
    if (conflict.reason === CONFLICT_REASON.MANAGED_DELETED) {
      // Se respeta la eliminacion: el path sale del set de archivos
      // gestionados que se va a escribir (si se quedara con la plantilla
      // fresca en `effectiveFiles`, `writeManagedFiles` lo recrearia) y el
      // manifiesto deja de rastrearlo. `overrides.yaml` conserva el registro
      // de que fue una decision, no un olvido.
      delete effectiveFiles[conflict.path];
      overrideEntries.push({
        path: conflict.path,
        sha256: null,
        deleted: true,
        reason: alreadyOverridden.get(conflict.path)?.reason ?? "eliminacion local aceptada en upgrade"
      });
      continue;
    }
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

  // La auditoria corre DESPUES de escribir, no antes, y a proposito: los
  // archivos nuevos son justamente los que hacen falta para poder re-firmar.
  // Pero el upgrade no puede terminar en verde dejando atestaciones muertas: el
  // consumidor se enteraria al llegar al siguiente gate humano, semanas
  // despues. Sale `action-required` con la lista y el comando de reparacion.
  const attestations = await auditAttestations(target);
  // Un `unverifiable` cuenta igual que un `invalid` para decidir si el upgrade
  // puede terminar en verde. Filtrar solo por `level === "error"` dejaba pasar
  // como exito un repo cuyas atestaciones nadie habia podido comprobar, que es
  // justo el estado que esta auditoria existe para no dejar pasar.
  const pendientes = attestations.findings.filter((finding) => finding.verdict !== undefined);
  const invalidas = pendientes.filter((finding) => finding.verdict === "invalid").length;
  const noVerificables = pendientes.filter((finding) => finding.verdict === "unverifiable").length;
  // El eje de autorizacion (G7): en `upgrade` los errores son ACCION REQUERIDA,
  // no aviso. Actualizar y quedarse con superficies sin clasificar deja al
  // consumidor con un bloqueo esperandolo en su siguiente gate humano, y
  // enterarse ahi —con el trabajo hecho— es exactamente lo que la auditoria de
  // atestaciones de 2.0.0 vino a evitar para las firmas.
  const contratoTrasUpgrade = loadQualityContract(target);
  // Con el contrato ilegible tras la migracion, la lista vacia dejaba el eje
  // fuera del payload — y un eje ausente no puede contribuir a `action-required`
  // justo en el comando que existe para decirlo.
  const autorizacion = contratoTrasUpgrade.ok
    ? auditarAutorizacion(target, contratoTrasUpgrade.contract)
    : [
        {
          level: "error",
          code: contratoTrasUpgrade.code,
          detail: `el eje de autorizacion no se pudo auditar tras la migracion: ${
            contratoTrasUpgrade.detail ?? "quality-contract.yaml no se puede leer"
          }`
        }
      ];
  const autorizacionBloqueante = autorizacion.filter((finding) => finding.level === "error");
  const bloqueado = pendientes.length > 0 || autorizacionBloqueante.length > 0;
  return {
    exitCode: bloqueado ? EXIT_ACTION_REQUIRED : EXIT_OK,
    payload: {
      status: bloqueado ? "action-required" : "ok",
      backup,
      frameworkVersion: nextManifest.frameworkVersion,
      accepted: overrideEntries.map((entry) => entry.path),
      ...(attestations.checked > 0 ? { attestations } : {}),
      ...(autorizacion.length > 0 ? { authorization: autorizacion } : {}),
      ...(bloqueado
        ? {
            // Se dice lo que de verdad paso: la migracion se aplico y lo que
            // queda pendiente es la autorizacion. Presentarlo como "upgrade
            // fallido" mandaria a revertir una migracion sana.
            message:
              `Migracion aplicada; autorizacion PENDIENTE. ${invalidas} atestacion(es) dejaron de verificar y ` +
              `${noVerificables} no se pudieron comprobar. Hasta resolverlas, esas fases no pueden pasar su gate ` +
              "humano. Ver `attestations.findings[].hint` para la accion de cada una."
          }
        : {})
    }
  };
}

// `sdlc tools-install` (ADR 0007)
//
// Cierra el hueco que dejaba `tools-doctor`: decia que faltaba algo, no como
// conseguirlo. Aqui se reune el inventario con lo que el doctor ya detecta y
// se produce un plan.
//
// DRY-RUN POR DEFECTO, y no es un detalle de ergonomia: instalar software de
// terceros no puede ser un efecto secundario de pedir un diagnostico. Sin
// `--apply` se imprime exactamente que se correria y no se ejecuta nada.
function commandToolsInstall(options) {
  const target = requireTarget(options);
  const apply = Boolean(options.apply);
  const only = options.tool ?? null;

  // Se reutiliza la deteccion de `tools-doctor` en vez de reimplementarla: dos
  // criterios distintos para "esta instalada" acabarian contestando cosas
  // distintas sobre el mismo repo, que es exactamente lo que costo caro en
  // `detectCliLinked`.
  const doctor = commandToolsDoctor({ ...options, target });
  const detected = new Map((doctor.payload.tools ?? []).map((tool) => [tool.name, tool.status]));

  const plan = buildInstallPlan(target, { detected, only });
  if (!plan.ok) {
    return { exitCode: EXIT_ERROR, payload: { status: "error", ...plan } };
  }

  const execution = runInstallPlan(target, plan, { apply });
  const failed = execution.results.filter((result) => result.status === "failed");
  const pendingRequired = [...plan.installable, ...plan.manualOnly].filter((entry) => entry.required === true);

  return {
    exitCode: failed.length > 0 ? EXIT_ERROR : EXIT_OK,
    payload: {
      status: failed.length > 0 ? "error" : "ok",
      applied: execution.applied,
      inventory: plan.path,
      // Los tres grupos separados: mezclarlos es lo que hacia imposible saber
      // cuales faltan de verdad y cuales exigen a una persona.
      installable: plan.installable.map((entry) => ({
        id: entry.id,
        name: entry.name,
        required: entry.required,
        purpose: entry.purpose,
        command: entry.command
      })),
      manualOnly: plan.manualOnly,
      satisfied: plan.satisfied.map((entry) => entry.id),
      results: execution.results,
      ...(pendingRequired.length > 0 ? { pendingRequired: pendingRequired.map((entry) => entry.id) } : {}),
      hint: execution.applied
        ? "los pasos marcados como manuales siguen pendientes: los hace una persona, no este comando"
        : "dry-run: nada se ejecuto. Repetir con --apply para instalar lo automatizable."
    }
  };
}

// `sdlc skill-lesson` (ADR 025 del consumidor: skills vivas)
//
// Captura el disparador que faltaba: un error, un bloqueo o una tarea que ya
// se hizo tres veces. Ese conocimiento hoy se pierde en el chat y el siguiente
// agente tropieza con la misma piedra.
//
// Una leccion es EVIDENCIA de que hace falta una skill, no la skill. Promover
// escribe una propuesta bajo `openspec/changes/` y nunca toca `.github/skills/`
// (restriccion 1 del ADR 025); aprobar sigue siendo humano.
function commandSkillLesson(options) {
  const target = requireTarget(options);
  const threshold = Number(options.threshold ?? DEFAULT_PROMOTION_THRESHOLD);

  if (options.promote) {
    const result = promoteLesson(target, String(options.promote), {
      change: options.change ?? null,
      threshold,
      force: Boolean(options.force)
    });
    return { exitCode: result.ok ? EXIT_OK : EXIT_ERROR, payload: { status: result.ok ? "ok" : "error", ...result } };
  }

  if (options.reject) {
    const result = rejectLesson(target, String(options.reject), { reason: options.reason ?? null });
    return { exitCode: result.ok ? EXIT_OK : EXIT_ERROR, payload: { status: result.ok ? "ok" : "error", ...result } };
  }

  if (options.record) {
    const result = recordLesson(target, {
      type: options.type ?? null,
      title: options.title ?? (typeof options.record === "string" ? options.record : null),
      detail: options.detail ?? null,
      correction: options.correction ?? null,
      skill: options.skill ?? null
    });
    return {
      exitCode: result.ok ? EXIT_OK : EXIT_ERROR,
      payload: {
        status: result.ok ? "ok" : "error",
        ...result,
        ...(result.ok && result.repeated
          ? { hint: `ya habia pasado: van ${result.lesson.occurrences} veces. Con ${threshold} se puede promover a propuesta de skill.` }
          : {})
      }
    };
  }

  const listed = listLessons(target, { threshold });
  return {
    exitCode: listed.ok ? EXIT_OK : EXIT_ERROR,
    payload: {
      status: listed.ok ? "ok" : "error",
      ...listed,
      hint: "sdlc skill-lesson --record --type <error|blocker|repetition> --title <t> --correction <que hacer la proxima vez> [--skill <id>]"
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
    writeText(path.join(target, ".sdlc", "install-manifest.sha256"), `${sha256FileNormalized(path.join(target, ".sdlc", "install-manifest.json"))}\n`);
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
      message: "Uso: sdlc <init|install|upgrade|rollback|doctor|diff|prune-backups|migrate-config|session-start|resume|save|continua|memory-sync|validate-runtime|phase-gate|governance-check|tools-doctor|pr-body-check|verdict|status|quality-gate|quality-baseline|coverage-diff|signoff|acceptance-verify|red-proof-verify|change-close|adopt|quality-docs|hooks install> [--target <repo>] [--json]\nSi --target se omite, se usa el directorio actual (process.cwd()).\nverdict: veredicto READY/NOT-READY ordenado fail-fast [--write --slice --phase]\nstatus:  snapshot go/no-go agregado [--markdown --write --exit-code]\nupgrade: [--to-version <v>] [--dry-run] [--accept-managed <paths,coma>] [--accept-all-managed]\n         Los archivos aceptados conservan su version local y quedan registrados en .sdlc/overrides.yaml.\nquality-gate: --slice <id> --phase <F> <--run | --from-evidence> [--exit-code]\n         --run ejecuta los probes de quality-contract.yaml y anexa la evidencia medida.\n         --from-evidence solo adjudica lo ya escrito y se marca advisory.\nquality-baseline: --promote --slice <id> [--phase F15] [--source ci|local] [--allow-local]\n         Mueve la linea base de los gates ratchet a la evidencia de una fase ya escrita.\n         Sin --source ci exige --allow-local explicito.\ncoverage-diff: [--base-ref <ref>] [--coverage-final <ruta>] [--summary <ruta>]\n         Cruza git diff contra coverage-final.json y escribe `changed.pct/total` en coverage-summary.json.\n         Se encadena despues del test runner, antes de quality-gate --run.\nsignoff: --slice <id> --phase <F> <--create [--signing-key <id>] [--allow-dirty] [--record] | --verify --commit <sha> [--head-ref <ref>] [--require-fresh]>\n         El sujeto (slice+phase+tree_hash de las superficies) se recomputa siempre, nunca se recibe declarado.\n         El arbol se lee de git EN EL COMMIT firmado, no del working tree: la firma se puede volver a\n         verificar mas adelante en lugar de caducar con el commit siguiente.\n         --require-fresh bloquea ademas si el arbol de --head-ref ya no es el aprobado (signoff-stale).\n         --create rechaza firmar con cambios sin commitear en las superficies, salvo --allow-dirty.\n         Ninguna superficie que resuelva a cero archivos puede firmarse ni verificarse (signoff-empty-subject).\n         --verify exige config.governance.maintainers no vacio: sin maintainers ninguna firma es valida.\nacceptance-verify: --change <slug>\n         Verifica openspec/changes/<slug>/acceptance/*.feature.md: cada escenario debe traer sc_id\n         cuyo hash coincida con (capability, requirement, titulo) actuales.\nred-proof-verify: --slice <id> [--phase F5] --report <ruta> --format <formato>\n         Todo escenario en scenario_traceability con status:red exige que el reporte declare\n         outcome:assertion-failed. Un error colateral (import roto, throw arbitrario) no da credito.\n         ADVISORY, no autoritativo: no consume red_proof_run_id ni red_proof_sha, asi que\n         adjudica un reporte que produce el propio evaluado. `ok` = no se detecto trampa,\n         no 'el rojo quedo demostrado'. Opt-in: ningun workflow lo invoca por defecto.\nchange-close: --change <slug> [--slice <id>] [--integration-branch <rama>]\n         Ninguna tarea de tasks.md puede quedar sin marcar; una tarea de merge marcada [x]\n         exige que HEAD sea antepasado real de la rama de integracion; F13/F14 deben estar en ok.\nadopt: [--project-name <nombre>] [--bootstrap-package-json]\n         Aditivo puro: nunca sobreescribe lo que ya existe. Agrega sistema-multiagente-sdlc como\n         devDependency (nunca npm link), .sdlc/config.json minimo, quality-contract.yaml,\n         phase-contract.yaml y su schema, solo los que falten.\n         --bootstrap-package-json crea un package.json minimo cuando el repo no tiene ninguno\n         (raiz plana, sin build). Sin esa bandera, adopt sigue exigiendo uno previo.\ninstall: [--mode greenfield|legacy] [--project-name <n>] [--dry-run] [--with-tools <ids|all>]\n         Al terminar OFRECE las herramientas externas (obligatorias y opcionales) con el repo\n         de cada una y su comando. Sin --with-tools no instala ninguna: sigue apto para CI.\ntools-install: [--tool <id>] [--apply]\n         Cruza el inventario external-tools.yaml con lo que tools-doctor detecta y arma un plan.\n         DRY-RUN por defecto: sin --apply no ejecuta nada, solo imprime que correria.\n         Separa lo instalable de lo que exige un paso manual (una persona), y nunca corre\n         durante `sdlc install`. Los comandos son argv, no cadenas de shell, y su ejecutable\n         debe estar en la allowlist del inventario.\nquality-docs: [--out docs/quality-gates.md] [--dry-run] [--check]\n         Regenera la doc de tiers/superficies/probes/gates desde quality-contract.yaml y\n         phase-contract.yaml. No se edita a mano: se sobreescribe en cada corrida.\n         --check no escribe: compara la doc comiteada con el contrato actual y sale 2 si\n         divergen. Es el modo para CI; sin el, una doc desactualizada es indetectable."
    }
  };
}

// `run` es SIEMPRE asincrona aunque casi todos los comandos sean sincronos.
// Devolver "objeto o Promise segun el comando" es un contrato que rompe en
// silencio a cualquier consumidor programatico el dia que un comando mas se
// vuelve async — y ya paso con `doctor` y `upgrade`.
export async function run(argv) {
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
    case "tools-install":
      return commandToolsInstall(parsed.options);
    case "skill-lesson":
      return commandSkillLesson(parsed.options);
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
