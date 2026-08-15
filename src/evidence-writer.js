// ---------------------------------------------------------------------------
// Escritura de evidencia (ADR 0007, D2)
//
// Regla: la evidencia se ANEXA tras ejecutar, no se redacta. El agente nunca
// escribe `quality_metrics` a mano; lo hace este modulo con lo que realmente
// devolvio el probe, incluyendo el hash del reporte producido y el hash del
// arbol de fuentes evaluadas.
//
// Por que el hash del arbol y no un timestamp: un `measured_at` lo escribe
// quien quiera. El arbol evaluado es contenido, y el arbitro puede recomputarlo.
// La frescura de la evidencia se decide comparando arboles, nunca relojes.
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { TREE_HASH_MAX_BUFFER, ensureDir, listIgnoredPaths, pathExists, readTextIfExists, spawnCapture, writeText } from "./file-utils.js";

function sha256Text(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256FileIfExists(absolutePath) {
  if (!pathExists(absolutePath)) return null;
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(absolutePath)).digest("hex");
  } catch {
    return null;
  }
}

// `node_modules` y `.git` se excluyen SIEMPRE: no son la superficie, y `.git`
// cambia por el solo hecho de trabajar. Todo lo demas entra en la lista y se
// filtra despues por lo que git ignora (ver computeTreeHash).
//
// Antes se excluia cualquier entrada que empezara por punto, y eso dejaba el
// ancla CIEGA a `.env`, `.eslintrc`, `.dockerignore` o un directorio `.config/`
// entero dentro de una superficie declarada: reproducido, agregar un `.env` y
// un `.config/rules.json` no movia el hash ni un bit. Como ese hash es lo que
// ancla la frescura de la evidencia heredada (P7) y el sujeto de la firma
// humana, un archivo invisible ahi es un archivo que se puede cambiar sin
// invalidar ni el veredicto ni la firma.
const ALWAYS_SKIPPED = new Set(["node_modules", ".git"]);

function listFilesRecursive(root, accumulator = []) {
  if (!pathExists(root)) return accumulator;
  const stat = fs.statSync(root);
  if (stat.isFile()) {
    accumulator.push(root);
    return accumulator;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (ALWAYS_SKIPPED.has(entry.name)) continue;
    listFilesRecursive(path.join(root, entry.name), accumulator);
  }
  return accumulator;
}

/**
 * Hash estable del contenido de las superficies evaluadas. Dos arboles con los
 * mismos bytes dan el mismo hash sin importar cuando se midieron.
 */
export function computeTreeHash(target, surfacePaths = []) {
  const candidates = [];
  for (const surfacePath of [...surfacePaths].sort()) {
    const absolute = path.join(target, surfacePath);
    for (const file of listFilesRecursive(absolute).sort()) {
      candidates.push(path.relative(target, file).split(path.sep).join("/"));
    }
  }

  // Lo que git ignora no forma parte del arbol que se fusiona: cachés de build
  // (`.turbo`, `.next`, `dist`) cambian en cada corrida y harian que la
  // evidencia se viera obsoleta sin que nadie tocara el codigo. Preguntarle a
  // git es lo unico correcto; el criterio "empieza por punto" excluia
  // configuracion versionada real y NO excluia una `dist/` sin punto.
  //
  // Si no se puede preguntar (git ausente, target que no es repo) se incluye
  // TODO: ante la duda, mas archivos anclados, no menos. Un ancla de mas
  // produce un falso "obsoleto", visible y corregible; una de menos produce un
  // veredicto que pasa sobre un arbol que ya no es el medido.
  const ignored = listIgnoredPaths(target, candidates) ?? new Set();

  const parts = [];
  for (const relative of candidates) {
    if (ignored.has(relative)) continue;
    const digest = sha256FileIfExists(path.join(target, relative));
    if (digest) parts.push(`${relative}:${digest}`);
  }
  return { hash: sha256Text(parts.join("\n")), files: parts.length };
}

