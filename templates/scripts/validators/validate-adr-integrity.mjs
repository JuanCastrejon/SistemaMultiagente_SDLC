#!/usr/bin/env node
// VERDICT_STEP: adr-integrity (ADR 0007, P12).
//
// Dos formas baratas de que un ADR quede huerfano: dos archivos reclaman el
// mismo numero (uno los pisa en cualquier busqueda), o un ADR existe pero
// nadie lo enlaza desde el indice operativo -- queda invisible para quien
// navega la documentacion desde ahi, que es el punto de entrada declarado.
import fs from "node:fs";
import path from "node:path";
import { fail, ok } from "./_shared.mjs";

const target = process.cwd();
const adrDir = path.join(target, "docs", "adr");
if (!fs.existsSync(adrDir)) {
  fail(`no existe ${path.relative(target, adrDir)}: no hay ADRs que verificar`);
  process.exit(1);
}

const files = fs.readdirSync(adrDir).filter((name) => /^\d{4}-.+\.md$/.test(name));
const byNumber = new Map();
const findings = [];
for (const file of files) {
  const number = file.slice(0, 4);
  if (byNumber.has(number)) {
    findings.push(`numero de ADR duplicado ${number}: ${byNumber.get(number)} y ${file}`);
  } else {
    byNumber.set(number, file);
  }
}

const indexPath = path.join(target, "indice-operativo.md");
if (fs.existsSync(indexPath)) {
  const index = fs.readFileSync(indexPath, "utf8");
  for (const file of files) {
    if (!index.includes(file)) {
      findings.push(`${file} no esta enlazado desde indice-operativo.md`);
    }
  }
} else {
  findings.push(`no existe indice-operativo.md: ningun ADR puede confirmarse enlazado`);
}

if (findings.length > 0) {
  fail(findings.join("; "));
  process.exit(1);
}
ok(`${files.length} ADR(s) sin numero duplicado, todos enlazados desde indice-operativo.md`);
