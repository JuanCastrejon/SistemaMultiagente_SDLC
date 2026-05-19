import fs from "node:fs";
import path from "node:path";
import { defaultConfig } from "../src/render.js";
import { listFiles } from "../src/file-utils.js";

const root = process.cwd();
const context = defaultConfig({
  target: root,
  mode: "greenfield",
  projectName: "Example Project",
  projectSlug: "example-project"
});
context.surfacesTable = "| `backend` | `apps/api` | `api-agent` |";
context.surfacesList = "- `apps/api`";

const files = listFiles(path.join(root, "templates")).filter((file) => {
  const absolute = path.join(root, "templates", file);
  return fs.statSync(absolute).isFile();
});

const errors = [];
for (const file of files) {
  const absolute = path.join(root, "templates", file);
  const content = fs.readFileSync(absolute, "utf8");
  for (const match of content.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
    const expr = match[1];
    const value = expr.split(".").reduce((obj, key) => {
      if (obj == null) return undefined;
      if (/^\d+$/.test(key) && Array.isArray(obj)) return obj[Number(key)];
      return obj[key];
    }, context);
    if (value == null) {
      errors.push(`${path.relative(root, absolute)}: unresolved {{${expr}}}`);
    }
  }
}

if (errors.length > 0) {
  console.error("Mustache references validation: FAIL");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Mustache references validation: PASS");