// Rutas de superficie tal como se declaran en el contrato ("." , "src",
// "apps/web/") normalizadas a la forma que usa git: separador `/`, sin `./`
// inicial ni `/` final. `.` y `` significan "todo el arbol".
function normalizeSurfacePrefix(surfacePath) {
  const normalized = String(surfacePath ?? "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
  return normalized === "." ? "" : normalized;
}

function isUnderSurface(relativePath, prefixes) {
  return prefixes.some((prefix) => prefix === "" || relativePath === prefix || relativePath.startsWith(`${prefix}/`));
}

/**
 * Hash estable del arbol de las superficies TAL COMO QUEDO EN UN COMMIT, leido
 * de git, no del working tree.
 *
 * Por que existe ademas de `computeTreeHash`: el sujeto de la firma humana
 * (P5) tiene que poder re-verificarse manana, en CI, y dentro de diez commits.
 * Anclarlo al working tree hace que la firma caduque en cuanto alguien edita
 * cualquier archivo — reproducido en el consumidor manga-translator-mvp, donde
 * la atestacion de F5 daba `signoff-subject-mismatch` un solo commit despues de
 * emitirse, y por tanto no servia como registro de que esa fase se aprobo.
 *
 * NO es intercambiable con `computeTreeHash` y no debe compararse contra el:
 * aquel hashea el CONTENIDO de cada archivo del working tree con sha256; este
 * usa el object id que git ya calculo para cada blob. Los dos son deterministas
 * y derivados de contenido, pero sus valores no coinciden. La frescura se mide
 * comparando dos llamadas a ESTA funcion sobre dos refs distintas.
 *
 * @param {string} target
 * @param {string[]} surfacePaths
 * @param {string} ref  Commit-ish. Su arbol es lo que se hashea.
 * @returns {{ok: boolean, hash: string|null, files: number, code: string|null, detail: string|null}}
 */
export function computeTreeHashAtRef(target, surfacePaths = [], ref = "HEAD") {
  // EL MISMO tope que la via asincrona, a proposito. Ver `TREE_HASH_MAX_BUFFER`
  // en file-utils.js: mientras el numero sea el mismo, las dos vias aceptan y
  // rechazan las mismas entradas. Esta via no necesita el limite por memoria
  // (`spawnSync` bloquea el hilo: nunca hay dos a la vez), pero tener margen de
  // sobra aqui no vale lo que cuesta que las dos discrepen.
  const listed = spawnSync("git", ["ls-tree", "-r", "-z", ref], {
    cwd: target,
    encoding: "buffer",
    maxBuffer: TREE_HASH_MAX_BUFFER
  });
  if (listed.status !== 0) {
    return {
      ok: false,
      hash: null,
      files: 0,
      code: "tree-ref-unreadable",
      detail: (listed.stderr?.toString("utf8") ?? "").trim() || `git ls-tree fallo sobre '${ref}'`
    };
  }
  return hashLsTree(listed.stdout.toString("utf8"), surfacePaths);
}

export const RUTA_CONTRATO_CALIDAD = "quality-contract.yaml";

/**
 * El `contract_sha256` del sujeto v2 (ADR 0008, D3).
 *
 * Es el MISMO calculo que el `tree_hash`, filtrado a un solo archivo: sha256
 * sobre la entrada `ruta:oid` que git reporta para el contrato EN EL REF
 * ATESTADO. No se lee del working tree ni se recibe declarado.
 *
 * Por que reutilizar `computeTreeHashAtRef` en vez de leer bytes: mantiene una
 * sola definicion de "que significa el hash de algo en un ref". Dos funciones
 * que hashean lo mismo de dos maneras acaban discrepando, y una discrepancia
 * entre lo que firma `signoff` y lo que verifica `phase-gate` es un fallo de
 * seguridad silencioso — es exactamente el motivo por el que las vias sincrona
 * y asincrona comparten `hashLsTree`.
 *
 * `files: 0` significa que el contrato NO existe en ese ref. No se devuelve un
 * hash del vacio: se devuelve un error, porque una atestacion que dice cubrir
 * una politica inexistente no cubre nada.
 */
export function computeContractSha256AtRef(target, ref = "HEAD") {
  const resultado = computeTreeHashAtRef(target, [RUTA_CONTRATO_CALIDAD], ref);
  if (!resultado.ok) return { ok: false, hash: null, code: resultado.code, detail: resultado.detail };
  if (resultado.files === 0) {
    return {
      ok: false,
      hash: null,
      code: "contract-missing-at-ref",
      detail: `${RUTA_CONTRATO_CALIDAD} no existe en '${ref}': no hay politica que la atestacion pueda cubrir`
    };
  }
  return { ok: true, hash: resultado.hash, code: null, detail: null };
}

/**
 * Igual, sin bloquear el hilo: la usa el pool de la auditoria. Comparte con la
 * version sincrona el calculo (`hashLsTree`), que es donde vive el criterio.
 */
export async function computeTreeHashAtRefAsync(target, surfacePaths = [], ref = "HEAD") {
  // EL MISMO tope que la via sincrona. Aqui SI acota memoria de verdad: esta
  // via corre en el pool de la auditoria (AUDIT_CONCURRENCY en vuelo,
  // harness.js), y `TREE_HASH_MAX_BUFFER` esta dimensionado para que todas
  // juntas no pasen del techo de diseño. Ver el comentario del propio
  // `TREE_HASH_MAX_BUFFER` en file-utils.js: el numero salio de tres intentos,
  // y los dos primeros rompian la paridad.
  const listed = await spawnCapture("git", ["ls-tree", "-r", "-z", ref], { cwd: target, maxBuffer: TREE_HASH_MAX_BUFFER });
  if (!listed.ok) {
    return {
      ok: false,
      hash: null,
      files: 0,
      code: "tree-ref-unreadable",
      detail: listed.stderr.trim() || `git ls-tree fallo sobre '${ref}'`
    };
  }
  return hashLsTree(listed.stdout, surfacePaths);
}

// Parte PURA del hash de arbol: recibe la salida de `ls-tree -r -z` y decide.
// Vive separada para que las dos variantes de IO no puedan divergir en el
// criterio, que es lo unico que importa aqui.
function hashLsTree(stdout, surfacePaths) {
  const prefixes = [...new Set((surfacePaths ?? []).map(normalizeSurfacePrefix))].sort();
  const parts = [];
  for (const entry of String(stdout ?? "").split("\0")) {
    if (!entry) continue;
    // `<mode> SP <type> SP <object> TAB <path>`
    const tab = entry.indexOf("\t");
    if (tab === -1) continue;
    const [, type, object] = entry.slice(0, tab).split(/\s+/);
    if (type !== "blob") continue;
    const relative = entry.slice(tab + 1);
    const first = relative.split("/")[0];
    if (ALWAYS_SKIPPED.has(first)) continue;
    if (!isUnderSurface(relative, prefixes)) continue;
    parts.push(`${relative}:${object}`);
  }

  parts.sort();
  return { ok: true, hash: sha256Text(parts.join("\n")), files: parts.length, code: null, detail: null };
}

/**
 * Enlaza una atestacion ya verificada con la evidencia de su fase.
 *
 * Por que el CLI puede escribir esto y NO puede escribir `quality_metrics`: son
 * cosas distintas. `quality_metrics` contiene los valores que el gate juzga, asi
 * que redactarlos a mano es fabricar el veredicto. `attestation_commit` es un
 * PUNTERO no autoritativo: `phase-gate` toma ese sha y reconstruye desde git el
 * arbol, la ancestria, la firma criptografica, el estado `%G?`, el firmante
 * permitido y el trailer con el sujeto. Cambiar el YAML a mano no puede encender
 * el gate; lo unico que hace es decir donde mirar.
 *
 * Dos condiciones que no son negociables, y por eso viven aqui y no en quien
 * llama:
 *  - `approved_by` se DERIVA del firmante que git reporta (`%GS`), nunca se
 *    acepta como opcion del usuario. Si lo eligiera quien firma, volveria a ser
 *    texto libre.
 *  - la referencia anterior se conserva en `history`. Re-firmar no borra a quien
 *    aprobo antes.
 *
 * Quien llama debe haber verificado el commit ANTES: esta funcion escribe, no
 * juzga.
 */
export function recordAttestation({ target, slice, phase, commitSha, signer, now = new Date() }) {
  const absolute = evidencePath(target, slice, phase);
  const raw = readTextIfExists(absolute);
  if (!raw) {
    return {
      ok: false,
      code: "evidence-missing",
      detail: `no existe ${path.relative(target, absolute)}: la atestacion no puede enlazarse a una fase sin evidencia escrita`
    };
  }

  let document;
  try {
    document = YAML.parse(raw) ?? {};
  } catch (error) {
    return { ok: false, code: "evidence-unparseable", detail: `${path.relative(target, absolute)} no es YAML legible: ${error.message}` };
  }

  const previous = document.human_gate_signoff;
  if (previous && previous.attestation_commit !== commitSha) {
    document.history = Array.isArray(document.history) ? document.history : [];
    document.history.push({ replaced_at: now.toISOString(), human_gate_signoff: previous });
  }

  document.human_gate_signoff = {
    required: true,
    approved_by: signer,
    approved_at: now.toISOString(),
    signature_class: "attestation",
    attestation_commit: commitSha
  };

  writeText(absolute, YAML.stringify(document));
  return { ok: true, code: null, path: absolute, replacedPrevious: Boolean(previous && previous.attestation_commit !== commitSha) };
}

export function evidencePath(target, slice, phase) {
  return path.join(target, ".github", "agent-state", "evidence", slice, `${phase}.yaml`);
}

/**
 * Anexa un bloque de calidad a la evidencia de una fase, en modo append-only:
 * lo que ya estaba no se reescribe, se conserva bajo `history`.
 *
 * @param {object} input
 * @param {string} input.target
 * @param {string} input.slice
 * @param {string} input.phase
 * @param {string} input.agentId
 * @param {Array}  input.probes   Resultados reales de ejecucion.
 * @param {object} input.metrics  Metricas normalizadas por los adapters.
 * @param {object} input.tree     {hash, files} de computeTreeHash.
 * @param {string} [input.commitSha]
 * @param {string} [input.source] "harness" (default) o "ci".
 */
export function appendQualityEvidence({
  target,
  slice,
  phase,
  agentId = "sdlc-harness",
  probes = [],
  metrics = {},
  tree = null,
  commitSha = null,
  source = "harness",
  // Rastro del runner cuando el origen es CI verificado. No es infalsificable
  // —el evaluado puede escribir cualquier cosa en su propio YAML— pero un
  // `run_id` es cruzable contra los runs reales del repo, mientras que un
  // `source: ci` a secas no deja nada que auditar.
  ci = null,
  now = new Date()
}) {
  const absolute = evidencePath(target, slice, phase);
  ensureDir(path.dirname(absolute));

  const existingRaw = readTextIfExists(absolute);
  let document = {};
  if (existingRaw) {
    try {
      document = YAML.parse(existingRaw) ?? {};
    } catch {
      // Evidencia ilegible: se preserva intacta al lado en vez de destruirla.
      const salvage = `${absolute}.corrupt-${now.toISOString().replace(/[:.]/g, "-")}`;
      fs.copyFileSync(absolute, salvage);
      document = {};
    }
  }

  const previousQuality = document.quality_metrics;
  if (previousQuality) {
    document.history = Array.isArray(document.history) ? document.history : [];
    document.history.push({ replaced_at: now.toISOString(), quality_metrics: previousQuality });
  }

  document.phase = document.phase ?? phase;
  document.slice = document.slice ?? slice;
  document.agent_id = document.agent_id ?? agentId;
  document.started_at = document.started_at ?? now.toISOString();
  document.outputs = Array.isArray(document.outputs) ? document.outputs : [];
  document.validators_run = Array.isArray(document.validators_run) ? document.validators_run : [];

  // Los probes ejecutados tambien entran en validators_run, que es el campo
  // historico que ya leen las plantillas de fase.
  for (const probe of probes) {
    document.validators_run.push({
      command: probe.command,
      status: probe.status === "ok" ? "ok" : probe.status === "failed" ? "error" : "skipped",
      exit_code: probe.exit_code ?? null
    });
  }

  document.quality_metrics = {
    measured_at: now.toISOString(),
    source,
    // Solo se escriben cuando el origen es `ci` de verdad: una evidencia que
    // dice `source: ci` sin estos campos delata que el string se puso a mano.
    ci_provider: source === "ci" ? ci?.provider ?? null : null,
    ci_run_id: source === "ci" ? ci?.runId ?? null : null,
    tree_hash: tree?.hash ?? null,
    tree_files: tree?.files ?? null,
    commit_sha: commitSha,
    probes,
    metrics
  };

  writeText(absolute, YAML.stringify(document));
  return { path: absolute, evidence: document };
}
