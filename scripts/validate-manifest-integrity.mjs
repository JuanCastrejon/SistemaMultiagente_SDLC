import fs from "node:fs";
import path from "node:path";
import { sha256File } from "../src/file-utils.js";

const targetArgIndex = process.argv.indexOf("--target");
const target = targetArgIndex >= 0 ? path.resolve(process.argv[targetArgIndex + 1]) : process.cwd();
const allowEmpty = process.argv.includes("--allow-empty");
const manifests = [];

function walk(current) {
  if (!fs.existsSync(current)) return;
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) walk(absolute);
    if (entry.isFile() && entry.name === "install-manifest.json" && path.basename(path.dirname(absolute)) === ".sdlc") {
      manifests.push(absolute);
    }
  }
}

walk(target);

const errors = [];
for (const manifest of manifests) {
  const checksumPath = path.join(path.dirname(manifest), "install-manifest.sha256");
  if (!fs.existsSync(checksumPath)) {
    errors.push(`${manifest}: falta install-manifest.sha256`);
    continue;
  }
  const expected = fs.readFileSync(checksumPath, "utf8").trim();
  const actual = sha256File(manifest);
  if (expected !== actual) {
    errors.push(`${manifest}: checksum invalido`);
  }
}

if (errors.length > 0) {
  console.error("Manifest integrity validation: FAIL");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

if (manifests.length === 0) {
  console.warn("Manifest integrity validation: WARN — 0 manifest(s) encontrados (ningun repo instalado bajo --target)");
  process.exit(allowEmpty ? 0 : 2);
}

console.log(`Manifest integrity validation: PASS (${manifests.length} manifest(s))`);
