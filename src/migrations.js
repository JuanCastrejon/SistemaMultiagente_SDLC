import { up as up_1_0_1 } from "../migrations/1.0.1/up.mjs";
import { up as up_1_1_0 } from "../migrations/1.1.0/up.mjs";
import { up as up_1_2_0 } from "../migrations/1.2.0/up.mjs";
import { up as up_1_3_0 } from "../migrations/1.3.0/up.mjs";
import { up as up_1_4_0 } from "../migrations/1.4.0/up.mjs";

const REGISTRY = [
  { version: "1.0.1", up: up_1_0_1 },
  { version: "1.1.0", up: up_1_1_0 },
  { version: "1.2.0", up: up_1_2_0 },
  { version: "1.3.0", up: up_1_3_0 },
  { version: "1.4.0", up: up_1_4_0 }
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
export function applyMigrations(files, migrations) {
  const result = { ...files };
  for (const migration of migrations) {
    const extra = migration.up(result);
    Object.assign(result, extra);
  }
  return result;
}
