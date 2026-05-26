import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ensureDir, pathExists, readJson, readTextIfExists, writeJson, writeText } from "./file-utils.js";
import { evaluatePhaseReadiness } from "./harness.js";

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

function runCommand(command, args = [], cwd = process.cwd(), timeout = 8000) {
  const windowsShell = process.platform === "win32";
  const quoteWindowsArg = (value) => {
    const text = String(value);
    return /[\s"&|<>^]/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
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
  const ageHours = (Date.now() - fs.statSync(filePath).mtimeMs) / 3_600_000;
  return Math.round(ageHours * 100) / 100;
}

function latestFile(root, extension = ".md") {
  if (!pathExists(root)) return null;
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
    .sort((a, b) => b.mtime - a.mtime)[0]?.file ?? null;
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
  const vaultRoot = rawVault && !String(rawVault).includes("{{") ? path.resolve(expandEnv(String(rawVault))) : path.join(target, ".sdlc", "vault");
  return {
    configPath,
    config,
    projectSlug,
    vaultRoot,
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
    vault: {
      configPath: memory.configPath,
      root: memory.vaultRoot,
      exists: pathExists(memory.vaultRoot),
      latestCheckpoint: latestFile(memory.checkpointsDir) ?? latestFile(path.join(memory.projectRoot, "logs"))
    }
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
          `- latest-checkpoint: ${result.latestCheckpoint ?? "none"}`,
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
  const checkpointPath = path.join(memory.checkpointsDir, `${timestamp}-slice-${sliceSlug}.md`);
  const diffStat = runCommand("git", ["diff", "--stat"], target, 5000);
  const content = [
    "---",
    "generated_by: sdlc-save",
    `event: ${event}`,
    `created_at: ${nowIso()}`,
    `slice: ${runtime.state.sliceId}`,
    `phase: ${runtime.state.phase}`,
    `branch: ${runtime.git.branch ?? "unknown"}`,
    "promotion_status: draft-local",
    "---",
    "",
    `# Checkpoint ${runtime.state.sliceId}`,
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
  return {
    exitCode: EXIT_OK,
    payload: {
      status: "ok",
      dry_run: noMutate,
      event,
      checkpoint: checkpointPath
    }
  };
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
