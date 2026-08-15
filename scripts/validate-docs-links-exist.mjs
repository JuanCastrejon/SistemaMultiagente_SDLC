import fs from "node:fs";
import path from "node:path";
import { listFiles } from "../src/file-utils.js";

const root = process.cwd();
const mdFiles = listFiles(root).filter((file) => file.endsWith(".md") && !file.includes("node_modules/"));
const errors = [];

// Vallas de codigo, de los DOS tipos. La primera version solo quitaba las de
// tres backticks, y una cabecera dentro de una valla `~~~` se contaba como
// cabecera real: producia un ancla que GitHub no crea, y un enlace roto pasaba
// el gate en verde. Es exactamente el defecto que este validador existe para
// impedir, cometido dentro del validador.
//
// El cierre tiene que ser del MISMO caracter y de al menos la misma longitud
// que la apertura, que es la regla de CommonMark: una valla de cuatro backticks
// puede contener tres.
function sinBloques(contenido) {
  return contenido.replace(/^([ \t]*)([`~]{3,})[^\n]*\n[\s\S]*?^\1?\2[`~]*[ \t]*$/gm, "");
}

// Codigo EN LINEA. Se quita para buscar enlaces y anclas, pero NO para leer
// cabeceras: en una cabecera, GitHub conserva el texto de dentro de los
// backticks al construir el slug, asi que ahi solo se quitan las comillas.
function sinCodigoEnLinea(contenido) {
  return contenido.replace(/(`+)[^`\n]*?\1/g, "");
}

// El slug que genera GitHub a partir de una cabecera. Conserva las letras
// acentuadas —`está` NO se translitera a `esta`—, que es el detalle que dejo
// cinco anclas rotas pasando el gate en verde: el validador solo comprobaba que
// el ARCHIVO destino existiera, nunca el fragmento.
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
  const sinCodigo = sinBloques(contenido);

  // Anclas explicitas de HTML embebido: `<a id="x">`, `<a name="x">`, o
  // cualquier etiqueta con `id=`. Son la via robusta —no dependen de como se
  // transliere un titulo— y por eso el repo las usa donde el titulo lleva
  // tildes.
  //
  // Se exige que el atributo venga DENTRO de una etiqueta, y se quita antes el
  // codigo en linea. Sin las dos cosas, un `id="x"` escrito en prosa o dentro
  // de backticks creaba un ancla fantasma: el destino no la tiene, pero el
  // validador creia que si, y el enlace roto pasaba.
  for (const m of sinCodigoEnLinea(sinCodigo).matchAll(/<[a-z][^>]*?\b(?:id|name)\s*=\s*["']([^"']+)["']/gi)) {
    anclas.add(m[1]);
  }

  // Y las que GitHub deriva de las cabeceras, con el sufijo -1, -2… de las
  // repetidas: la PRIMERA va sin sufijo.
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

// Un `%20` en la ruta es la forma correcta de escribir un espacio en un enlace
// Markdown, y sin decodificar el archivo "no existia". El `catch` cubre el `%`
// suelto, que es legitimo en un nombre de archivo y hace tirar al decodificador.
function decodificar(valor) {
  try {
    return decodeURIComponent(valor);
  } catch {
    return valor;
  }
}

for (const file of mdFiles) {
  const absoluto = path.join(root, file);
  const content = sinCodigoEnLinea(sinBloques(fs.readFileSync(absoluto, "utf8")));
  const linkPattern = /(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of content.matchAll(linkPattern)) {
    const raw = match[1];
    if (raw.startsWith("mailto:") || raw.includes("{{") || raw.includes("<") || raw.includes(">")) continue;
    // Las URLs no se comprueban: pedirlas por red haria que el gate dependiera
    // de que internet este arriba y de que un dominio ajeno no cambie. Hubo una
    // bandera `--check-urls` que prometia hacerlo y cuyas dos ramas eran
    // identicas —no comprobaba nada, y ningun script la usaba—. Una bandera
    // muerta que promete una comprobacion es peor que no tenerla.
    if (/^https?:\/\//.test(raw)) continue;

    const corte = raw.indexOf("#");
    const clean = decodificar(corte === -1 ? raw : raw.slice(0, corte));
    const fragmento = corte === -1 ? "" : decodificar(raw.slice(corte + 1));

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
