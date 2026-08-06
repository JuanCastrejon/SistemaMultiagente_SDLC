import assert from "node:assert/strict";
import {
  parseUnifiedDiffAddedLines,
  computeLineHitsFromIstanbul,
  computeChangedLinesCoverage
} from "../src/coverage-diff.js";

// --- parseUnifiedDiffAddedLines --------------------------------------------
const oneFileDiff = [
  "diff --git a/src/foo.ts b/src/foo.ts",
  "index 1111111..2222222 100644",
  "--- a/src/foo.ts",
  "+++ b/src/foo.ts",
  "@@ -10,0 +11,3 @@ function foo() {",
  "+  const a = 1;",
  "+  const b = 2;",
  "+  return a + b;",
  "@@ -30 +33 @@ function bar() {",
  "+  return 2;"
].join("\n");
const parsed = parseUnifiedDiffAddedLines(oneFileDiff);
assert.deepEqual([...parsed.get("src/foo.ts")].sort((a, b) => a - b), [11, 12, 13, 33]);

// Archivo borrado: `+++ /dev/null` no debe aportar lineas.
const deletedFileDiff = [
  "diff --git a/src/old.ts b/src/old.ts",
  "--- a/src/old.ts",
  "+++ /dev/null",
  "@@ -1,2 +0,0 @@",
  "-const x = 1;",
  "-const y = 2;"
].join("\n");
assert.equal(parseUnifiedDiffAddedLines(deletedFileDiff).size, 0);

// Sin diff, mapa vacio, nunca undefined.
assert.equal(parseUnifiedDiffAddedLines("").size, 0);
assert.equal(parseUnifiedDiffAddedLines(null).size, 0);

// --- computeLineHitsFromIstanbul -------------------------------------------
const fileCoverage = {
  statementMap: {
    "0": { start: { line: 1 }, end: { line: 1 } },
    "1": { start: { line: 2 }, end: { line: 2 } },
    "2": { start: { line: 5 }, end: { line: 7 } } // statement multilinea
  },
  s: { "0": 3, "1": 0, "2": 1 }
};
const hits = computeLineHitsFromIstanbul(fileCoverage);
assert.equal(hits.get(1), true);
assert.equal(hits.get(2), false);
assert.equal(hits.get(5), true);
assert.equal(hits.get(6), true);
assert.equal(hits.get(7), true);
assert.equal(hits.has(3), false, "linea sin statement no esta instrumentada");

// --- computeChangedLinesCoverage --------------------------------------------
const coverageFinal = {
  "/repo/src/foo.ts": {
    path: "/repo/src/foo.ts",
    statementMap: {
      "0": { start: { line: 11 }, end: { line: 11 } },
      "1": { start: { line: 12 }, end: { line: 12 } },
      "2": { start: { line: 13 }, end: { line: 13 } }
    },
    s: { "0": 5, "1": 0, "2": 5 }
  }
};
const changedLines = new Map([["src/foo.ts", new Set([11, 12, 13, 999])]]);
const result = computeChangedLinesCoverage({ coverageFinal, changedLines, repoRoot: "/repo" });
// Linea 999 cambio pero no esta instrumentada: no cuenta en el denominador.
assert.equal(result.changed_lines_total, 3);
assert.equal(result.changed_lines_covered, 2);
assert.equal(result.changed_lines_pct, 66.67);

// Sin lineas cambiadas en ningun archivo instrumentado: cero, no falso 100%.
const nothingChanged = computeChangedLinesCoverage({
  coverageFinal,
  changedLines: new Map([["src/otro.ts", new Set([1])]]),
  repoRoot: "/repo"
});
assert.equal(nothingChanged.changed_lines_total, 0);
assert.equal(nothingChanged.changed_lines_pct, 0);

console.log("coverage-diff: PASS");
