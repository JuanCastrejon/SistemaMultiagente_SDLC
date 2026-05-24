import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { pathExists, readTextIfExists } from "./file-utils.js";

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_ACTION_REQUIRED = 2;

function sha256Text(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function normalize(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
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

function firstLine(value) {
  return normalize(value).split("\n")[0] ?? "";
}

function contractCandidates(target) {
  const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  return [
    path.join(target, "phase-contract.yaml"),
    path.join(target, ".github", "agent-state", "phase-contract.yaml"),
    path.join(moduleRoot, "phase-contract.yaml")
  ];
}

export function loadPhaseContract(target) {
  for (const candidate of contractCandidates(target)) {
    if (!pathExists(candidate)) continue;
    const raw = fs.readFileSync(candidate, "utf8");
    const parsed = YAML.parse(raw);
    const phases = Array.isArray(parsed?.phases) ? parsed.phases : [];
    return { path: candidate, version: parsed?.version ?? 1, phases };
  }
  return { path: null, version: null, phases: [] };
}

function findPhase(contract, phaseId) {
  return contract.phases.find((phase) => String(phase.id).toUpperCase() === String(phaseId).toUpperCase()) ?? null;
}

function resolveArtifact(target, slice, artifact) {
  const replaced = String(artifact)
    .replaceAll("<slice>", slice)
    .replaceAll("{slice}", slice)
    .replaceAll("<slice-id>", slice)
    .replaceAll("{slice_id}", slice);
  return path.resolve(target, replaced);
}

function checkArtifacts(target, slice, artifacts = []) {
  return artifacts.map((artifact) => {
    const absolute = resolveArtifact(target, slice, artifact);
    return {
      path: artifact,
      absolute,
      exists: pathExists(absolute)
    };
  });
}

function evidencePath(target, slice, phaseId) {
  return path.join(target, ".github", "agent-state", "evidence", slice, `${phaseId}.yaml`);
}

export function evaluatePhaseReadiness(target, phaseId, slice) {
  const contract = loadPhaseContract(target);
  const phase = findPhase(contract, phaseId);
  if (!contract.path) {
    return {
      status: "error",
      contractPath: null,
      message: "No se encontro phase-contract.yaml.",
      phase: phaseId,
      slice
    };
  }
  if (!phase) {
    return {
      status: "error",
      contractPath: contract.path,
      message: `Fase no declarada en phase-contract.yaml: ${phaseId}`,
      phase: phaseId,
      slice
    };
  }

  const inputs = checkArtifacts(target, slice, phase.inputs_required ?? []);
  const outputs = checkArtifacts(target, slice, phase.outputs_required ?? []);
  const missingInputs = inputs.filter((entry) => !entry.exists);
  const missingOutputs = outputs.filter((entry) => !entry.exists);
  const evidence = {
    path: evidencePath(target, slice, phase.id),
    required: Boolean(phase.evidence_required),
    exists: pathExists(evidencePath(target, slice, phase.id))
  };
  const blocked = missingInputs.length > 0 || missingOutputs.length > 0 || (evidence.required && !evidence.exists);

  return {
    status: blocked ? "blocked" : "ok",
    contractPath: contract.path,
    phase: phase.id,
    slice,
    owner: phase.owner,
    participants: phase.participants ?? [],
    humanGate: Boolean(phase.human_gate),
    nextPhase: phase.next_phase ?? null,
    inputs,
    outputs,
    evidence,
    missingInputs,
    missingOutputs,
    blockers: [
      ...missingInputs.map((entry) => `input-missing:${entry.path}`),
      ...missingOutputs.map((entry) => `output-missing:${entry.path}`),
      ...(evidence.required && !evidence.exists ? [`evidence-missing:${path.relative(target, evidence.path)}`] : [])
    ]
  };
}

export function commandPhaseGate(options) {
  const target = path.resolve(options.target ?? process.cwd());
  const phase = options.phase;
  const slice = options.slice;
  if (!phase || !slice) {
    return {
      exitCode: EXIT_ERROR,
      payload: {
        status: "error",
        message: "Faltan --phase <F0-F17> y --slice <id>."
      }
    };
  }
  const result = evaluatePhaseReadiness(target, phase, slice);
  return {
    exitCode: result.status === "error" ? EXIT_ERROR : result.status === "blocked" ? EXIT_ACTION_REQUIRED : EXIT_OK,
    payload: result
  };
}

function extractSharedRules(content) {
  const pattern = /<!-- SDLC_SHARED_RULES_START sha256:([a-f0-9]+) -->\n([\s\S]*?)\n<!-- SDLC_SHARED_RULES_END -->/;
  const match = pattern.exec(normalize(content));
  if (!match) return null;
  const body = normalize(match[2]);
  return {
    declaredHash: match[1],
    body,
    actualHash: sha256Text(body)
  };
}

function listSkillNames(root) {
  if (!pathExists(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && pathExists(path.join(root, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();
}

export function commandGovernanceCheck(options) {
  const target = path.resolve(options.target ?? process.cwd());
  const findings = [];
  const sharedFiles = [
    "AGENTS.md",
    "CLAUDE.md",
    ".github/AGENTS.md",
    ".github/copilot-instructions.md"
  ];
  const blocks = [];
  for (const relativePath of sharedFiles) {
    const absolute = path.join(target, relativePath);
    const content = readTextIfExists(absolute);
    if (!content) {
      findings.push({ level: "error", code: "shared-rules-file-missing", path: relativePath });
      continue;
    }
    const block = extractSharedRules(content);
    if (!block) {
      findings.push({ level: "error", code: "shared-rules-block-missing", path: relativePath });
      continue;
    }
    if (block.declaredHash !== block.actualHash) {
      findings.push({
        level: "error",
        code: "shared-rules-hash-mismatch",
        path: relativePath,
        declared: block.declaredHash,
        actual: block.actualHash
      });
    }
    blocks.push({ path: relativePath, ...block });
  }
  const uniqueBodies = new Set(blocks.map((block) => block.actualHash));
  if (uniqueBodies.size > 1) {
    findings.push({ level: "error", code: "shared-rules-drift", hashes: [...uniqueBodies] });
  }

  const canonicalRoot = path.join(target, ".github", "skills");
  const canonicalSkills = listSkillNames(canonicalRoot);
  for (const mirrorRoot of [".claude/skills", ".agents/skills", ".windsurf/skills"]) {
    for (const skillName of canonicalSkills) {
      const mirrorPath = path.join(target, mirrorRoot, skillName, "SKILL.md");
      if (!pathExists(mirrorPath)) {
        findings.push({ level: "error", code: "skill-mirror-missing", path: `${mirrorRoot}/${skillName}/SKILL.md` });
        continue;
      }
      const mirror = readTextIfExists(mirrorPath) ?? "";
      if (!mirror.includes(`source: .github/skills/${skillName}/SKILL.md`)) {
        findings.push({ level: "warning", code: "skill-mirror-source-missing", path: `${mirrorRoot}/${skillName}/SKILL.md` });
      }
    }
  }

  const copilot = readTextIfExists(path.join(target, ".github", "copilot-instructions.md")) ?? "";
  for (const [test, code] of [
    [(text) => text.includes("feature/"), "copilot-branch-flow-missing"],
    [(text) => text.includes("gate humano") || text.includes("gates humanos"), "copilot-human-gate-missing"],
    [(text) => text.includes(".github/skills"), "copilot-skills-source-missing"]
  ]) {
    if (!test(copilot.toLowerCase())) {
      findings.push({ level: "error", code, path: ".github/copilot-instructions.md" });
    }
  }

  const hasErrors = findings.some((finding) => finding.level === "error");
  const hasWarnings = findings.some((finding) => finding.level === "warning");
  return {
    exitCode: hasErrors ? EXIT_ERROR : hasWarnings ? EXIT_ACTION_REQUIRED : EXIT_OK,
    payload: {
      status: hasErrors ? "error" : hasWarnings ? "warning" : "ok",
      sharedRulesHash: blocks[0]?.actualHash ?? null,
      canonicalSkills: canonicalSkills.length,
      findings
    }
  };
}

function checkTool(name, probe) {
  const result = probe();
  return { name, ...result };
}

export function commandToolsDoctor(options) {
  const target = path.resolve(options.target ?? process.cwd());
  const profile = options.profile ?? "default";
  const home = os.homedir();
  const claudeSettings = readTextIfExists(path.join(home, ".claude", "settings.json")) ?? "";
  const tools = [
    checkTool("pnpm", () => {
      const result = runCommand("corepack", ["pnpm", "--version"], target, 10_000);
      return { status: result.ok ? "ok" : "missing", version: firstLine(result.stdout || result.stderr) };
    }),
    checkTool("openspec", () => ({
      status: pathExists(path.join(target, "openspec", "config.yaml")) ? "ok" : "missing",
      path: "openspec/config.yaml"
    })),
    checkTool("graphify", () => ({
      status: pathExists(path.join(target, "graphify-out", "graph.json")) ? "ok" : "warning",
      path: "graphify-out/graph.json"
    })),
    checkTool("codegraph", () => {
      const result = runCommand("codegraph", ["status"], target, 12_000);
      return { status: result.ok ? "ok" : "warning", detail: firstLine(result.stdout || result.stderr) };
    }),
    checkTool("obsidian-memory", () => ({
      status: pathExists(path.join(target, "scripts", "obsidian-memory.config.local.json")) || pathExists(path.join(target, "scripts", "obsidian-memory.config.example.json")) ? "ok" : "warning",
      path: "scripts/obsidian-memory.config.local.json"
    })),
    checkTool("headroom", () => ({
      status: /headroom\s+init\s+hook\s+ensure/i.test(claudeSettings) ? "ok" : "warning",
      hook: /headroom\s+init\s+hook\s+ensure/i.test(claudeSettings)
    })),
    checkTool("caveman", () => ({
      status: /caveman-activate\.js/i.test(claudeSettings) ? "ok" : "warning",
      hook: /caveman-activate\.js/i.test(claudeSettings)
    })),
    checkTool("autoskills", () => ({
      status: pathExists(path.join(target, "scripts", "agent-skills.manifest.json")) ? "ok" : "missing",
      path: "scripts/agent-skills.manifest.json"
    })),
    checkTool("party-mode", () => ({
      status: pathExists(path.join(target, ".github", "skills", "party-mode", "SKILL.md")) ? "ok" : "missing",
      path: ".github/skills/party-mode/SKILL.md"
    }))
  ];
  const required = profile === "full" ? new Set(["pnpm", "openspec", "autoskills", "party-mode"]) : new Set(["pnpm"]);
  const findings = tools
    .filter((tool) => tool.status !== "ok")
    .map((tool) => ({
      level: required.has(tool.name) ? "error" : "warning",
      code: `tool-${tool.name}`,
      message: `${tool.name}: ${tool.status}`
    }));
  const hasErrors = findings.some((finding) => finding.level === "error");
  const hasWarnings = findings.some((finding) => finding.level === "warning");
  return {
    exitCode: hasErrors ? EXIT_ERROR : hasWarnings ? EXIT_ACTION_REQUIRED : EXIT_OK,
    payload: {
      status: hasErrors ? "error" : hasWarnings ? "warning" : "ok",
      profile,
      target,
      tools,
      findings
    }
  };
}

export function commandPrBodyCheck(options) {
  const target = path.resolve(options.repo ?? options.target ?? process.cwd());
  const pr = options.pr;
  if (!pr) {
    return { exitCode: EXIT_ERROR, payload: { status: "error", message: "Falta --pr <number>." } };
  }
  const result = runCommand("gh", ["pr", "view", String(pr), "--json", "body", "--jq", ".body | length"], target, 20_000);
  if (!result.ok) {
    return {
      exitCode: EXIT_ERROR,
      payload: { status: "error", message: "No se pudo leer el PR con gh.", stderr: result.stderr }
    };
  }
  const length = Number(result.stdout);
  return {
    exitCode: length > 0 ? EXIT_OK : EXIT_ACTION_REQUIRED,
    payload: {
      status: length > 0 ? "ok" : "blocked",
      pr: Number(pr),
      bodyLength: Number.isFinite(length) ? length : 0
    }
  };
}
