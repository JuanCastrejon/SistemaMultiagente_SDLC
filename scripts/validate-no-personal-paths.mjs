import fs from "node:fs";
import path from "node:path";
import { listFiles } from "../src/file-utils.js";

const root = process.cwd();
const patterns = [
  /C:\\Users\\/i,
  /\/Users\/[^/\s]+\/source\/repos/i
];
const errors = [];

for (const file of listFiles(root)) {
  const absolute = path.join(root, file);
  const content = fs.readFileSync(absolute, "utf8");
  for (const pattern of patterns) {
    if (pattern.test(content)) {
      errors.push(`${file} contiene ruta personal: ${pattern}`);
    }
  }
}

if (errors.length > 0) {
  console.error("No personal paths validation: FAIL");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("No personal paths validation: PASS");
