import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetFile = path.join(repoRoot, "src", "render.js");

const MAX_LITERAL_LENGTH = 300;
const MAX_LITERAL_NEWLINES = 5;

const source = fs.readFileSync(targetFile, "utf8");

function findTemplateLiterals(src) {
  const literals = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") i += 2;
        else i++;
      }
      i++;
      continue;
    }
    if (ch === "`") {
      const start = i;
      let lineStart = src.lastIndexOf("\n", start) + 1;
      const startLine = src.slice(0, start).split("\n").length;
      i++;
      let newlines = 0;
      while (i < src.length && src[i] !== "`") {
        if (src[i] === "\\" && i + 1 < src.length) {
          i += 2;
          continue;
        }
        if (src[i] === "$" && src[i + 1] === "{") {
          let depth = 1;
          i += 2;
          while (i < src.length && depth > 0) {
            if (src[i] === "{") depth++;
            else if (src[i] === "}") depth--;
            if (src[i] === "\n") newlines++;
            if (depth > 0) i++;
          }
          i++;
          continue;
        }
        if (src[i] === "\n") newlines++;
        i++;
      }
      const length = i - start - 1;
      literals.push({ startLine, length, newlines });
      i++;
      continue;
    }
    i++;
  }
  return literals;
}

const literals = findTemplateLiterals(source);
const violations = literals.filter(
  (lit) => lit.length > MAX_LITERAL_LENGTH || lit.newlines > MAX_LITERAL_NEWLINES
);

if (violations.length > 0) {
  console.error("No inline managed content validation: FAIL");
  console.error(`src/render.js contiene template literals largos (potencial regresion al patron inline pre-Fase A).`);
  console.error(`Limites: length<=${MAX_LITERAL_LENGTH}, newlines<=${MAX_LITERAL_NEWLINES}.`);
  for (const violation of violations) {
    console.error(`- line ${violation.startLine}: length=${violation.length}, newlines=${violation.newlines}`);
  }
  console.error("Mueva contenido a templates/ y referencielo via templates/manifest.yaml.");
  process.exit(1);
}

console.log(
  `No inline managed content validation: PASS (${literals.length} template literal(s), max length=${literals.reduce((m, l) => Math.max(m, l.length), 0)}, max newlines=${literals.reduce((m, l) => Math.max(m, l.newlines), 0)})`
);
