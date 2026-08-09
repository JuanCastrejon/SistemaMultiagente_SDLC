// ---------------------------------------------------------------------------
// Origen EFECTIVO de una medicion (ADR 0007, P8 — hallazgo de auditoria)
//
// `--source ci` era un string que el propio invocador escribia en la linea de
// comandos, y nada lo cruzaba contra la realidad: `grep GITHUB_ACTIONS src/`
// daba cero resultados. `promoteBaseline` ya cerraba el ataque ingenuo
// (escribir evidencia local con `source: harness` y luego promoverla mintiendo
// `--source ci`), pero no uno consistente: correr `quality-gate --run
// --source ci` y DESPUES `quality-baseline --promote --source ci` desde la
// misma maquina producia una cadena internamente coherente y completamente
// falsa. Toda la separacion "el arbitro es CI, no el harness local" (D1)
// descansaba en un flag que el evaluado se autoconcede.
//
// Que garantiza esto y que NO: comprobar variables de entorno no es una
// barrera criptografica — quien controla la maquina puede exportar
// `GITHUB_ACTIONS=true`. Lo que si cierra es (a) el caso real y frecuente de
// un desarrollador que teclea `--source ci` por costumbre o por atajo y marca
// evidencia como autoritativa sin darse cuenta, y (b) la afirmacion, mas
// fuerte de lo que el codigo sostenia, de que `source: ci` significaba algo
// verificado. Contra un atacante con push a la rama de integracion no protege
// nada, pero ese atacante ya tiene control total bajo
// `threat_model: single-maintainer` — no es una escalada de privilegio.
// ---------------------------------------------------------------------------

/**
 * Detecta si el proceso corre de verdad dentro de un runner de CI.
 *
 * GitHub Actions es el unico provider reconocido con certeza porque es el que
 * este framework entrega (`templates/.github/workflows/quality-verify.yml`).
 * `CI=true` generico se acepta como provider `unknown-ci`: no vale menos que
 * la alternativa de rechazar a todo consumidor que use GitLab o Jenkins, y
 * queda registrado en la evidencia para que un revisor lo vea.
 */
export function detectCiEnvironment(env = process.env) {
  if (env.GITHUB_ACTIONS === "true") {
    return { isCi: true, provider: "github-actions", runId: env.GITHUB_RUN_ID ?? null };
  }
  if (env.CI === "true" || env.CI === "1") {
    return { isCi: true, provider: "unknown-ci", runId: null };
  }
  return { isCi: false, provider: null, runId: null };
}

/**
 * Resuelve el origen EFECTIVO a partir del declarado. `--source ci` fuera de
 * un runner se degrada a `harness` en vez de fallar: el comando sigue siendo
 * util en local (esa es la corrida advisory de siempre), solo deja de poder
 * autodeclararse autoritativa. La degradacion se reporta explicitamente para
 * que no ocurra en silencio.
 *
 * @returns {{source: string, declared: string, downgraded: boolean, ci: object, reason: string|null}}
 */
export function resolveEffectiveSource(declared, env = process.env) {
  const ci = detectCiEnvironment(env);
  if (declared !== "ci") {
    return { source: declared === "harness" ? "harness" : declared ?? "harness", declared: declared ?? null, downgraded: false, ci, reason: null };
  }
  if (ci.isCi) {
    return { source: "ci", declared: "ci", downgraded: false, ci, reason: null };
  }
  return {
    source: "harness",
    declared: "ci",
    downgraded: true,
    ci,
    reason:
      "se declaro --source ci pero el proceso no corre en un runner de CI (ni GITHUB_ACTIONS ni CI estan activas): la medicion se registra como harness, que es advisory"
  };
}
