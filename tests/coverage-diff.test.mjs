import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseUnifiedDiffAddedLines,
  computeLineHitsFromIstanbul,
  computeChangedLinesCoverage,
  runCoverageDiff
} from "../src/coverage-diff.js";
import { parse as parseIstanbulSummary } from "../templates/scripts/quality-adapters/istanbul-summary.mjs";

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

// --- E2E: runCoverageDiff contra un repo git real ---------------------------
// `parseUnifiedDiffAddedLines` arriba solo se prueba contra texto ya
// parseado a mano; `runCoverageDiff`/`getGitDiffAddedLines` nunca tenian
// cobertura contra un `git diff` REAL, que es exactamente donde vivian los
// bugs de P13-hermanos (quotePath, maxBuffer, degradar en silencio).
function git(args, cwd) {
  execFileSync("git", args, { cwd, encoding: "utf8" });
}

function initRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-coverage-diff-"));
  git(["init", "--quiet"], dir);
  git(["config", "user.email", "test@example.com"], dir);
  git(["config", "user.name", "Test"], dir);
  return dir;
}

// --- ruta con tilde: el fix de core.quotePath=false debe hacerla visible ---
{
  const dir = initRepo();
  fs.writeFileSync(path.join(dir, "base.js"), "const base = 1;\n", "utf8");
  git(["add", "-A"], dir);
  git(["commit", "--quiet", "-m", "base"], dir);
  git(["update-ref", "refs/remotes/origin/main", "HEAD"], dir);

  fs.mkdirSync(path.join(dir, "módulo"), { recursive: true });
  fs.writeFileSync(path.join(dir, "módulo", "año.js"), "function f() {\n  return 1;\n}\n", "utf8");
  git(["add", "-A"], dir);
  git(["commit", "--quiet", "-m", "archivo con tilde"], dir);

  const coverageFinal = {
    [path.join(dir, "módulo", "año.js")]: {
      path: path.join(dir, "módulo", "año.js"),
      statementMap: { "0": { start: { line: 2 }, end: { line: 2 } } },
      s: { "0": 0 } // linea sin cubrir a proposito
    }
  };
  fs.mkdirSync(path.join(dir, "coverage"), { recursive: true });
  fs.writeFileSync(path.join(dir, "coverage", "coverage-final.json"), JSON.stringify(coverageFinal), "utf8");

  const result = runCoverageDiff({ target: dir, baseRef: "origin/main" });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(
    result.changed_lines_total,
    1,
    "un archivo cambiado con tilde/ene debe contar en el denominador, no desaparecer por el escape octal de git"
  );
  assert.equal(result.changed_lines_covered, 0, "la linea sin cubrir del archivo con tilde debe verse, no esconderse");
  assert.equal(result.degraded, null, "con base real resuelta, no hay degradacion");
}

console.log("coverage-diff e2e (ruta con tilde): PASS");

// --- degradacion (sin base resoluble): debe persistirse, no perderse -------
{
  const dir = initRepo();
  fs.writeFileSync(path.join(dir, "base.js"), "const base = 1;\n", "utf8");
  git(["add", "-A"], dir);
  git(["commit", "--quiet", "-m", "unico commit, sin remoto, sin HEAD~1"], dir);
  // Un solo commit: HEAD~1 no existe y no hay origin/main -> resolveBaseRef
  // cae a "HEAD~1", que refExists() debe reportar como inexistente ->
  // degradar de forma transparente al arbol de trabajo.
  fs.writeFileSync(path.join(dir, "base.js"), "const base = 2; // sin commitear\n", "utf8");

  const coverageFinal = {};
  fs.mkdirSync(path.join(dir, "coverage"), { recursive: true });
  fs.writeFileSync(path.join(dir, "coverage", "coverage-final.json"), JSON.stringify(coverageFinal), "utf8");

  const result = runCoverageDiff({ target: dir });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.degraded, "working-tree");
  // El flag de degradacion tiene que sobrevivir en el ARCHIVO que el adapter
  // lee -- si solo vive en el payload del CLI, el motor de gates nunca lo ve
  // (mismo fallo de fondo que P2#4: un fail-open que no deja rastro donde
  // importa).
  const persisted = JSON.parse(fs.readFileSync(path.join(dir, "coverage", "coverage-summary.json"), "utf8"));
  assert.equal(persisted.changed.degraded, "working-tree");

  const parsed = parseIstanbulSummary(JSON.stringify(persisted));
  assert.equal(
    parsed.coverage.changed_lines_degraded,
    "working-tree",
    "el adapter debe exponer la degradacion, no solo pct/total como si la medicion fuera contra la base real"
  );
}

console.log("coverage-diff e2e (degradacion persistida): PASS");
