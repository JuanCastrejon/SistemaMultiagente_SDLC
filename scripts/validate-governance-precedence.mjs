import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const canonicalRoot = path.join(root, "templates", ".github", "skills");
const mirrorRoots = [
  path.join(root, "templates", ".claude", "skills"),
  path.join(root, "templates", ".agents", "skills"),
  path.join(root, "templates", ".windsurf", "skills")
];

const errors = [];
for (const mirrorRoot of mirrorRoots) {
  if (!fs.existsSync(mirrorRoot)) continue;
  for (const entry of fs.readdirSync(mirrorRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const mirrorSkill = path.join(mirrorRoot, entry.name, "SKILL.md");
    if (!fs.existsSync(mirrorSkill)) continue;
    const canonical = path.join(canonicalRoot, entry.name, "SKILL.md");
    if (!fs.existsSync(canonical)) {
      errors.push(`${path.relative(root, mirrorSkill)} exists without canonical .github/skills/${entry.name}/SKILL.md`);
    }
  }
}

if (errors.length > 0) {
  console.error("Governance precedence validation: FAIL");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Governance precedence validation: PASS");
