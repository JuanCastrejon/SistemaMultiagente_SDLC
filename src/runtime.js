import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ensureDir, pathExists, readJson, readTextIfExists, writeJson, writeText } from "./file-utils.js";
import { assertShellSafeToken, evaluatePhaseReadiness } from "./harness.js";

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_ACTION_REQUIRED = 2;

function nowIso() {
  return new Date().toISOString();
}

function expandEnv(value) {
  if (!value || typeof value !== "string") return value;
  return value
    .replace(/%([^%]+)%/g, (_, name) => process.env[name] ?? `%${name}%`)
    .replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? `\${${name}}`);
}

function safeReadJson(filePath) {
  try {
    return pathExists(filePath) ? readJson(filePath) : null;
  } catch {
    return null;
  }
}

function getConfig(target) {
  return safeReadJson(path.join(target, ".sdlc", "config.json")) ?? {};
}

function getProjectSlug(target, config = getConfig(target)) {
  return config.project?.slug || path.basename(path.resolve(target)).toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

// Misma politica que en src/harness.js: en Windows el shell es obligatorio para
// ejecutar `.cmd`, asi que los tokens con metacaracteres se rechazan en vez de
// escaparse. Ver assertShellSafeToken.
function runCommand(command, args = [], cwd = process.cwd(), timeout = 8000) {
  const windowsShell = process.platform === "win32";
  if (windowsShell) {
    assertShellSafeToken(command, "comando");
    for (const arg of args) {
      assertShellSafeToken(arg, "argumento");
    }
  }
  const quoteWindowsArg = (value) => {
    const text = String(value);
    return /\s/.test(text) ? `"${text}"` : text;
  };
  const result = windowsShell
    ? spawnSync([command, ...args].map(quoteWindowsArg).join(" "), {
        cwd,
        encoding: "utf8",
        shell: true,
        timeout
      })
    : spawnSync(command, args, {
        cwd,
        encoding: "utf8",
        timeout
      });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
    error: result.error?.message
  };
}

function checkHttp(url, timeoutMs = 1200) {
  const code = `
    const url = ${JSON.stringify(url)};
    const timeout = ${Number(timeoutMs)};
    const signal = AbortSignal.timeout(timeout);
    fetch(url, { signal })
      .then((res) => process.exit(res.ok ? 0 : 2))
      .catch(() => process.exit(1));
  `;
  const result = spawnSync(process.execPath, ["-e", code], { encoding: "utf8", timeout: timeoutMs + 1000 });
  return result.status === 0;
}

function fileAgeHours(filePath) {
  if (!pathExists(filePath)) return null;
  return Math.round(((Date.now() - fs.statSync(filePath).mtimeMs) / 36_000) / 100) / 100;
}

