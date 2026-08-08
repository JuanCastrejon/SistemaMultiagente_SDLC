// Adapter de formato "istanbul-summary" (ADR 0007).
//
// Traduce coverage/coverage-summary.json a metricas normalizadas. `total` lo
// escribe el propio reporter de cobertura (nyc/vitest/jest); `changed` lo
// aumenta `sdlc coverage-diff`, que debe correr ANTES de este probe en el
// mismo script de package.json:
//
//   "validate:coverage": "vitest run --coverage && sdlc coverage-diff"
//
// Si `changed` no existe (coverage-diff no corrio), las metricas de lineas
// cambiadas quedan en null: el engine las reporta como `not-measured`, no
// como cero, que seria un falso verde.
export function parse(raw) {
  const report = JSON.parse(raw);
  const total = report.total ?? {};
  const changed = report.changed ?? {};
  return {
    coverage: {
      lines_pct: typeof total.lines?.pct === "number" ? total.lines.pct : null,
      statements_pct: typeof total.statements?.pct === "number" ? total.statements.pct : null,
      branches_pct: typeof total.branches?.pct === "number" ? total.branches.pct : null,
      functions_pct: typeof total.functions?.pct === "number" ? total.functions.pct : null,
      changed_lines_pct: typeof changed.pct === "number" ? changed.pct : null,
      changed_lines_total: typeof changed.total === "number" ? changed.total : null,
      // `degraded` (p.ej. "working-tree") significa que coverage-diff no
      // pudo comparar contra la base real: la metrica de arriba es genuina
      // pero mide contra el arbol de trabajo, no contra el diff del PR.
      changed_lines_degraded: changed.degraded ?? null
    }
  };
}
