// ---------------------------------------------------------------------------
// Ningun archivo de texto del repo puede contener bytes de control crudos.
//
// Motivo real, no hipotetico: `src/acceptance.js` llego a `main` con un byte
// NUL literal dentro de un string (`.join("\0")` escrito como byte crudo, no
// como escape). Consecuencias, todas malas y todas silenciosas:
//
//  - git puede clasificar el archivo como BINARIO y excluirlo de los diffs,
//    con lo que el codigo se vuelve invisible para code review y para los
//    revisores automaticos del PR;
//  - el codigo que se LEE en un editor deja de ser evidentemente el que se
//    EJECUTA, porque el byte no se ve;
//  - ninguna herramienta del repo lo detectaba: 13 validators y 30 sub-tests
//    en verde con el byte dentro.
//
// Eso es exactamente la clase de discrepancia entre lo aparente y lo real que
// este framework existe para impedir en el codigo del consumidor, cometida en
// el codigo del framework. Este validator la convierte en un error duro.
//
// \t, \n y \r son legitimos y se permiten. Todo lo demas por debajo de 0x20,
// mas DEL (0x7F), se rechaza.
// ---------------------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import { listFiles } from "../src/file-utils.js";

const root = process.cwd();

const TEXT_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
  ".json", ".yaml", ".yml", ".md", ".txt",
  ".ps1", ".sh", ".py", ".html", ".css"
]);

// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function describeByte(code) {
  if (code === 0) return "NUL (0x00)";
  return `0x${code.toString(16).padStart(2, "0").toUpperCase()}`;
}

const errors = [];
let scanned = 0;

for (const file of listFiles(root)) {
  if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
  const absolute = path.join(root, file);
  let content;
  try {
    content = fs.readFileSync(absolute, "utf8");
  } catch {
    continue;
  }
  scanned += 1;
  if (!FORBIDDEN.test(content)) continue;

  // Se reporta linea, columna y byte exacto: un error sobre algo invisible
  // tiene que decir donde mirar, o no es accionable.
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = FORBIDDEN.exec(lines[index]);
    if (!match) continue;
    const column = match.index + 1;
    errors.push(
      `${file}:${index + 1}:${column} contiene el byte de control ${describeByte(match[0].charCodeAt(0))} — escribirlo como escape (\\u0000) en vez de byte crudo`
    );
  }
}

if (errors.length > 0) {
  console.error("No control bytes validation: FAIL");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`No control bytes validation: PASS (${scanned} archivos de texto)`);
