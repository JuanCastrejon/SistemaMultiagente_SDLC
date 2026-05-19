import fs from "node:fs";
import path from "node:path";
import { listFiles } from "../src/file-utils.js";

const root = process.cwd();
const files = listFiles(root).filter((file) => /^templates\/\.github\/agents\/.+\.agent\.md$/.test(file));
const required = ["name", "model", "role", "phases", "inputs", "outputs"];
const errors = [];

function parseFrontmatter(content) {
  const match = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!match) return null;
  const out = {};
  for (const line of match[1].split("\n")) {
    const item = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (item) out[item[1]] = item[2];
  }
  return out;
}

for (const file of files) {
  const content = fs.readFileSync(path.join(root, file), "utf8");
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) {
    errors.push(`${file}: missing YAML frontmatter`);
    continue;
  }
  for (const field of required) {
    if (!frontmatter[field]) errors.push(`${file}: missing ${field}`);
  }
  for (const listField of ["phases", "inputs", "outputs"]) {
    if (frontmatter[listField] && !/^\[[^\]]*\]$/.test(frontmatter[listField])) {
      errors.push(`${file}: ${listField} must be an inline array`);
    }
  }
}

if (errors.length > 0) {
  console.error("Agent persona schema validation: FAIL");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Agent persona schema validation: PASS (${files.length} personas)`);