function filesByRecency(root, extension = ".md") {
  if (!pathExists(root)) return [];
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.name.endsWith(extension)) {
        files.push(absolute);
      }
    }
  };
  walk(root);
  return files
    .map((file) => ({ file, mtime: fs.statSync(file).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .map((entry) => entry.file);
}

function latestFile(root, extension = ".md") {
  return filesByRecency(root, extension)[0] ?? null;
}

/**
 * No todos los checkpoints del vault valen lo mismo, y el mas reciente casi
 * nunca es el que sirve.
 *
 * El hook `post-merge` corre `sdlc save` en CADA merge, asi que deja un
 * esqueleto con las cinco secciones narrativas en `_(pendiente de redactar)_`
 * y con marca de tiempo POSTERIOR a la del checkpoint que alguien acababa de
 * redactar. Medido en un repo consumidor el 2026-08-24: 35 checkpoints ese dia,
 * 34 esqueletos y 1 redactado.
 *
 * El defecto no era no saber distinguirlos: `analyzeCheckpointNarrative` ya
 * existia y `resume` ya imprimia "sin redactar". Era que la distincion no se
 * usaba para ELEGIR, asi que la deteccion informaba de un problema que el
 * mismo comando seguia cometiendo. Aqui se usa.
 *
 * `usable` = el mas reciente con la narrativa completa. `skipped` = los
 * esqueletos que quedaron por encima de el.
 */
function classifyCheckpoints(root) {
  const files = filesByRecency(root);
  const skipped = [];
  for (const file of files) {
    const body = readTextIfExists(file);
    if (body && analyzeCheckpointNarrative(body).complete) {
      return { latest: files[0] ?? null, usable: file, skipped };
    }
    skipped.push(file);
  }
  return { latest: files[0] ?? null, usable: null, skipped };
}

function vaultSection(memory) {
  const checkpoints = classifyCheckpoints(memory.checkpointsDir);
  return {
    configPath: memory.configPath,
    root: memory.vaultRoot,
    exists: pathExists(memory.vaultRoot),
    latestCheckpoint: checkpoints.latest ?? latestFile(path.join(memory.projectRoot, "logs")),
    // El que de verdad se puede retomar. Se expone aparte en vez de pisar
    // `latestCheckpoint` porque las dos cosas son distintas y ambas importan:
    // una dice que hay que redactar, la otra donde esta el contexto.
    usableCheckpoint: checkpoints.usable,
    skeletonsSinceUsable: checkpoints.usable ? checkpoints.skipped.length : 0
  };
}

function preview(text, max = 900) {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max).trim()}...` : clean;
}

function resolveMemoryConfig(target) {
  const localPath = path.join(target, "scripts", "obsidian-memory.config.local.json");
  const examplePath = path.join(target, "scripts", "obsidian-memory.config.example.json");
  const configPath = pathExists(localPath) ? localPath : pathExists(examplePath) ? examplePath : null;
  const config = configPath ? safeReadJson(configPath) : null;
  const projectSlug = config?.projectSlug || getProjectSlug(target);
  const rawVault = config?.vaultRoot || config?.obsidian?.vaultPath;
  // Un vaultRoot relativo se resuelve contra el repo destino, no contra el cwd
  // del proceso: al invocar el CLI desde otro directorio, path.resolve() a secas
  // producia rutas inexistentes y un warning vault-missing enganoso.
  const expandedRaw = rawVault && !String(rawVault).includes("{{") ? expandEnv(String(rawVault)) : null;

  // `expandEnv` devuelve el placeholder LITERAL cuando la variable no existe
  // en el entorno (`${MEMORY_WORKSPACE}` sigue siendo `${MEMORY_WORKSPACE}`), y
  // nadie lo comprobaba despues. El config que genera `install` trae justamente
  // esos marcadores a proposito —`validate:no-personal-paths` impide poner una
  // ruta real ahi— asi que en un repo recien instalado el vault "resolvia" a un
  // directorio llamado `${MEMORY_WORKSPACE}`.
  //
  // Reproducido: `sdlc save` creaba
  // `<repo>/${MEMORY_WORKSPACE}/vault/<slug>/checkpoints/...`. El usuario cree
  // que su checkpoint esta en el vault y esta en un directorio basura dentro del
  // repo. Un marcador sin resolver tiene que BLOQUEAR el uso de ese valor, no
  // viajar como si fuera una ruta.
  const unresolvedPlaceholder = expandedRaw && /\$\{[^}]+\}|%[^%]+%/.test(expandedRaw) ? expandedRaw : null;
  const expandedVault = unresolvedPlaceholder ? null : expandedRaw;

  const vaultRoot = expandedVault
    ? (path.isAbsolute(expandedVault) ? expandedVault : path.resolve(target, expandedVault))
    : path.join(target, ".sdlc", "vault");
  return {
    configPath,
    config,
    projectSlug,
    vaultRoot,
    // Se reporta la degradacion en vez de ocurrir en silencio: quien lea el
    // payload tiene que poder saber que su vault NO esta configurado y que el
    // checkpoint fue a parar al fallback local.
    ...(unresolvedPlaceholder
      ? {
          vaultUnresolved: {
            declared: unresolvedPlaceholder,
            reason: "el vault declarado contiene un marcador sin resolver; se usa .sdlc/vault local",
            hint: "definir la variable de entorno, o poner una ruta real en scripts/obsidian-memory.config.local.json"
          }
        }
      : {}),
    projectRoot: path.join(vaultRoot, projectSlug),
    checkpointsDir: path.join(vaultRoot, projectSlug, "checkpoints"),
    syncLogsDir: path.join(vaultRoot, projectSlug, "logs", "sync"),
    graphifyDir: config?.graphifyObsidianDir ? path.resolve(expandEnv(String(config.graphifyObsidianDir))) : path.join(vaultRoot, "graphify", projectSlug)
  };
}

function readState(target) {
  const currentSlicePath = path.join(target, ".github", "agent-state", "current-slice.md");
  const activeSlicesPath = path.join(target, ".github", "agent-state", "active-slices.yaml");
  const phaseStatusPath = path.join(target, ".github", "agent-state", "phase-status.yaml");
  const currentSlice = readTextIfExists(currentSlicePath);
  const activeSlices = readTextIfExists(activeSlicesPath);
  const phaseStatus = readTextIfExists(phaseStatusPath);
  const sliceId = currentSlice?.match(/`([^`]+)`/)?.[1] ?? "unknown";
  const phase = currentSlice?.match(/SDLC Phase\s*\n\s*-\s*`([^`]+)`/i)?.[1] ?? currentSlice?.match(/\bF\d+(?:\.\d+)?\b/)?.[0] ?? "unknown";
  return {
    currentSlicePath,
    activeSlicesPath,
    phaseStatusPath,
    sliceId,
    phase,
    currentSlicePreview: preview(currentSlice),
    activeSlicesPreview: preview(activeSlices),
    phaseStatusPreview: preview(phaseStatus),
    activeSliceDeclared: Boolean(activeSlices && /active:\s*\n\s*-\s*/.test(activeSlices))
  };
}

function schedulerHeadroomTask() {
  if (process.platform !== "win32") {
    return { supported: false, exists: false, taskName: null };
  }
  const ps = [
    "-NoProfile",
    "-Command",
    "Get-ScheduledTask | Where-Object { $_.TaskName -match 'Headroom' } | Select-Object -First 1 -ExpandProperty TaskName"
  ];
  const result = spawnSync("powershell.exe", ps, { encoding: "utf8", timeout: 5000 });
  const stdout = (result.stdout ?? "").trim();
  return { supported: true, exists: result.status === 0 && Boolean(stdout), taskName: stdout || null };
}

function collectRuntime(target) {
  const config = getConfig(target);
  const memory = resolveMemoryConfig(target);
  const state = readState(target);
  const claudeSettings = safeReadJson(path.join(os.homedir(), ".claude", "settings.json"));
  const claudeSettingsText = claudeSettings ? JSON.stringify(claudeSettings) : "";
  const codegraphDb = path.join(target, ".codegraph", "codegraph.db");
  const codegraphStatus = pathExists(path.join(target, ".codegraph", "config.json")) ? runCommand("codegraph", ["status"], target, 12_000) : null;
  const graphManifest = path.join(target, "graphify-out", "manifest.json");
  const graphReport = path.join(target, "graphify-out", "GRAPH_REPORT.md");
  const gitBranch = runCommand("git", ["branch", "--show-current"], target, 5000);
  const gitHead = runCommand("git", ["log", "-1", "--oneline"], target, 5000);
  const scheduler = schedulerHeadroomTask();

  return {
    generatedAt: nowIso(),
    target,
    project: getProjectSlug(target, config),
    git: {
      branch: gitBranch.ok ? gitBranch.stdout : null,
      head: gitHead.ok ? gitHead.stdout : null
    },
    state,
    headroom: {
      healthUrl: "http://127.0.0.1:8787/health",
      healthy: checkHttp("http://127.0.0.1:8787/health"),
      claudeBaseUrl: claudeSettings?.env?.ANTHROPIC_BASE_URL ?? null,
      hookDetected: /headroom\s+init\s+hook\s+ensure/i.test(claudeSettingsText),
      scheduler
    },
    caveman: {
      hookDetected: /caveman-activate\.js/i.test(claudeSettingsText),
      trackerDetected: /caveman-mode-tracker\.js/i.test(claudeSettingsText),
      flag: readTextIfExists(path.join(os.homedir(), ".claude", ".caveman-active"))?.trim() ?? null
    },
    codegraph: {
      configured: pathExists(path.join(target, ".codegraph", "config.json")),
      dbPath: pathExists(codegraphDb) ? codegraphDb : null,
      dbAgeHours: fileAgeHours(codegraphDb),
      statusOk: codegraphStatus ? codegraphStatus.ok : false,
      statusPreview: codegraphStatus ? preview(codegraphStatus.stdout || codegraphStatus.stderr, 500) : null
    },
    graphify: {
      graphPath: pathExists(path.join(target, "graphify-out", "graph.json")) ? path.join(target, "graphify-out", "graph.json") : null,
      manifestAgeHours: fileAgeHours(graphManifest),
      reportAgeHours: fileAgeHours(graphReport)
    },
    vault: vaultSection(memory)
  };
}

function lazyRefreshCodeGraph(target, runtime) {
  if (!runtime.codegraph.configured || runtime.codegraph.statusOk) {
    return { attempted: false, reason: runtime.codegraph.configured ? "status-ok" : "not-configured" };
  }

  const result = runCommand("codegraph", ["sync", "."], target, 60_000);
  return {
    attempted: true,
    ok: result.ok,
    status: result.status,
    preview: preview(result.stdout || result.stderr, 500)
  };
}

function runtimeFindings(runtime) {
  const findings = [];
  const add = (level, code, message) => findings.push({ level, code, message });
  if (!runtime.headroom.hookDetected) add("warning", "headroom-hook-missing", "Claude headroom hook not detected.");
  if (!runtime.headroom.scheduler.exists) add("warning", "headroom-scheduler-missing", "Headroom Scheduler fallback not detected.");
  if (!runtime.caveman.hookDetected) add("warning", "caveman-hook-missing", "Caveman activation hook not detected.");
  if (runtime.codegraph.configured && !runtime.codegraph.statusOk) add("warning", "codegraph-status", "CodeGraph configured but status check failed.");
  if (runtime.graphify.manifestAgeHours !== null && runtime.graphify.manifestAgeHours > 24) add("warning", "graphify-stale", `Graphify manifest age ${runtime.graphify.manifestAgeHours}h.`);
  if (!runtime.vault.exists) add("warning", "vault-missing", `Vault path not found: ${runtime.vault.root}`);
  if (runtime.state.sliceId !== "unknown" && !runtime.state.activeSliceDeclared) add("warning", "active-slices-empty", "current-slice exists but active-slices.yaml has no active entry.");
  return findings;
}

export function commandSessionStart(options) {
  const target = path.resolve(options.target ?? process.cwd());
  let runtime = collectRuntime(target);
  const codegraphRefresh = lazyRefreshCodeGraph(target, runtime);
  if (codegraphRefresh.attempted) {
    runtime = collectRuntime(target);
  }
  runtime.codegraph.lazyRefresh = codegraphRefresh;
  const findings = runtimeFindings(runtime);
  const payload = {
    status: findings.some((f) => f.level === "error") ? "error" : findings.length > 0 ? "warning" : "ok",
    runtime,
    findings
  };
  writeJson(path.join(target, ".sdlc", "session.json"), payload);
  return { exitCode: EXIT_OK, payload };
}

export function commandValidateRuntime(options) {
  const target = path.resolve(options.target ?? process.cwd());
  const runtime = collectRuntime(target);
  const findings = runtimeFindings(runtime);
  const hasErrors = findings.some((f) => f.level === "error");
  const hasWarnings = findings.some((f) => f.level === "warning");
  return {
    exitCode: hasErrors ? EXIT_ERROR : hasWarnings ? EXIT_ACTION_REQUIRED : EXIT_OK,
    payload: {
      status: hasErrors ? "error" : hasWarnings ? "warning" : "ok",
      findings,
      runtime
    }
  };
}

export function commandResume(options) {
  const target = path.resolve(options.target ?? process.cwd());
  const runtime = collectRuntime(target);
  const memory = resolveMemoryConfig(target);
  const openSpecChanges = path.join(target, "openspec", "changes");
  const activeChanges = pathExists(openSpecChanges)
    ? fs.readdirSync(openSpecChanges, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name !== "archive").map((entry) => entry.name)
    : [];
  const phaseGate = runtime.state.phase !== "unknown" && runtime.state.sliceId !== "unknown"
    ? evaluatePhaseReadiness(target, runtime.state.phase, runtime.state.sliceId)
    : null;
  const blockedByPhaseGate = phaseGate?.status === "blocked";
  const result = {
    status: "ok",
    ownerAgent: blockedByPhaseGate ? phaseGate.owner : runtime.state.phase === "definition" ? "analista-requisitos-migracion" : "orquestador-opus",
    sliceId: runtime.state.sliceId,
    phase: runtime.state.phase,
    branch: runtime.git.branch,
    head: runtime.git.head,
    activeChanges,
    latestCheckpoint: runtime.vault.latestCheckpoint,
    // Un checkpoint con las secciones narrativas sin redactar no es
    // continuidad: es `git log` con encabezados. Se dice aqui, donde alguien
    // decide si puede retomar sin la conversacion.
    latestCheckpointNarrative: checkpointNarrativeOf(runtime.vault.latestCheckpoint),
    // El que hay que LEER para retomar. Cuando coincide con el mas reciente no
    // hay nada que explicar; cuando no, el mas reciente es un esqueleto del
    // hook y entregarlo era el defecto.
    usableCheckpoint: runtime.vault.usableCheckpoint,
    skeletonsSinceUsable: runtime.vault.skeletonsSinceUsable,
    readinessStatus: "unknown",
    promotionStatus: "draft-local",
    nextCommand: blockedByPhaseGate ? `Completar evidencia/artefactos de ${phaseGate.phase} con ${phaseGate.owner}.` : runtime.state.phase === "definition" ? "/enrich-us o Continua con analista-requisitos-migracion" : "Continua",
    phaseGate,
    runtimeSummary: {
      headroomHealthy: runtime.headroom.healthy,
      codegraphOk: runtime.codegraph.statusOk,
      graphifyReportAgeHours: runtime.graphify.reportAgeHours,
      vault: memory.vaultRoot
    }
  };
  if (options.markdown) {
    return {
      exitCode: EXIT_OK,
      payload: {
        status: "ok",
        message: [
          "# SDLC Resume",
          "",
          `- owner-agent: ${result.ownerAgent}`,
          `- slice-id: ${result.sliceId}`,
          `- phase: ${result.phase}`,
          `- branch: ${result.branch ?? "unknown"}`,
          ...checkpointLines(result),
          `- next-command: ${result.nextCommand}`,
          `- phase-gate: ${phaseGate?.status ?? "unknown"}`,
          "",
          "## Active OpenSpec changes",
          "",
          ...(activeChanges.length ? activeChanges.map((change) => `- ${change}`) : ["- none"])
        ].join("\n")
      }
    };
  }
  return { exitCode: EXIT_OK, payload: result };
}

/**
 * Datos FACTUALES para el checkpoint. Todo lo de aqui sale del repo, no de un
 * modelo: commits desde el checkpoint anterior, HEAD, archivos sin commitear y
 * que fases tienen evidencia escrita.
 *
 * Es la mitad que el CLI SI puede automatizar. La otra —por que se hizo, que se
 * descarto, donde mirar para seguir— la escribe el agente, y el checkpoint la
 * pide con huecos explicitos en vez de omitirla.
 */
function collectCheckpointContext(target, memory) {
  const context = { supersedes: null, supersededSkeletons: [], commits: [], commitCount: null, head: null, uncommitted: null, evidencePhases: [] };

  // Checkpoint anterior = el ultimo REDACTADO, no el ultimo fichero.
  //
  // Encadenar contra el ultimo fichero hacia que cada esqueleto del hook
  // `post-merge` declarase `supersedes` sobre el esqueleto anterior: una
  // cadena de ficheros vacios que se sustituyen entre si. Peor aun, la ventana
  // de commits se cerraba en el ultimo MERGE en vez de en el ultimo trabajo
  // redactado, asi que el checkpoint bueno solo listaba los commits del ultimo
  // rato en vez de los de la sesion.
  const checkpoints = classifyCheckpoints(memory.checkpointsDir);
  const previous = checkpoints.usable ?? checkpoints.latest;
  if (previous) context.supersedes = path.basename(previous);
  // Los esqueletos que quedaron por encima del redactado: se declaran para que
  // quien retome sepa que esos ficheros ya no hay que abrirlos. Si NO hay
  // ninguno redactado, la lista seria "todo el vault" y no significaria nada.
  if (checkpoints.usable) context.supersededSkeletons = checkpoints.skipped.map((file) => path.basename(file));

  const head = runCommand("git", ["rev-parse", "--short", "HEAD"], target, 5000);
  if (head.ok) context.head = head.stdout.trim();

  const status = runCommand("git", ["status", "--porcelain"], target, 5000);
  if (status.ok) context.uncommitted = status.stdout.split("\n").filter((line) => line.trim()).length;

  // Commits desde el anterior: se acota por FECHA del checkpoint previo, que es
  // lo unico que se puede derivar de su nombre sin guardar un sha aparte.
  if (context.supersedes) {
    const stamp = context.supersedes.slice(0, 12);
    if (/^\d{12}$/.test(stamp)) {
      // La `Z` final NO es cosmetica. El nombre del checkpoint sale de
      // `toISOString()`, que es UTC; `git log --since` sin zona interpreta la
      // cadena en hora LOCAL. En UTC-5 eso apuntaba cinco horas al futuro y la
      // seccion de commits salia vacia SIEMPRE — una seccion decorativa, que es
      // peor que no tenerla porque parece que no hubo trabajo.
      const since = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:00Z`;
      // `--oneline`, no `--format=%h %s`: ese formato lleva `%` y un espacio, y
      // `assertShellSafeToken` los rechaza por la mitigacion de inyeccion en
      // cmd.exe. `--oneline` produce exactamente lo mismo sin metacaracteres.
      const log = runCommand("git", ["log", `--since=${since}`, "--oneline", "--no-merges"], target, 5000);
      if (log.ok) {
        context.commits = log.stdout.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 40);
        context.commitCount = context.commits.length;
      }
    }
  }

  try {
    const evidenceRoot = path.join(target, ".github", "agent-state", "evidence");
    for (const slice of fs.readdirSync(evidenceRoot)) {
      const phases = fs
        .readdirSync(path.join(evidenceRoot, slice))
        .filter((name) => name.endsWith(".yaml"))
        .map((name) => name.replace(/\.yaml$/, ""));
      if (phases.length > 0) context.evidencePhases.push(`${slice}: ${phases.sort().join(", ")}`);
    }
  } catch {
    // sin evidencia todavia
  }

  return context;
}

