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
  return content.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, expr) => {
    const value = expr
      .split(".")
      .reduce((obj, key) => (obj == null ? undefined : obj[key]), context);
    if (value == null) return "";
    return String(value);
  });
}

function buildContext(config) {
  const surfaces = Array.isArray(config.surfaces) ? config.surfaces : [];
  return {
    ...config,
    surfacesTable: surfaces
      .map((surface) => `| \`${surface.id}\` | \`${surface.path}\` | \`${surface.owner}\` |`)
      .join("\n"),
    surfacesList: surfaces.map((surface) => `- \`${surface.path}\``).join("\n")
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
