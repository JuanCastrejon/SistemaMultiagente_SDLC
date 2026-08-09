// ---------------------------------------------------------------------------
// Inventario de herramientas externas (ADR 0007)
//
// `tools-doctor` sabia DETECTAR nueve herramientas y reportarlas como
// `missing`/`warning` con una ruta. Lo que no sabia era decir que es cada una,
// si el consumidor la necesita, o como conseguirla: ese conocimiento vivia en
// prosa, en un documento que hay que ir a buscar. El usuario que instala se
// queda con una lista de "opcionales" sin forma de decidir cuales le hacen
// falta.
//
// Este modulo carga `external-tools.yaml` y lo convierte en la fuente unica de
// esa informacion, para doctor, para `tools-install` y para la doc generada.
//
// SEGURIDAD. Un inventario que declara comandos de instalacion es una
// superficie de ejecucion, asi que:
//
//   1. Los comandos son LISTAS de argumentos (`argv`), nunca cadenas de shell.
//      No hay shell que interprete `;`, `|`, backticks ni comillas — es la
//      misma leccion que dejo la inyeccion por `gitFlow.integrationBranch` en
//      este slice, aplicada de antemano: lo que no pasa por un shell no
//      necesita escaparse.
//   2. `argv[0]` tiene que estar en ALLOWED_EXECUTABLES. Una entrada con
//      cualquier otro binario se rechaza AL CARGAR el inventario, no al
//      ejecutarlo: un inventario invalido no llega nunca a la fase de correr.
//   3. Nada aqui se ejecuta solo. `runInstallPlan` exige `apply: true`, y
//      ningun comando de scaffold lo invoca.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import { pathExists } from "./file-utils.js";

// Binarios que el inventario puede invocar. Deliberadamente corta: si una
// herramienta necesita otra cosa, se documenta como paso manual en vez de
// ampliar la lista. Ampliarla es una decision de seguridad, no de comodidad.
const ALLOWED_EXECUTABLES = new Set(["npm", "npx", "pnpm", "yarn", "node", "pip", "pip3", "pwsh", "gh", "corepack"]);

const INVENTORY_FILENAME = "external-tools.yaml";

function frameworkInventoryPath() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", INVENTORY_FILENAME);
}

/**
 * El inventario del CONSUMIDOR manda si existe (puede haber declarado
 * herramientas propias); si no, se usa el que trae el framework. Igual que con
 * el resto de contratos: el consumidor puede extender, y sin config propia hay
 * un default util en vez de un vacio.
 */
export function inventoryPath(target) {
  const local = path.join(target, INVENTORY_FILENAME);
  return pathExists(local) ? local : frameworkInventoryPath();
}

function validateCommand(tool, key, command) {
  if (command === null || command === undefined) return [];
  if (!Array.isArray(command.argv) || command.argv.length === 0) {
    return [`${tool.id}.${key}: 'argv' debe ser una lista no vacia (nunca una cadena de shell)`];
  }
  if (command.argv.some((token) => typeof token !== "string")) {
    return [`${tool.id}.${key}: todos los argumentos deben ser strings`];
  }
  if (!ALLOWED_EXECUTABLES.has(command.argv[0])) {
    return [
      `${tool.id}.${key}: '${command.argv[0]}' no esta en la allowlist de ejecutables (${[...ALLOWED_EXECUTABLES].join(", ")}); si la herramienta necesita otro binario, declararla como paso manual`
    ];
  }
  return [];
}

export function loadExternalTools(target = process.cwd()) {
  const absolute = inventoryPath(target);
  const raw = fs.existsSync(absolute) ? fs.readFileSync(absolute, "utf8") : null;
  if (!raw) {
    return { ok: false, code: "external-tools-missing", path: absolute, tools: [] };
  }

  let parsed;
  try {
    parsed = YAML.parse(raw);
  } catch (error) {
    return { ok: false, code: "external-tools-unparseable", path: absolute, detail: error.message, tools: [] };
  }

  const tools = Array.isArray(parsed?.tools) ? parsed.tools : [];
  const errors = [];
  if (tools.length === 0) errors.push("el inventario no declara ninguna herramienta");
  for (const tool of tools) {
    if (!tool?.id) errors.push("hay una herramienta sin 'id'");
    errors.push(...validateCommand(tool, "install", tool?.install));
    errors.push(...validateCommand(tool, "verify", tool?.verify));
  }
  if (errors.length > 0) {
    return { ok: false, code: "external-tools-invalid", path: absolute, errors, tools: [] };
  }

  return { ok: true, path: absolute, version: parsed.version ?? 1, tools };
}