export function commandSave(options) {
  const target = path.resolve(options.target ?? process.cwd());
  const event = options.event ?? "manual";
  const noMutate = Boolean(options["no-mutate"] || options["dry-run"]);
  let runtime = collectRuntime(target);
  const codegraphRefresh = lazyRefreshCodeGraph(target, runtime);
  if (codegraphRefresh.attempted) {
    runtime = collectRuntime(target);
  }
  runtime.codegraph.lazyRefresh = codegraphRefresh;
  const memory = resolveMemoryConfig(target);
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12);
  const sliceSlug = runtime.state.sliceId === "unknown" ? "unknown" : runtime.state.sliceId.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  // Un esqueleto por merge no es continuidad: es ruido que ademas empuja al
  // bueno hacia atras en el orden por fecha. Medido en un repo consumidor el
  // 2026-08-24: 35 checkpoints en un dia, 34 de ellos esqueletos del hook.
  //
  // Para eventos AUTOMATICOS, si el ultimo checkpoint sigue siendo un esqueleto
  // intacto, se refresca ESE fichero en vez de crear otro: el vault acumula
  // como mucho un pendiente a la vez, y sus datos factuales quedan al dia.
  // `--event manual` —o sea `/save`— siempre crea uno nuevo: ahi hay alguien a
  // punto de redactarlo.
  const reused = event === "manual" ? null : reusablePendingCheckpoint(memory.checkpointsDir);
  const checkpointPath = reused ?? path.join(memory.checkpointsDir, `${timestamp}-slice-${sliceSlug}.md`);
  const diffStat = runCommand("git", ["diff", "--stat"], target, 5000);
  const enriched = collectCheckpointContext(target, memory);
  const content = [
    "---",
    "generated_by: sdlc-save",
    `event: ${event}`,
    `created_at: ${nowIso()}`,
    `slice: ${runtime.state.sliceId}`,
    `phase: ${runtime.state.phase}`,
    `branch: ${runtime.git.branch ?? "unknown"}`,
    "promotion_status: draft-local",
    ...(enriched.supersedes ? [`supersedes: ${enriched.supersedes}`] : []),
    ...(enriched.supersededSkeletons.length > 0
      ? ["superseded_skeletons:", ...enriched.supersededSkeletons.map((name) => `  - ${name}`)]
      : []),
    ...(enriched.commitCount !== null ? [`commits_since_previous: ${enriched.commitCount}`] : []),
    "---",
    "",
    `# Checkpoint ${runtime.state.sliceId}`,
    "",
    // Estas dos secciones el CLI NO las puede llenar: no tiene modelo ni sabe
    // por que se tomo una decision. Se dejan como huecos EXPLICITOS en vez de
    // omitirlas, porque un checkpoint sin el porque no se puede retomar sin la
    // conversacion — que es justamente lo que un checkpoint existe para evitar.
    "<!-- ===================================================================",
    "     SECCIONES NARRATIVAS: las llena el AGENTE, no el CLI.",
    "",
    "     El objetivo es que quien retome NO necesite la conversacion. Si para",
    "     entender una decision hay que volver al chat, el checkpoint fallo.",
    "     Estructura tomada de los checkpoints enriquecidos ya en uso",
    "     (.github/agent-state/checkpoint-context.md en los repos consumidores).",
    "     ================================================================== -->",
    "",
    "## Alcance y gobernanza",
    "",
    "<!-- AGENTE: bajo que reglas se trabajo y, sobre todo, QUE NO SE HIZO:",
    "     sin tests / sin commit / sin PR / excepcion declarada por el usuario.",
    "     Que queda sin commitear y pendiente de revision humana.",
    "     Si hubo manejo de secretos o alguno se filtro en la transcripcion,",
    "     decirlo aqui con la recomendacion de rotarlo. -->",
    "_(pendiente de redactar)_",
    "",
    "## Skills y fuentes usadas",
    "",
    "<!-- AGENTE: que skills, docs, ADRs o repos externos se consultaron. Sin",
    "     esto no se puede auditar de donde salio una decision. -->",
    "_(pendiente de redactar)_",
    "",
    "## Decisiones y trabajo realizado",
    "",
    "<!-- AGENTE: el POR QUE de cada decision, no solo el que. Incluir lo que se",
    "     DESCARTO y la razon: sin eso, quien retome vuelve a proponerlo.",
    "     Si hubo un hallazgo raiz que explica el resto, va primero. -->",
    "_(pendiente de redactar)_",
    "",
    "## Verificacion",
    "",
    "<!-- AGENTE: como se comprobo, con el comando y su salida real. Distinguir",
    "     lo verificado de lo supuesto. -->",
    "_(pendiente de redactar)_",
    "",
    "## Pendientes y siguiente accion",
    "",
    "<!-- AGENTE: cada pendiente con archivo/comando concreto por donde empezar.",
    "     'Falta X' sin decir donde mirar obliga a re-investigar lo ya",
    "     investigado. Separar lo que espera DECISION DEL USUARIO de lo que",
    "     solo espera trabajo. -->",
    "_(pendiente de redactar)_",
    "",
    "## Commits desde el checkpoint anterior",
    "",
    enriched.commits.length > 0
      ? ["```text", ...enriched.commits, "```"].join("\n")
      : "_(ninguno, o sin checkpoint previo con el que comparar)_",
    "",
    "## Estado verificable",
    "",
    `- Fase: **${runtime.state.phase}** · slice: **${runtime.state.sliceId}**`,
    `- Rama: \`${runtime.git.branch ?? "unknown"}\`${enriched.head ? ` · HEAD \`${enriched.head}\`` : ""}`,
    ...(enriched.uncommitted !== null ? [`- Archivos sin commitear: **${enriched.uncommitted}**`] : []),
    ...(enriched.evidencePhases.length > 0 ? [`- Evidencia escrita: ${enriched.evidencePhases.join(", ")}`] : []),
    `- Vault: \`${memory.vaultRoot}\`${memory.vaultUnresolved ? " ⚠️ **sin configurar** (fallback local)" : ""}`,
    ...(memory.vaultUnresolved ? [`  - ${memory.vaultUnresolved.hint}`] : []),
    "",
    "## Runtime",
    "",
    `- Headroom healthy: ${runtime.headroom.healthy}`,
    `- CodeGraph OK: ${runtime.codegraph.statusOk}`,
    `- Graphify report age hours: ${runtime.graphify.reportAgeHours ?? "unknown"}`,
    "",
    "## Git Diff Stat",
    "",
    "```text",
    diffStat.stdout || "(no diff)",
    "```",
    "",
    "## Next Command",
    "",
    runtime.state.phase === "definition" ? "Continua con analista-requisitos-migracion." : "Continua.",
    ""
  ].join("\n");
  if (!noMutate) {
    ensureDir(path.dirname(checkpointPath));
    writeText(checkpointPath, content);
  }
  // El checkpoint nace INCOMPLETO por diseno: el CLI escribe los huecos y el
  // agente los llena. Lo que faltaba era decirlo. Medido en manga-translator-mvp:
  // los 12 checkpoints del vault, incluido el mas reciente, tenian las cinco
  // secciones narrativas en `_(pendiente de redactar)_`, y `resume` los
  // presentaba como continuidad valida. Un checkpoint que solo trae `git log`
  // no evita volver a la conversacion, que es para lo que existe.
  const narrative = analyzeCheckpointNarrative(content);
  return {
    exitCode: EXIT_OK,
    payload: {
      status: "ok",
      dry_run: noMutate,
      event,
      checkpoint: checkpointPath,
      // `true` = se refresco el esqueleto pendiente en vez de apilar otro.
      refreshedPending: Boolean(reused),
      narrative,
      ...(narrative.complete
        ? {}
        : {
            message:
              `El checkpoint queda INCOMPLETO: faltan por redactar ${narrative.pending.length} secciones ` +
              `(${narrative.pending.join(", ")}). Las llena el agente, no el CLI: sin ellas el checkpoint no ` +
              "se puede retomar sin volver a la conversacion."
          })
    }
  };
}

