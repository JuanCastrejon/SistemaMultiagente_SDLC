import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeLF } from "./file-utils.js";

const TEMPLATES_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "templates"
);

const MANIFEST_PATH = path.join(TEMPLATES_ROOT, "manifest.yaml");

export function templatesRoot() {
  return TEMPLATES_ROOT;
}

export function manifestPath() {
  return MANIFEST_PATH;
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((part) => parseScalar(part));
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseManifestYaml(raw) {
  const lines = normalizeLF(raw).split("\n");
  let version = null;
  const templates = [];
  let current = null;
  let inTemplates = false;

  function pushCurrent() {
    if (current) {
      templates.push(current);
      current = null;
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/g, "");
    if (line === "" || line.trimStart().startsWith("#")) continue;

    const versionMatch = /^version:\s*(.+)$/.exec(line);
    if (versionMatch && !inTemplates) {
      version = parseScalar(versionMatch[1]);
      continue;
    }

    if (/^templates:\s*$/.test(line)) {
      inTemplates = true;
      continue;
    }

    if (!inTemplates) continue;

    const itemStart = /^(\s+)-\s+([^:]+):\s*(.*)$/.exec(line);
    if (itemStart) {
      pushCurrent();
      current = {};
      current[itemStart[2].trim()] = parseScalar(itemStart[3]);
      continue;
    }

    const propMatch = /^(\s+)([^:]+):\s*(.*)$/.exec(line);
    if (propMatch && current) {
      current[propMatch[2].trim()] = parseScalar(propMatch[3]);
    }
  }
  pushCurrent();

  return { version, templates };
}

export function loadManifest() {
  const raw = fs.readFileSync(MANIFEST_PATH, "utf8");
  const manifest = parseManifestYaml(raw);
  validateManifest(manifest);
  return manifest;
}

function validateManifest(manifest) {
  if (!manifest || manifest.version !== 1) {
    throw new Error("templates/manifest.yaml: version 1 requerida");
  }
  if (!Array.isArray(manifest.templates) || manifest.templates.length === 0) {
    throw new Error("templates/manifest.yaml: templates[] vacio");
  }
  for (const entry of manifest.templates) {
    if (!entry.source || !entry.target) {
      throw new Error(`templates/manifest.yaml: entry sin source/target: ${JSON.stringify(entry)}`);
    }
    if (entry.modes && !Array.isArray(entry.modes)) {
      throw new Error(`templates/manifest.yaml: modes debe ser lista en ${entry.target}`);
    }
  }
}

export function interpolate(content, context) {
  // `${{ ... }}` es sintaxis de GitHub Actions, no un placeholder del
  // framework. Sin esta excepcion, instalar cualquier workflow con expresiones
  // (github.sha, steps.x.outputs.y, matrix.z) las vaciaba silenciosamente y el
  // workflow entregado quedaba roto.
  const actionsExpressions = [];
  const guarded = content.replace(/\$\{\{[\s\S]*?\}\}/g, (match) => {
    actionsExpressions.push(match);
    return `\u0000ACTIONS_EXPR_${actionsExpressions.length - 1}\u0000`;
  });

  const rendered = guarded.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, expr) => {
    const value = expr
      .split(".")
      .reduce((obj, key) => (obj == null ? undefined : obj[key]), context);
    if (value == null) return "";
    return String(value);
  });

  return rendered.replace(/\u0000ACTIONS_EXPR_(\d+)\u0000/g, (match, index) => actionsExpressions[Number(index)]);
}

// El contrato de calidad se genera desde config.surfaces, no desde una lista
// inventada en el template (ADR 0007, P6): un repo cuyo layout no coincide
// con el ejemplo (apps/api, apps/web) medía gates sobre paths que no existen,
// y checkSurfaces los bloqueaba SIEMPRE por "surface-path-unresolved".
//
// Flow-style YAML (`{ id: "x", ... }`) a proposito: una sola linea por
// superficie evita el modo de fallo mas comun de generar YAML por texto,
// que es una indentacion de bloque mal alineada que produce un documento
// invalido sin que nada lo detecte hasta que alguien lo parsea.
// Los cuatro riesgos de autorizacion (ADR 0008, D1) se PROPAGAN desde
// `config.surfaces` cuando el consumidor los declara alli, y NO se inventan
// cuando no lo hace.
//
// La tentacion es emitir `false` en los cuatro para que un repo recien
// instalado no salga obligado. Seria exactamente el error que el ADR nombra:
// *no clasificado* no es *no aplica*. Escribir `false` por defecto es que el
// framework clasifique el riesgo del consumidor por el, en un archivo que el
// consumidor no ha leido — y encima con el valor que menos protege. Un repo sin
// clasificar sale obligado, y eso es la respuesta correcta.
const RIESGOS_EN_CONFIG = {
  money_path: "moneyPath",
  regulated_data: "regulatedData",
  security_critical: "securityCritical",
  state_machine_critical: "stateMachineCritical"
};

