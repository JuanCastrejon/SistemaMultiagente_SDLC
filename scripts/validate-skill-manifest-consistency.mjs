import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const skillsRoot = path.join(root, "templates", ".github", "skills");
const manifestPath = path.join(root, "templates", "scripts", "agent-skills.manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const actual = fs
  .readdirSync(skillsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(skillsRoot, entry.name, "SKILL.md")))
  .map((entry) => entry.name)
  .sort();

const allowed = [...(manifest.repoGovernedSkills ?? [])].sort();
const missing = actual.filter((skill) => !allowed.includes(skill));
const stale = allowed.filter((skill) => !actual.includes(skill));
const errors = [];
if (missing.length > 0) errors.push(`missing from agent-skills.manifest.json: ${missing.join(", ")}`);
if (stale.length > 0) errors.push(`manifest entries without .github skill: ${stale.join(", ")}`);

if (errors.length > 0) {
  console.error("Skill manifest consistency validation: FAIL");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Skill manifest consistency validation: PASS (${actual.length} skills)`);
