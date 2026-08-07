import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adaptersDir = path.join(repoRoot, "templates", "scripts", "quality-adapters");

function adapterUrl(name) {
  return pathToFileURL(path.join(adaptersDir, `${name}.mjs`)).href;
}

// --- istanbul-summary --------------------------------------------------
const { parse: parseIstanbul } = await import(adapterUrl("istanbul-summary"));

const withChanged = parseIstanbul(
  JSON.stringify({
    total: { lines: { pct: 93.2 }, statements: { pct: 92 }, branches: { pct: 80 }, functions: { pct: 100 } },
    changed: { pct: 91, total: 22, covered: 20 }
  })
);
assert.equal(withChanged.coverage.lines_pct, 93.2);
assert.equal(withChanged.coverage.changed_lines_pct, 91);
assert.equal(withChanged.coverage.changed_lines_total, 22);

// coverage-diff no corrio todavia: `changed` no existe, y eso es null, no cero.
const withoutChanged = parseIstanbul(JSON.stringify({ total: { lines: { pct: 93 } } }));
assert.equal(withoutChanged.coverage.changed_lines_pct, null);
assert.equal(withoutChanged.coverage.changed_lines_total, null);

// --- dependency-cruiser --------------------------------------------------
const { parse: parseDepcruise } = await import(adapterUrl("dependency-cruiser"));

const depReport = parseDepcruise(
  JSON.stringify({
    summary: {
      totalCruised: 42,
      violations: [
        { rule: { name: "no-orphans" }, from: "a.ts", to: "b.ts" },
        { rule: { name: "no-circular" }, from: "a.ts", to: "b.ts", cycle: ["a.ts", "b.ts", "a.ts"] }
      ]
    },
    modules: []
  })
);
assert.equal(depReport.dependencies.violations, 2);
assert.equal(depReport.dependencies.cycles, 1);
assert.equal(depReport.dependencies.modules_scanned, 42);

const depClean = parseDepcruise(JSON.stringify({ summary: { violations: [] }, modules: [1, 2, 3] }));
assert.equal(depClean.dependencies.violations, 0);
assert.equal(depClean.dependencies.cycles, 0);
assert.equal(depClean.dependencies.modules_scanned, 3, "sin totalCruised, cae al conteo de modules");

// --- stryker --------------------------------------------------
const { parse: parseStryker } = await import(adapterUrl("stryker"));

const mutationReport = parseStryker(
  JSON.stringify({
    files: {
      "src/a.ts": {
        mutants: [
          { status: "Killed" },
          { status: "Survived" },
          { status: "NoCoverage" }
        ]
      },
      "src/b.ts": {
        mutants: [{ status: "Timeout" }, { status: "Killed" }]
      }
    }
  })
);
assert.equal(mutationReport.mutation.total, 5);
assert.equal(mutationReport.mutation.survived, 1);
assert.equal(mutationReport.mutation.no_coverage, 1);
assert.equal(mutationReport.mutation.killed, 2);
assert.equal(mutationReport.mutation.timeout, 1);

const emptyMutation = parseStryker(JSON.stringify({ files: {} }));
assert.equal(emptyMutation.mutation.total, 0);
assert.equal(emptyMutation.mutation.survived, 0);

console.log("quality-adapters: PASS");
