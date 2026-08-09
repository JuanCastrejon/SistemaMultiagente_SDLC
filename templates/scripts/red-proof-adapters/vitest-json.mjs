// Adapter de formato "vitest-json" (ADR 0007, P10).
//
// Vitest (reporter --reporter=json, compatible con el formato de Jest)
// serializa los fallos como texto (stack trace), no como un objeto de error
// estructurado: no sobrevive un campo `error.name` al reporte JSON. La
// heuristica que distingue una ASERCION real (lo que expect()/assert()
// lanzan: `AssertionError`) de un error colateral (import roto, sintaxis,
// excepcion no relacionada, `throw new Error('not implemented')`) es el
// nombre de la clase de error en la primera linea del mensaje.
//
// HASTA DONDE LLEGA ESTA HEURISTICA, medido y no supuesto. Primera linea que
// produce cada caso:
//
//   asercion real      AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
//   legitima c/mensaje AssertionError [ERR_ASSERTION]: el pago debe rechazarse
//   FABRICADA imitando AssertionError [ERR_ASSERTION]: expected 1 to be 2
//   FABRICADA sin args AssertionError [ERR_ASSERTION]: undefined undefined undefined
//   colateral          Error: not implemented
//
// Las dos del medio son IDENTICAS en forma: una asercion legitima con mensaje
// propio y un `throw new AssertionError('...')` fabricado no se distinguen por
// texto, y ninguna regex lo arregla. Cerrar eso exige que el rojo lo emita un
// wrapper que ejecute la comparacion, o procedencia de CI -- ninguna de las dos
// existe hoy (ver `limitations` en src/red-proof.js).
//
// Lo que SI se puede cerrar aqui, y se cierra: la fabricacion perezosa. Un
// AssertionError construido sin argumentos deja la huella degenerada
// `undefined undefined undefined`, y un mensaje vacio tras el nombre de la
// clase tampoco describe comparacion alguna. Ninguno de los dos demuestra que
// el escenario este bien especificado.
const DEGENERATE = [
  /^undefined(\s+undefined)*$/, // `new AssertionError({})` sin actual/expected/operator
  /^$/ // nombre de clase sin mensaje
];

function classifyFailure(failureMessages) {
  const first = ((failureMessages ?? [])[0] ?? "").trim();
  if (!/^AssertionError\b/.test(first)) return "collateral-error";
  // La PRIMERA LINEA primero, y despues se quita el nombre de la clase: al
  // reves, el `\s*` final del patron se come el salto de linea y arrastra el
  // stack trace como si fuera el mensaje, con lo que un AssertionError sin
  // mensaje parecia traer uno.
  const body = first.split("\n")[0].replace(/^AssertionError\b(\s*\[[^\]]*\])?\s*:?[ \t]*/, "").trim();
  if (DEGENERATE.some((pattern) => pattern.test(body))) return "collateral-error";
  return "assertion-failed";
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
