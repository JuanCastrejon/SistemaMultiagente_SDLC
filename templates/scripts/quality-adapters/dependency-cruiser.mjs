// Adapter de formato "dependency-cruiser" (ADR 0007).
//
// Traduce el reporte JSON de `depcruise --output-type json` a metricas
// normalizadas. Un ciclo se distingue de una violacion comun porque
// dependency-cruiser anota `cycle` (la cadena de modulos) en la violacion que
// lo reporta; el resto de violaciones no trae ese campo.
export function parse(raw) {
  const report = JSON.parse(raw);
  const summary = report.summary ?? {};
  const violations = Array.isArray(summary.violations) ? summary.violations : [];
  const cycles = violations.filter((violation) => Array.isArray(violation.cycle) && violation.cycle.length > 0).length;
  const modulesScanned = typeof summary.totalCruised === "number"
    ? summary.totalCruised
    : Array.isArray(report.modules) ? report.modules.length : null;
  return {
    dependencies: {
      violations: violations.length,
      cycles,
      modules_scanned: modulesScanned
    }
  };
}
