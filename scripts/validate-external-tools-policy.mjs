import fs from "node:fs";
import path from "node:path";
import { listFiles } from "../src/file-utils.js";

const root = process.cwd();
const files = listFiles(root).filter((file) =>
  /(^|\/)(templates\/scripts|scripts)\/.+\.(ps1|py|sh|mjs|js)$/.test(file)
);

const riskyPatterns = [
  /\bnpx\s+(?:--yes\s+)?[\w@./-]+\s+(?:add|install)\b/i,
  /\bpip\s+install\b/i,
  /\bpython\s+-m\s+pip\s+install\b/i,
  /\bRegister-ScheduledTask\b/i,
  /\bInstall-Module\b/i
];

const errors = [];
for (const file of files) {
  const content = fs.readFileSync(path.join(root, file), "utf8");
  const marked = /#\s*opt-in:external/i.test(content);
  for (const pattern of riskyPatterns) {
    if (pattern.test(content) && !marked) {
      errors.push(`${file}: external side-effect command requires # opt-in:external marker (${pattern})`);
    }
  }
}

if (errors.length > 0) {
  console.error("External tools policy validation: FAIL");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("External tools policy validation: PASS");
