import fs from "node:fs";
import path from "node:path";
import { listFiles } from "../src/file-utils.js";

const root = process.cwd();
const checkUrls = process.argv.includes("--check-urls");
const mdFiles = listFiles(root).filter((file) => file.endsWith(".md") && !file.includes("node_modules/"));
const errors = [];

function stripCodeBlocks(content) {
  return content.replace(/```[\s\S]*?```/g, "");
}

// El slug que genera GitHub a partir de una cabecera. Conserva las letras
// acentuadas —`está` NO se translitera a `esta`—, que es exactamente el detalle
// que dejo cinco anclas rotas pasando el gate en verde: el validador solo
// comprobaba que el ARCHIVO destino existiera, nunca el fragmento.
function slugify(texto) {
  return texto
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

// El texto visible de la cabecera: sin marcas de enfasis ni backticks, y con el
// texto de los enlaces en lugar del enlace entero, que es lo que GitHub slugea.
function textoDeCabecera(linea) {
  return linea
    .replace(/^#{1,6}\s+/, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~]/g, "")
    .replace(/`/g, "")
    .trim();
}

const anclasPorArchivo = new Map();

function anclasDe(rutaAbsoluta) {
  if (anclasPorArchivo.has(rutaAbsoluta)) return anclasPorArchivo.get(rutaAbsoluta);
  const anclas = new Set();
  let contenido;
  try {
    contenido = fs.readFileSync(rutaAbsoluta, "utf8");
  } catch {
    anclasPorArchivo.set(rutaAbsoluta, anclas);
    return anclas;
  }
  const sinCodigo = stripCodeBlocks(contenido);

  // Anclas explicitas: `<a id="x">`, `<a name="x">` y cualquier `id=` en HTML
  // embebido. Son la via robusta —no dependen de como se transliere un titulo—
  // y por eso el propio repo las usa donde el titulo lleva tildes.
  for (const m of sinCodigo.matchAll(/\b(?:id|name)\s*=\s*["']([^"']+)["']/g)) anclas.add(m[1]);

  // Y las que GitHub deriva de las cabeceras, con el sufijo -1, -2… de las
  // repetidas.
  const vistas = new Map();
  for (const linea of sinCodigo.split(/\r?\n/)) {
    if (!/^#{1,6}\s+/.test(linea)) continue;
    const base = slugify(textoDeCabecera(linea));
    if (!base) continue;
    const n = vistas.get(base) ?? 0;
    vistas.set(base, n + 1);
    anclas.add(n === 0 ? base : `${base}-${n}`);
  }

  anclasPorArchivo.set(rutaAbsoluta, anclas);
  return anclas;
}

for (const file of mdFiles) {
  const absoluto = path.join(root, file);
  const content = stripCodeBlocks(fs.readFileSync(absoluto, "utf8"));
  const linkPattern = /(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of content.matchAll(linkPattern)) {
    const raw = match[1];
    if (raw.startsWith("mailto:") || raw.includes("{{") || raw.includes("<") || raw.includes(">")) continue;
    if (/^https?:\/\//.test(raw)) {
      if (!checkUrls) continue;
      continue;
    }

    const corte = raw.indexOf("#");
    const clean = corte === -1 ? raw : raw.slice(0, corte);
    const fragmento = corte === -1 ? "" : decodeURIComponent(raw.slice(corte + 1));

    // Enlace al propio documento (`#seccion`): el destino es este archivo.
    const destino = clean ? path.resolve(path.dirname(absoluto), clean) : absoluto;

    if (clean) {
      if (!destino.startsWith(root) || !fs.existsSync(destino)) {
        errors.push(`${file}: broken link ${raw}`);
        continue;
      }
    }

    if (!fragmento) continue;
    // Solo se pueden resolver fragmentos de Markdown: en otros formatos no hay
    // cabeceras que slugear y afirmar sobre ellos daria falsos positivos.
    if (!destino.endsWith(".md")) continue;
    if (!anclasDe(destino).has(fragmento)) {
      errors.push(`${file}: broken anchor ${raw} (el fragmento #${fragmento} no existe en el destino)`);
    }
  }
}

if (errors.length > 0) {
  console.error("Docs links validation: FAIL");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Docs links validation: PASS (${mdFiles.length} markdown files)`);
