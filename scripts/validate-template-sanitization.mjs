import fs from "node:fs";
import path from "node:path";
import { listFiles } from "../src/file-utils.js";

const root = process.cwd();
// La regla protege lo que se INSTALA en un consumidor. La documentacion interna
// que razona sobre consumidores reales (extraccion, ADRs e investigacion) puede
// nombrarlos: no se instala en ningun repo destino.
const allowed = [
  /^docs\/extraction\//,
  /^docs\/adr\//,
  /^docs\/research\//,
  /^CHANGELOG\.md$/
];
const forbidden = [
  /\bFacturacionDian\b/i,
  /\bSamcol\b/i,
  /\bFERRELECTRICOS\b/i,
  /\bPasarelaDePago\b/i,
  /\bpayment-core\b/i,
  /\bPSE\b/
];
const errors = [];

function isAllowed(file) {
  return allowed.some((pattern) => pattern.test(file));
}

for (const file of listFiles(root)) {
  if (isAllowed(file)) {
    continue;
  }
  const absolute = path.join(root, file);
  const content = fs.readFileSync(absolute, "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(content)) {
      errors.push(`${file} contiene termino no sanitizado: ${pattern}`);
    }
  }
}

if (errors.length > 0) {
  console.error("Template sanitization validation: FAIL");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Template sanitization validation: PASS");
