// ---------------------------------------------------------------------------
// coverage-diff (ADR 0007, P1)
//
// `F8.changed-lines-coverage` necesita "cuanto de lo que cambio esta
// cubierto", no "cuanto del repo esta cubierto". Istanbul solo reporta lo
// segundo por archivo en coverage-summary.json; esto cruza el diff de git
// (que lineas cambiaron) contra el detalle de statements de coverage-final.json
// (que lineas tienen hits) y escribe el resultado como `changed: {pct, total}`
// dentro de coverage-summary.json. El adapter `istanbul-summary.mjs` del
// consumidor traduce ese archivo ya aumentado a metricas; este modulo no sabe
// nada de gates ni de contratos, solo produce el numero.
//
// Todo lo que no toca fs/git es funcion pura, testeable sin fixtures en disco.
// ---------------------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathExists, toPosixPath } from "./file-utils.js";

const EXIT_OK = 0;
const EXIT_ERROR = 1;

// Parsea `git diff --unified=0`: devuelve Map<rutaPosix, Set<numeroDeLinea>>
// con las lineas del lado derecho de cada hunk (agregadas o modificadas). Un
// archivo borrado (`+++ /dev/null`) no aporta lineas cambiadas.
export function parseUnifiedDiffAddedLines(diffText) {
  const changed = new Map();
  let currentFile = null;
  for (const line of String(diffText ?? "").split("\n")) {
    if (line.startsWith("+++ ")) {
      const raw = line.slice(4).trim();
      currentFile = raw === "/dev/null" ? null : toPosixPath(raw.replace(/^b\//, ""));
      if (currentFile && !changed.has(currentFile)) changed.set(currentFile, new Set());
      continue;
    }
    if (line.startsWith("@@")) {
      const match = /@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!match || !currentFile) continue;
      const start = Number(match[1]);
      const count = match[2] === undefined ? 1 : Number(match[2]);
      const bucket = changed.get(currentFile);
      for (let n = start; n < start + count; n += 1) bucket.add(n);
    }
  }
  return changed;
}

// Deriva "la linea N esta cubierta?" desde statementMap/s de istanbul
// (coverage-final.json). Una linea sin ningun statement no esta instrumentada
// y no debe contar ni a favor ni en contra: no se puede juzgar lo que la
// herramienta no mide. Si varios statements tocan la misma linea, basta uno
// con hit para marcarla cubierta (aproximacion declarada, sin respaldo
// externo, igual que el resto de probes de este contrato).
export function computeLineHitsFromIstanbul(fileCoverage) {
  const hits = new Map();
  const statementMap = fileCoverage?.statementMap ?? {};
  const counts = fileCoverage?.s ?? {};
  for (const [stmtId, location] of Object.entries(statementMap)) {
    const startLine = location?.start?.line;
    const endLine = location?.end?.line ?? startLine;
    if (typeof startLine !== "number") continue;
    const hit = Number(counts[stmtId] ?? 0) > 0;
    for (let line = startLine; line <= endLine; line += 1) {
      hits.set(line, (hits.get(line) ?? false) || hit);
    }
  }
  return hits;
}

// Cruza lineas cambiadas con cobertura real. `coverageFinal` es el objeto
// completo de coverage-final.json (clave = ruta absoluta del archivo
// instrumentado). `changedLines` es lo que devuelve parseUnifiedDiffAddedLines,
// con rutas relativas POSIX al repo. `repoRoot` ancla la comparacion.
export function computeChangedLinesCoverage({ coverageFinal = {}, changedLines = new Map(), repoRoot = process.cwd() } = {}) {
  let total = 0;
  let covered = 0;
  for (const [absoluteKey, fileCoverage] of Object.entries(coverageFinal)) {
    const relative = toPosixPath(path.relative(repoRoot, fileCoverage?.path ?? absoluteKey));
    const lines = changedLines.get(relative);
    if (!lines || lines.size === 0) continue;
    const hits = computeLineHitsFromIstanbul(fileCoverage);
    for (const line of lines) {
      if (!hits.has(line)) continue;
      total += 1;
      if (hits.get(line)) covered += 1;
    }
  }
  return {
    changed_lines_total: total,
    changed_lines_covered: covered,
    changed_lines_pct: total > 0 ? Number(((covered / total) * 100).toFixed(2)) : 0
  };
}

function runGit(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// Resuelve la base de comparacion: el ref explicito si vino, si no el HEAD
// remoto por defecto, si no origin/main, y si nada de eso existe (repo local
// sin remoto, recien inicializado) HEAD~1.
export function resolveBaseRef(cwd, requested) {
  if (requested) return requested;
  const remoteHead = runGit(["symbolic-ref", "refs/remotes/origin/HEAD"], cwd);
  if (remoteHead.ok && remoteHead.stdout.trim()) {
    return remoteHead.stdout.trim().replace("refs/remotes/", "");
  }
  if (runGit(["rev-parse", "--verify", "origin/main"], cwd).ok) return "origin/main";
  return "HEAD~1";
}

export function getGitDiffAddedLines({ cwd, baseRef }) {
  const resolved = resolveBaseRef(cwd, baseRef);
  const diff = runGit(["diff", "--unified=0", "--no-color", `${resolved}...HEAD`], cwd);
  if (diff.ok) {
    return { baseRef: resolved, lines: parseUnifiedDiffAddedLines(diff.stdout), degraded: null };
  }
  // Sin historial suficiente (repo recien inicializado, ref inexistente):
  // degradar al diff contra el arbol de trabajo en vez de reventar.
  const working = runGit(["diff", "--unified=0", "--no-color"], cwd);
  return { baseRef: resolved, lines: parseUnifiedDiffAddedLines(working.stdout), degraded: "working-tree" };
}

export function runCoverageDiff({
  target,
  baseRef = null,
  coverageFinalPath = "coverage/coverage-final.json",
  summaryPath = "coverage/coverage-summary.json"
} = {}) {
  const finalAbsolute = path.join(target, coverageFinalPath);
  if (!pathExists(finalAbsolute)) {
    return {
      ok: false,
      code: "coverage-final-missing",
      detail: `no existe ${coverageFinalPath}; el reporter de cobertura debe emitir el formato detallado ademas del resumen`
    };
  }
  const coverageFinal = JSON.parse(fs.readFileSync(finalAbsolute, "utf8"));
  const diff = getGitDiffAddedLines({ cwd: target, baseRef });
  const changed = computeChangedLinesCoverage({ coverageFinal, changedLines: diff.lines, repoRoot: target });

  const summaryAbsolute = path.join(target, summaryPath);
  const existing = pathExists(summaryAbsolute) ? JSON.parse(fs.readFileSync(summaryAbsolute, "utf8")) : {};
  const merged = {
    ...existing,
    changed: { pct: changed.changed_lines_pct, total: changed.changed_lines_total, covered: changed.changed_lines_covered }
  };
  fs.mkdirSync(path.dirname(summaryAbsolute), { recursive: true });
  fs.writeFileSync(summaryAbsolute, JSON.stringify(merged, null, 2), "utf8");
  return { ok: true, baseRef: diff.baseRef, degraded: diff.degraded, summary: merged, ...changed };
}

/**
 * `sdlc coverage-diff` (ADR 0007, P1)
 *
 * Se encadena despues del test runner: `vitest run --coverage && sdlc coverage-diff`.
 * No adjudica nada, solo deja `changed.pct`/`changed.total` listos para que el
 * adapter `istanbul-summary` los traduzca a `coverage.changed_lines_pct`.
 */
export function commandCoverageDiff(options = {}) {
  const target = path.resolve(options.target ?? process.cwd());
  const result = runCoverageDiff({
    target,
    baseRef: options["base-ref"] ?? options.baseRef ?? null,
    coverageFinalPath: options["coverage-final"] ?? options.coverageFinal ?? "coverage/coverage-final.json",
    summaryPath: options.summary ?? "coverage/coverage-summary.json"
  });
  if (!result.ok) {
    return { exitCode: EXIT_ERROR, payload: { status: "error", ...result } };
  }
  return {
    exitCode: EXIT_OK,
    payload: {
      status: "ok",
      base_ref: result.baseRef,
      degraded: result.degraded,
      changed_lines_total: result.changed_lines_total,
      changed_lines_covered: result.changed_lines_covered,
      changed_lines_pct: result.changed_lines_pct
    }
  };
}
