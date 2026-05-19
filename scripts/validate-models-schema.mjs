import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const modelsPath = path.join(root, "templates", "scripts", "models.yaml");
const content = fs.readFileSync(modelsPath, "utf8");
const errors = [];

function requirePattern(pattern, message) {
  if (!pattern.test(content)) errors.push(message);
}

requirePattern(/^version:\s*1$/m, "version must be 1");
requirePattern(/^updated:\s*"\d{4}-\d{2}-\d{2}"$/m, "updated must be quoted YYYY-MM-DD");
requirePattern(/^roles:\s*$/m, "roles block is required");
requirePattern(/^platforms:\s*$/m, "platforms block is required");
requirePattern(/^fallbacks:\s*$/m, "fallbacks block is required");

for (const role of ["orquestador", "planificador", "developer", "reviewer"]) {
  requirePattern(new RegExp(`^  ${role}:\\s*$`, "m"), `role ${role} is required`);
  requirePattern(new RegExp(`^  ${role}:\\s*\\n    primary:\\s*\\S+\\n    fallback:\\s*\\S+`, "m"), `role ${role} requires primary and fallback`);
}

for (const platform of ["claude_code", "codex", "copilot", "windsurf"]) {
  requirePattern(new RegExp(`^  ${platform}:\\s*\\n    default:\\s*\\S+`, "m"), `platform ${platform} requires default`);
}

// Optional `phases:` block (v1.3.0+). When present, each phase entry must
// declare primary and fallback model identifiers, same shape as `roles`.
if (/^phases:\s*$/m.test(content)) {
  const phasesBlockRegex = /^phases:\s*$([\s\S]*?)(?=^[A-Za-z0-9_-]+:|\Z)/m;
  const phasesBlockMatch = phasesBlockRegex.exec(content);
  if (phasesBlockMatch) {
    const phasesBody = phasesBlockMatch[1];
    const phaseEntryRegex = /^  ([A-Za-z0-9_-]+):\s*$/gm;
    let phaseMatch;
    let phasesFound = 0;
    while ((phaseMatch = phaseEntryRegex.exec(phasesBody)) !== null) {
      phasesFound += 1;
      const phaseName = phaseMatch[1];
      const phaseShape = new RegExp(`^  ${phaseName}:\\s*\\n    primary:\\s*\\S+\\n    fallback:\\s*\\S+`, "m");
      if (!phaseShape.test(phasesBody)) {
        errors.push(`phase ${phaseName} requires primary and fallback`);
      }
    }
    if (phasesFound === 0) {
      errors.push("phases block declared but contains no phase entries");
    }
  }
}

const allowedTopLevel = new Set(["version", "updated", "roles", "platforms", "phases", "fallbacks"]);
for (const line of content.split("\n")) {
  const match = /^([A-Za-z0-9_-]+):/.exec(line);
  if (match && !allowedTopLevel.has(match[1])) {
    errors.push(`unexpected top-level key: ${match[1]}`);
  }
}

if (errors.length > 0) {
  console.error("Models schema validation: FAIL");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Models schema validation: PASS");
