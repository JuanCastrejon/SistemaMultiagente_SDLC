import { up as up_1_0_1 } from "../migrations/1.0.1/up.mjs";
import { up as up_1_1_0 } from "../migrations/1.1.0/up.mjs";
import { up as up_1_2_0 } from "../migrations/1.2.0/up.mjs";
import { up as up_1_3_0 } from "../migrations/1.3.0/up.mjs";
import { up as up_1_4_0 } from "../migrations/1.4.0/up.mjs";
import { up as up_1_5_0 } from "../migrations/1.5.0/up.mjs";
import { up as up_1_6_0 } from "../migrations/1.6.0/up.mjs";
import { up as up_1_7_0 } from "../migrations/1.7.0/up.mjs";
import { up as up_1_7_1 } from "../migrations/1.7.1/up.mjs";
import { up as up_1_8_0 } from "../migrations/1.8.0/up.mjs";
import { up as up_1_8_1 } from "../migrations/1.8.1/up.mjs";
import { up as up_1_8_2 } from "../migrations/1.8.2/up.mjs";
import { up as up_2_0_0 } from "../migrations/2.0.0/up.mjs";
import { up as up_2_0_1 } from "../migrations/2.0.1/up.mjs";
import { up as up_2_0_2 } from "../migrations/2.0.2/up.mjs";
import { up as up_2_0_3 } from "../migrations/2.0.3/up.mjs";
import { up as up_2_0_4 } from "../migrations/2.0.4/up.mjs";
import { up as up_2_0_5 } from "../migrations/2.0.5/up.mjs";
import { up as up_2_0_6 } from "../migrations/2.0.6/up.mjs";

const REGISTRY = [
  { version: "1.0.1", up: up_1_0_1 },
  { version: "1.1.0", up: up_1_1_0 },
  { version: "1.2.0", up: up_1_2_0 },
  { version: "1.3.0", up: up_1_3_0 },
  { version: "1.4.0", up: up_1_4_0 },
  { version: "1.5.0", up: up_1_5_0 },
  { version: "1.6.0", up: up_1_6_0 },
  { version: "1.7.0", up: up_1_7_0 },
  { version: "1.7.1", up: up_1_7_1 },
  { version: "1.8.0", up: up_1_8_0 },
  { version: "1.8.1", up: up_1_8_1 },
  { version: "1.8.2", up: up_1_8_2 },
  { version: "2.0.0", up: up_2_0_0 },
  { version: "2.0.1", up: up_2_0_1 },
  { version: "2.0.2", up: up_2_0_2 },
  { version: "2.0.3", up: up_2_0_3 },
  { version: "2.0.4", up: up_2_0_4 },
  { version: "2.0.5", up: up_2_0_5 },
  { version: "2.0.6", up: up_2_0_6 }
];

function semverTuple(v) {
  return v.split(".").map(Number);
}

function semverCompare(a, b) {
  const pa = semverTuple(a);
  const pb = semverTuple(b);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// Base version + all migration targets
export const SUPPORTED_VERSIONS = new Set(["1.0.0", ...REGISTRY.map((m) => m.version)]);

// Migrations with fromVersion < version <= toVersion, sorted ascending.
export function migrationsToRun(fromVersion, toVersion) {
  return REGISTRY
    .filter((m) => semverCompare(m.version, fromVersion) > 0 && semverCompare(m.version, toVersion) <= 0)
    .sort((a, b) => semverCompare(a.version, b.version));
}

// Run each migration's up() and merge returned files into the base set.
//
// `up(files)` solo veia los archivos recien renderizados desde templates/, es
// decir el estado que el framework VA a escribir, nunca el estado real del
// consumidor. Una migracion que necesitara leer un archivo personalizado, mover
// contenido existente o decidir segun lo que hay en disco era imposible.
//
// El segundo argumento es aditivo: las migraciones que solo usan `files` siguen
// funcionando sin cambios.
//
// context = {
//   target: string,                        // raiz del repo consumidor
//   config: object|null,                   // config resuelta para esta version
//   readDisk(relativePath): string|null,   // contenido real, normalizado a LF
//   existsOnDisk(relativePath): boolean
// }
export function applyMigrations(files, migrations, context = {}) {
  const result = { ...files };
  const safeContext = {
    target: context.target ?? null,
    config: context.config ?? null,
    readDisk: typeof context.readDisk === "function" ? context.readDisk : () => null,
    existsOnDisk: typeof context.existsOnDisk === "function" ? context.existsOnDisk : () => false
  };
  for (const migration of migrations) {
    const extra = migration.up(result, safeContext);
    Object.assign(result, extra);
  }
  return result;
}