/**
 * Metadatos por id, para que `tools-doctor` pueda enriquecer lo que ya detecta
 * sin cambiar como lo detecta. La deteccion probada se queda donde estaba; lo
 * que se agrega es el "y ahora que hago".
 */
export function describeTools(target = process.cwd()) {
  const loaded = loadExternalTools(target);
  const byId = new Map();
  if (!loaded.ok) return { ok: false, ...loaded, byId };
  for (const tool of loaded.tools) {
    byId.set(tool.id, {
      name: tool.name ?? tool.id,
      purpose: tool.purpose ?? null,
      required: tool.required ?? false,
      profile: tool.profile ?? null,
      install: tool.install?.argv ? tool.install.argv.join(" ") : null,
      manual: tool.manual ?? null,
      docs: tool.docs ?? null,
      notUsedFor: tool.notUsedFor ?? null
    });
  }
  return { ok: true, path: loaded.path, byId };
}

/**
 * Que se instalaria y que no. Separa explicitamente tres grupos, porque
 * mezclarlos es lo que hacia imposible saber "cuales me faltan de verdad":
 *   - `installable`: hay comando y la herramienta no esta presente.
 *   - `manualOnly` : no hay instalacion automatizable; la hace una persona.
 *   - `satisfied`  : ya esta.
 */
export function buildInstallPlan(target, { detected = new Map(), only = null } = {}) {
  const loaded = loadExternalTools(target);
  if (!loaded.ok) return { ok: false, ...loaded };

  const installable = [];
  const manualOnly = [];
  const satisfied = [];

  for (const tool of loaded.tools) {
    if (only && tool.id !== only) continue;
    const status = detected.get(tool.id) ?? null;
    const present = status === "ok";
    if (present) {
      satisfied.push({ id: tool.id, name: tool.name ?? tool.id, status });
      continue;
    }
    if (tool.install?.argv) {
      installable.push({
        id: tool.id,
        name: tool.name ?? tool.id,
        required: tool.required ?? false,
        purpose: tool.purpose ?? null,
        argv: tool.install.argv,
        command: tool.install.argv.join(" "),
        manual: tool.manual ?? null
      });
    } else {
      manualOnly.push({
        id: tool.id,
        name: tool.name ?? tool.id,
        required: tool.required ?? false,
        purpose: tool.purpose ?? null,
        manual: tool.manual ?? "sin instrucciones declaradas",
        docs: tool.docs ?? null
      });
    }
  }

  if (only && installable.length === 0 && manualOnly.length === 0 && satisfied.length === 0) {
    return { ok: false, code: "external-tool-unknown", detail: `'${only}' no esta en el inventario`, path: loaded.path };
  }
  return { ok: true, path: loaded.path, installable, manualOnly, satisfied };
}

/**
 * Ejecuta el plan. `apply` es obligatorio y explicito: sin el no corre nada y
 * devuelve lo que HABRIA hecho. Instalar software de terceros no puede ser un
 * efecto secundario de pedir un diagnostico.
 */
export function runInstallPlan(target, plan, { apply = false, timeoutMs = 300_000 } = {}) {
  if (!apply) {
    return { applied: false, results: plan.installable.map((entry) => ({ id: entry.id, command: entry.command, status: "dry-run" })) };
  }
  const results = [];
  for (const entry of plan.installable) {
    // Sin `shell`: el argv va tal cual al proceso. Un token con `;` o `|` es
    // un argumento literal, no un separador de comandos.
    const execution = spawnSync(entry.argv[0], entry.argv.slice(1), {
      cwd: target,
      encoding: "utf8",
      timeout: timeoutMs,
      shell: false
    });
    const ok = execution.status === 0;
    results.push({
      id: entry.id,
      command: entry.command,
      status: ok ? "installed" : "failed",
      exitCode: execution.status,
      detail: ok ? null : (execution.stderr || execution.error?.message || "").split("\n")[0] || "fallo sin detalle"
    });
  }
  return { applied: true, results };
}

export const ALLOWED_EXECUTABLES_LIST = [...ALLOWED_EXECUTABLES];
