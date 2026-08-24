// ---------------------------------------------------------------------------
// Ningun documento del framework puede citar una etiqueta de eje con guion.
//
// El contrato es `eje:valor` con DOS PUNTOS: `sdlc:F3`, `readiness:L2`,
// `surface:backend`, `rework:F9:regression`. La variante con guion no es un
// sinonimo: es una etiqueta distinta que `gh label create` acepta sin rechistar,
// y que produce una TERCERA taxonomia paralela a las dos que ya conviven.
//
// El caso medido: un consumidor declaraba como salida obligatoria de F3 unas
// etiquetas `readiness-Lx` que no existian en ninguna de las dos taxonomias
// vigentes. Cualquier automatizacion contra esa linea falla o inventa.
//
// Por que un validador y no solo la regla escrita: la regla ya estaba implicita
// en el fichero de etiquetas y la desviacion aparecio igual. Un contrato que
// nada comprueba se lee como cumplido.
// ---------------------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const raices = ["templates", "docs", "openspec", "README.md", "AGENTS.md", "CHANGELOG.md"];

// Los ejes del contrato. `rework` incluido: `rework-F9` es tan invalido como
// `readiness-L1`.
const EJES = ["sdlc", "readiness", "surface", "rework"];

// `readiness-L2`, `sdlc-F3`, `surface-backend`, `rework-F9`. Se exige que el
// valor empiece por mayuscula o minuscula alfanumerica para no marcar prosa
// como "surface-level" — que es ingles corriente, no una etiqueta.
const VALORES = {
  sdlc: /^F\d{1,2}$/,
  readiness: /^L[123]$/,
  surface: /^(backend|web|mobile|docs)$/,
  rework: /^F\d{1,2}$/
};

const SOSPECHOSO = new RegExp(`\\b(${EJES.join("|")})-([A-Za-z0-9]+)`, "g");

// El propio registro de la desviacion tiene que poder nombrarla. Un documento
// que EXPLICA por que la variante con guion esta mal no puede ser el que rompa
// el validador; se declaran por ruta, no por una heuristica de contexto.
const EXENTOS = new Set([
  path.join("templates", "docs", "agents", "triage-labels.md"),
  path.join("scripts", "validate-label-notation.mjs"),
  "CHANGELOG.md"
]);

// `docs/research/` entero: son los documentos que MIDEN el estado de un
// consumidor, y citar la desviacion tal como se encontro es su trabajo.
const PREFIJOS_EXENTOS = [path.join("docs", "research") + path.sep];

function* ficheros(dir) {
  const absoluto = path.join(root, dir);
  if (!fs.existsSync(absoluto)) return;
  if (fs.statSync(absoluto).isFile()) {
    yield dir;
    return;
  }
  for (const entrada of fs.readdirSync(absoluto, { withFileTypes: true })) {
    const relativo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name === "node_modules" || entrada.name.startsWith(".git")) continue;
      yield* ficheros(relativo);
      continue;
    }
    if (/\.(md|ya?ml|json|mjs|js)$/.test(entrada.name)) yield relativo;
  }
}

const errores = [];
let revisados = 0;
for (const raiz of raices) {
  for (const relativo of ficheros(raiz)) {
    if (EXENTOS.has(relativo)) continue;
    if (PREFIJOS_EXENTOS.some((prefijo) => relativo.startsWith(prefijo))) continue;
    revisados += 1;
    const texto = fs.readFileSync(path.join(root, relativo), "utf8");
    for (const [linea, contenido] of texto.split(/\r?\n/).entries()) {
      for (const match of contenido.matchAll(SOSPECHOSO)) {
        const [completo, eje, valor] = match;
        // Solo es una etiqueta mal escrita si el valor es un valor REAL de ese
        // eje. `surface-area` o `rework-cost` son prosa.
        if (!VALORES[eje].test(valor)) continue;
        errores.push(`${relativo}:${linea + 1}: \`${completo}\` — el contrato es \`${eje}:${valor}\`, con dos puntos`);
      }
    }
  }
}

if (errores.length > 0) {
  console.error("Label notation validation: FAIL");
  for (const error of errores) console.error(`- ${error}`);
  console.error("\nVer templates/docs/agents/triage-labels.md: los ejes usan `eje:valor`.");
  console.error("La variante con guion no es un sinonimo, es una etiqueta distinta que nadie creo.");
  process.exit(1);
}

console.log(`Label notation validation: PASS (${revisados} archivos)`);
