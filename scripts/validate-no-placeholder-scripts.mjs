import fs from "node:fs";
import path from "node:path";
import { listFiles } from "../src/file-utils.js";

const root = process.cwd();
const scriptFiles = listFiles(root).filter((file) =>
  /(^|\/)(templates\/scripts|scripts)\/.+\.(ps1|py|sh|mjs|js)$/.test(file)
);

const patterns = [
  /Write-Host\s+["']?pendiente/i,
  /#\s*TODO:?.*implementar/i,
  /throw\s+["']not implemented/i,
  /pass\s*#\s*TODO/i
];

const errors = [];
for (const file of scriptFiles) {
  const content = fs.readFileSync(path.join(root, file), "utf8");
  for (const pattern of patterns) {
    if (pattern.test(content)) {
      errors.push(`${file}: placeholder script marker matched ${pattern}`);
    }
  }
}

if (errors.length > 0) {
  console.error("No placeholder scripts validation: FAIL");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`No placeholder scripts validation: PASS (${scriptFiles.length} script files)`);
