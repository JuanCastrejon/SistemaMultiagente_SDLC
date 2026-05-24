#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const options = { platform: "codex", ttlHours: 4, noLock: false, json: false, vaultPath: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === "--json" || token === "-Json") options.json = true;
    else if (token === "--no-lock" || token === "-NoLock") options.noLock = true;
    else if ((token === "--platform" || token === "-Platform") && next) { options.platform = next; i += 1; }
    else if ((token === "--ttl-hours" || token === "-TtlHours") && next) { options.ttlHours = Number(next); i += 1; }
    else if ((token === "--vault-path" || token === "-VaultPath") && next) { options.vaultPath = next; i += 1; }
  }
  return options;
}

function readText(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
}

function preview(text, max = 700) {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max).trim()}...` : clean;
}

function latestFile(root, extension = ".md") {
  if (!root || !fs.existsSync(root)) return null;
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.name.endsWith(extension) && entry.name !== "TEMPLATE.md") files.push(absolute);
    }
  };
  walk(root);
  return files.map((file) => ({ file, mtime: fs.statSync(file).mtimeMs })).sort((a, b) => b.mtime - a.mtime)[0]?.file ?? null;
}

function resolveRepo() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function resolveVault(repo, provided) {
  if (provided) return provided;
  const configPath = path.join(repo, "scripts", "obsidian-memory.config.local.json");
  if (!fs.existsSync(configPath)) return "";
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return config.vaultRoot || "";
  } catch {
    return "";
  }
}

const options = parseArgs(process.argv.slice(2));
const repo = resolveRepo();
const agentState = path.join(repo, ".github", "agent-state");
const platformContext = path.join(agentState, "platform-context.json");
const currentSlicePath = path.join(agentState, "current-slice.md");
const phaseStatusPath = path.join(agentState, "phase-status.yaml");
const activeSlicesPath = path.join(agentState, "active-slices.yaml");
const handoffsDir = path.join(agentState, "handoffs");
const graphReportPath = path.join(repo, "graphify-out", "GRAPH_REPORT.md");
const vaultPath = resolveVault(repo, options.vaultPath);

const now = new Date();
const expires = new Date(now.getTime() + options.ttlHours * 60 * 60 * 1000);
const currentSlice = readText(currentSlicePath);
const phaseStatus = readText(phaseStatusPath);
const activeSlices = readText(activeSlicesPath);
const graphReport = readText(graphReportPath);
const sliceId = currentSlice?.match(/`([^`]+)`/)?.[1] ?? "unknown";
const slicePhase = currentSlice?.match(/\bF\d+(?:\.\d+)?\b/)?.[0] ?? "unknown";
const latestHandoff = latestFile(handoffsDir);
const latestVaultCheckpoint = latestFile(vaultPath);

const result = {
  status: "ok",
  project: "{{project.slug}}",
  generated_at: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
  platform: options.platform,
  lock_written: !options.noLock,
  lock: {
    owner_platform: options.platform,
    locked_at: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    expires_at: expires.toISOString().replace(/\.\d{3}Z$/, "Z"),
    ttl_hours: options.ttlHours
  },
  current_slice: {
    id: sliceId,
    phase: slicePhase,
    preview: preview(currentSlice)
  },
  active_slices_preview: preview(activeSlices),
  phase_status_preview: preview(phaseStatus),
  latest_handoff: latestHandoff,
  graph_report: {
    path: graphReportPath,
    exists: Boolean(graphReport),
    preview: preview(graphReport)
  },
  vault_checkpoint: latestVaultCheckpoint
};

if (!options.noLock) {
  fs.mkdirSync(agentState, { recursive: true });
  fs.writeFileSync(platformContext, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

if (options.json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  process.stdout.write(`CONTINUA - SDLC context resume\nProject: {{project.slug}}\nPlatform: ${options.platform}\nSlice: ${sliceId} (${slicePhase})\nLatest handoff: ${latestHandoff ?? ""}\nVault checkpoint: ${latestVaultCheckpoint ?? ""}\nGraph report: ${Boolean(graphReport)}\n`);
}
