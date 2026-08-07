// Adapter de formato "vitest-json" (ADR 0007, P10).
//
// Vitest (reporter --reporter=json, compatible con el formato de Jest)
// serializa los fallos como texto (stack trace), no como un objeto de error
// estructurado: no sobrevive un campo `error.name` al reporte JSON. La
// heuristica que distingue una ASERCION real (lo que expect()/assert()
// lanzan: `AssertionError`) de un error colateral (import roto, sintaxis,
// excepcion no relacionada, `throw new Error('not implemented')`) es el
// nombre de la clase de error en la primera linea del mensaje. Es una
// heuristica declarada, no una garantia -- igual que el resto de probes de
// este contrato.
function classifyFailure(failureMessages) {
  const first = (failureMessages ?? [])[0] ?? "";
  return /^AssertionError\b/.test(first.trim()) ? "assertion-failed" : "collateral-error";
}

function buildTestRef(fileResult, assertion) {
  const filePath = fileResult.name ?? fileResult.testFilePath ?? "";
  const ancestry = [...(assertion.ancestorTitles ?? []), assertion.title].filter(Boolean);
  return `${filePath} > ${ancestry.join(" > ")}`;
}

export function parse(raw) {
  const report = JSON.parse(raw);
  const results = [];
  for (const fileResult of report.testResults ?? []) {
    for (const assertion of fileResult.assertionResults ?? []) {
      const testRef = buildTestRef(fileResult, assertion);
      let outcome;
      if (assertion.status === "passed") outcome = "passed";
      else if (assertion.status === "failed") outcome = classifyFailure(assertion.failureMessages);
      else outcome = "not-run";
      results.push({ test_ref: testRef, outcome });
    }
  }
  return { results };
}
