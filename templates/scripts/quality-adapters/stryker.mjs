// Adapter de formato "stryker" (ADR 0007).
//
// Traduce un reporte mutation-testing-report-schema (el JSON que emite
// Stryker con `--reporters json`) a metricas normalizadas. El schema agrupa
// mutantes por archivo; aqui se agregan sobre todo el reporte porque los
// gates de F9 juzgan la superficie completa, no archivo por archivo.
const COUNTED_STATUSES = new Set(["Survived", "NoCoverage", "Killed", "Timeout", "CompileError", "RuntimeError", "Ignored"]);

export function parse(raw) {
  const report = JSON.parse(raw);
  const files = report.files ?? {};
  let total = 0;
  let survived = 0;
  let noCoverage = 0;
  let killed = 0;
  let timeout = 0;

  for (const file of Object.values(files)) {
    for (const mutant of file?.mutants ?? []) {
      if (!COUNTED_STATUSES.has(mutant.status)) continue;
      total += 1;
      if (mutant.status === "Survived") survived += 1;
      else if (mutant.status === "NoCoverage") noCoverage += 1;
      else if (mutant.status === "Killed") killed += 1;
      else if (mutant.status === "Timeout") timeout += 1;
    }
  }

  return {
    mutation: {
      total,
      survived,
      no_coverage: noCoverage,
      killed,
      timeout
    }
  };
}
