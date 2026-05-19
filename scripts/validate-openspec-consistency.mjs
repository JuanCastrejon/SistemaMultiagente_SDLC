import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const specsRoot = path.join(root, "templates", "openspec", "specs");
const errors = [];

if (fs.existsSync(specsRoot)) {
  for (const entry of fs.readdirSync(specsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const specPath = path.join(specsRoot, entry.name, "spec.md");
    if (!fs.existsSync(specPath)) continue;
    const content = fs.readFileSync(specPath, "utf8");
    if (!/^#\s+/m.test(content)) errors.push(`${path.relative(root, specPath)}: missing title`);
    if (!/## Requirements/m.test(content)) errors.push(`${path.relative(root, specPath)}: missing ## Requirements`);
    if (!/### Requirement:/m.test(content)) errors.push(`${path.relative(root, specPath)}: missing Requirement blocks`);
    if (!/#### Scenario:/m.test(content)) errors.push(`${path.relative(root, specPath)}: missing Scenario blocks`);
  }
}

const changesRoot = path.join(root, "templates", "openspec", "changes");
if (fs.existsSync(changesRoot)) {
  for (const entry of fs.readdirSync(changesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const archivedMarker = path.join(changesRoot, entry.name, "archived.json");
    if (fs.existsSync(archivedMarker)) {
      errors.push(`archived change must live under archive/: ${path.relative(root, archivedMarker)}`);
    }
  }
}

if (errors.length > 0) {
  console.error("OpenSpec consistency validation: FAIL");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("OpenSpec consistency validation: PASS");