const NARRATIVE_PLACEHOLDER = "_(pendiente de redactar)_";

/**
 * Las secciones narrativas que el CLI deja con hueco al crear un checkpoint.
 *
 * Es un espejo de la plantilla de `commandSave`, y por eso hay un test que
 * compara esta lista contra la salida real de `sdlc save`: si alguien agrega o
 * renombra una seccion en la plantilla y no aqui, el espejo se rompe en el
 * test y no en produccion. Sin esa atadura, `reusablePendingCheckpoint` dejaria
 * de reconocer un esqueleto intacto y volveria a apilar ficheros en silencio.
 */
export const CLI_NARRATIVE_SECTIONS = [
  "Alcance y gobernanza",
  "Skills y fuentes usadas",
  "Decisiones y trabajo realizado",
  "Verificacion",
  "Pendientes y siguiente accion"
];

/**
 * El ultimo checkpoint, si y solo si es un esqueleto que NADIE ha tocado.
 *
 * "Intacto" se mide contra el CUERPO: las cinco secciones narrativas siguen en
 * el placeholder. Si el agente redacto aunque sea una, devuelve `null` y se
 * crea un fichero nuevo — perder media redaccion es mucho peor que un
 * checkpoint de mas.
 */
function reusablePendingCheckpoint(root) {
  const latest = filesByRecency(root)[0];
  if (!latest) return null;
  const body = readTextIfExists(latest);
  if (!body) return null;
  // Solo se refresca lo que escribio el propio CLI. Un fichero que alguien
  // dejo ahi a mano no se sobreescribe nunca.
  if (!/^generated_by:\s*sdlc-save\s*$/m.test(body)) return null;
  const { pending } = analyzeCheckpointNarrative(body);
  return CLI_NARRATIVE_SECTIONS.every((section) => pending.includes(section)) ? latest : null;
}