export function buildQualityContractSurfaces(surfaces) {
  if (surfaces.length === 0) return "[]";
  const entries = surfaces.map((surface) => {
    const tier = surface.tier ?? "standard";
    const campos = [
      `id: ${JSON.stringify(surface.id)}`,
      `path: ${JSON.stringify(surface.path)}`,
      `tier: ${JSON.stringify(tier)}`
    ];
    for (const [enContrato, enConfig] of Object.entries(RIESGOS_EN_CONFIG)) {
      if (typeof surface[enConfig] === "boolean") campos.push(`${enContrato}: ${surface[enConfig]}`);
    }
    campos.push(`has_ui: ${Boolean(surface.hasUi)}`);
    return `{ ${campos.join(", ")} }`;
  });
  return `[${entries.join(", ")}]`;
}

// La matriz de trazabilidad se genera desde config.surfaces por el mismo
// motivo que el contrato de calidad (P6): el template traia `apps/api`,
// `apps/web` y `apps/mobile` fijos, asi que en cualquier repo con otro layout
// declaraba superficies inexistentes con owners inventados.
//
// `indent` alinea el JSON generado con la posicion que ocupa dentro del
// template, para que el archivo resultante siga siendo JSON valido y legible.
export function buildSurfaceTraceability(surfaces, indent = 2) {
  const pad = " ".repeat(indent);
  const reindent = (value) => JSON.stringify(value, null, 2).split("\n").join(`\n${pad}`);
  const roots = [...new Set([...surfaces.map((surface) => surface.path), "docs", "openspec"])];
  const entries = surfaces.map((surface) => ({
    id: surface.id,
    owner: surface.owner,
    tier: surface.tier ?? "standard",
    pathPrefixes: [`${String(surface.path).replace(/\/+$/, "")}/`],
    references: { requirements: [], userStories: [], useCases: [], adrs: [] },
    notes: ""
  }));
  return { roots: reindent(roots), surfaces: reindent(entries) };
}

function surfacesOwnedBy(surfaces, owner) {
  const owned = surfaces.filter((surface) => surface.owner === owner).map((surface) => surface.path);
  return owned.length > 0 ? owned.join(", ") : "(sin superficie declarada todavia)";
}

function buildContext(config) {
  const surfaces = Array.isArray(config.surfaces) ? config.surfaces : [];
  const traceability = buildSurfaceTraceability(surfaces);
  return {
    ...config,
    surfaceTraceabilityRoots: traceability.roots,
    surfaceTraceabilitySurfaces: traceability.surfaces,
    // Las fichas de agente decian `{{surfaces.0.path}}` y `{{surfaces.1.path}}`:
    // asumian que la superficie 0 es del api-agent y la 1 del web-agent, que
    // era cierto solo mientras el instalador escribiera sus dos superficies de
    // ejemplo. Se resuelve por OWNER, que es el dato que de verdad las liga.
    surfacesOwnedByApiAgent: surfacesOwnedBy(surfaces, "api-agent"),
    surfacesOwnedByWebAgent: surfacesOwnedBy(surfaces, "web-agent"),
    surfacesTable: surfaces
      .map((surface) => `| \`${surface.id}\` | \`${surface.path}\` | \`${surface.owner}\` |`)
      .join("\n"),
    surfacesList: surfaces.map((surface) => `- \`${surface.path}\``).join("\n"),
    qualityContractSurfaces: buildQualityContractSurfaces(surfaces)
  };
}

export function renderTemplates(config) {
  const manifest = loadManifest();
  const context = buildContext(config);
  const out = {};
  const targetsSeen = new Map();

  for (const entry of manifest.templates) {
    if (entry.modes && !entry.modes.includes(config.mode)) continue;
    const sourcePath = path.join(TEMPLATES_ROOT, entry.source);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Template source no encontrado: ${entry.source}`);
    }
    const raw = fs.readFileSync(sourcePath, "utf8");
    if (targetsSeen.has(entry.target)) {
      throw new Error(
        `Target duplicado para mode=${config.mode}: ${entry.target} (sources: ${targetsSeen.get(entry.target)}, ${entry.source})`
      );
    }
    targetsSeen.set(entry.target, entry.source);
    out[entry.target] = interpolate(raw, context);
  }
  return out;
}
