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

const allowedTopLevel = new Set(["version", "updated", "roles", "platforms", "fallbacks"]);
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