function checkpointNarrativeOf(checkpointPath) {
  if (!checkpointPath) return null;
  const body = readTextIfExists(checkpointPath);
  return body ? analyzeCheckpointNarrative(body) : null;
}

/**
 * Las lineas de checkpoint del `resume --markdown`.
 *
 * Tres casos, y el del medio es el que motivo el cambio:
 *
 *   1. El mas reciente ES el redactado: una linea, como siempre.
 *   2. El mas reciente es un esqueleto y hay uno redactado detras: se nombra
 *      PRIMERO el redactado, porque es el que hay que abrir, y se dice cuantos
 *      esqueletos se saltaron para llegar a el.
 *   3. No hay ninguno redactado: no se disimula. Que el vault tenga ficheros
 *      no significa que tenga continuidad.
 */
function checkpointLines(result) {
  if (!result.latestCheckpoint) return ["- latest-checkpoint: none"];
  if (result.usableCheckpoint === result.latestCheckpoint) {
    return [`- latest-checkpoint: ${result.latestCheckpoint}`, "- checkpoint-narrativa: redactada"];
  }
  if (result.usableCheckpoint) {
    return [
      `- checkpoint-utilizable: ${result.usableCheckpoint}`,
      `- checkpoint-mas-reciente: ${result.latestCheckpoint} — esqueleto sin redactar, NO es el que hay que leer`,
      `- esqueletos por encima del utilizable: ${result.skeletonsSinceUsable}`
    ];
  }
  const pending = result.latestCheckpointNarrative?.pending ?? [];
  return [
    `- latest-checkpoint: ${result.latestCheckpoint}`,
    `- checkpoint-narrativa: **sin redactar**${pending.length ? ` (${pending.length} secciones: ${pending.join(", ")})` : ""}`,
    "- checkpoint-utilizable: **ninguno** — ningun checkpoint del vault tiene la narrativa redactada"
  ];
}

/**
 * Que secciones narrativas de un checkpoint siguen sin redactar.
 *
 * Se calcula leyendo el CUERPO, no un campo de frontmatter: un campo que
 * declara "completo" es exactamente igual de facil de escribir que la seccion
 * misma, y se queda obsoleto en cuanto alguien edita el archivo.
 */
export function analyzeCheckpointNarrative(body) {
  const pending = [];
  let currentSection = null;
  for (const line of String(body ?? "").split("\n")) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      currentSection = heading[1];
      continue;
    }
    if (currentSection && line.trim() === NARRATIVE_PLACEHOLDER && !pending.includes(currentSection)) {
      pending.push(currentSection);
    }
  }
  return { complete: pending.length === 0, pending };
}

export function commandContinua(options) {
  const session = commandSessionStart(options).payload;
  const resume = commandResume(options).payload;
  return {
    exitCode: EXIT_OK,
    payload: {
      status: "ok",
      platform: options.platform ?? "codex",
      sessionStatus: session.status,
      resume
    }
  };
}

export function commandMemorySync(options) {
  const target = path.resolve(options.target ?? process.cwd());
  const mode = options.mode ?? "health";
  const apply = Boolean(options.apply);
  const memory = resolveMemoryConfig(target);
  const steps = [];
  const logLines = [`[${nowIso()}] memory-sync mode=${mode} apply=${apply}`];
  const addStep = (name, result) => {
    steps.push({ name, ...result });
    logLines.push(`[${nowIso()}] ${name}: ${result.status}`);
  };
  const configOk = Boolean(memory.configPath && pathExists(memory.configPath));
  addStep("config", { status: configOk ? "ok" : "missing", path: memory.configPath });
  if (mode === "health" || !apply) {
    return { exitCode: configOk ? EXIT_OK : EXIT_ACTION_REQUIRED, payload: { status: configOk ? "ok" : "warning", dry_run: !apply, mode, steps } };
  }
  ensureDir(memory.syncLogsDir);
  const logPath = path.join(memory.syncLogsDir, `${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12)}-${mode}.log`);
  if (["sync", "nightly"].includes(mode)) {
    const converter = path.join(target, "scripts", "claude-to-obsidian.py");
    if (configOk && pathExists(converter)) {
      const result = runCommand(options["python-exe"] ?? "python", [converter, "--config", memory.configPath], target, 60_000);
      addStep("sync", { status: result.ok ? "ok" : "error", stdout: result.stdout, stderr: result.stderr });
    } else {
      addStep("sync", { status: "skipped", reason: "config or converter missing" });
    }
  }
  if (["export-graph", "nightly"].includes(mode)) {
    const exporter = path.join(target, "scripts", "export-graphify-obsidian.py");
    const graph = path.join(target, "graphify-out", "graph.json");
    if (pathExists(exporter) && pathExists(graph)) {
      const result = runCommand(options["python-exe"] ?? "python", [exporter, "--graph", graph, "--output-dir", memory.graphifyDir], target, 60_000);
      addStep("export-graph", { status: result.ok ? "ok" : "error", stdout: result.stdout, stderr: result.stderr });
    } else {
      addStep("export-graph", { status: "skipped", reason: "graphify export inputs missing" });
    }
  }
  writeText(logPath, `${logLines.join("\n")}\n`);
  const failed = steps.some((step) => step.status === "error");
  return { exitCode: failed ? EXIT_ERROR : EXIT_OK, payload: { status: failed ? "error" : "ok", dry_run: false, mode, logPath, steps } };
}

export function commandHooks(options) {
  const target = path.resolve(options.target ?? process.cwd());
  if (!options["post-merge-checkpoint"]) {
    return { exitCode: EXIT_ERROR, payload: { status: "error", message: "Falta --post-merge-checkpoint" } };
  }
  const hookPath = path.join(target, ".git", "hooks", "post-merge");
  const script = [
    "#!/bin/sh",
    "# generated by SistemaMultiagente_SDLC",
    "target=\"$(pwd)\"",
    "if command -v cygpath >/dev/null 2>&1; then",
    "  target=\"$(cygpath -w \"$target\")\"",
    "elif pwd -W >/dev/null 2>&1; then",
    "  target=\"$(pwd -W)\"",
    "fi",
    "if command -v npx >/dev/null 2>&1; then",
    "  npx --no-install sdlc save --target \"$target\" --event post-merge --json >/dev/null 2>&1 || true",
    "fi",
    ""
  ].join("\n");
  writeText(hookPath, script);
  try {
    fs.chmodSync(hookPath, 0o755);
  } catch {
    // chmod is best-effort on Windows.
  }
  return { exitCode: EXIT_OK, payload: { status: "ok", hook: hookPath } };
}
