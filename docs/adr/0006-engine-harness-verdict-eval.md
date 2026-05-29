# ADR 0006: Extensiones del engine para Governance Engineering (verdict, status, skill-eval)

- Estado: Propuesta
- Fecha: 2026-05-29
- Extiende: ADR 0005 (tool-hierarchy-and-operational-profiles)
- Consumidor: FacturacionDian change `governance-harness-enforcement` + `living-skills-eval-harness`

## Contexto

El engine ya expone `sdlc phase-gate` (informativo, exit 0 incluso con status "blocked"), `sdlc governance-check` (hash-lock + skill mirrors) y `sdlc tools-doctor` (harness health). Los consumidores (ej. FacturacionDian) necesitan:

1. Un **veredicto único READY/NOT-READY** que agregue el resultado de todos los validators en orden fail-fast, con clasificación BLOCKING vs WARNING y exit-code enforcing, para que el gate humano tenga un número contra el cual firmar.
2. Un **status go/no-go** que agregue governance-check + tools-doctor + phase-gate en un snapshot Markdown legible por humano con exit-code de CI.
3. Un flag **`--exit-code` para `sdlc phase-gate`** que devuelva exit no-cero cuando el contrato de fase está "blocked", con scoping correcto (no bloquea slices ajenas).
4. Un **eval-runner** y comandos **`sdlc skill-eval`/`sdlc skill-propose`** para el loop de skills vivas (P4–P5 de ADR-025 del host).

## Decisión

Se añaden cuatro extensiones al engine, como subcomandos delgados que reusan funciones existentes:

1. **`sdlc verdict`** (`commandVerdict`): corre los validators del host en orden fail-fast (invoca `pnpm run validate:*` en el target), clasifica cada uno como BLOCKING o WARNING según su exit code, emite un único objeto `{status: "ready"|"not-ready", verdict, blockers, warnings}` con exit 0/1/2. También escribe el resultado en `.github/agent-state/evidence/<slice>/<phase>-verdict.yaml` si se pasa `--write`.
2. **`sdlc status`** (`commandStatus`): agrega governance-check + tools-doctor + phase-gate en un snapshot `{governance: ..., tools: ..., phaseGate: ..., ready: bool}`. Con `--markdown --write` escribe `status.md` en el target. Con `--exit-code` sale no-cero si cualquier componente tiene error/blocked.
3. **`sdlc phase-gate --exit-code`**: flag que hace que el comando retorne exit no-cero cuando `evaluatePhaseReadiness` retorna "blocked". Sin el flag, el comportamiento actual (informativo, exit 0) se mantiene para compatibilidad.
4. **`sdlc skill-eval` / `sdlc skill-propose`**: primitivas del loop de skills vivas. `skill-eval` carga golden tasks de `.github/skills/<skill>/evals/*.yaml` y produce un score. `skill-propose` escribe una propuesta de diff bajo `openspec/changes/<change>/proposed-skill-diff.md` y NO toca `.github/skills/`.

## Consecuencias

### Positivas

- El consumidor gana un gate enforcing sin duplicar lógica.
- `phase-gate --exit-code` habilita hard-block de fase con scoping correcto (solo falla si la slice/fase activa del consumidor está blocked).
- `verdict` + `status` eliminan la necesidad de que el host interprete señales dispersas.
- `skill-eval`/`skill-propose` permiten el loop de skills vivas con gate humano y hook deny de P1 como salvaguarda.

### Negativas / Costos

- Crece la superficie del CLI del engine; requiere entradas en `tools-doctor` + tests.
- `verdict` depende de que el host tenga scripts `validate:*` en su `package.json`; si no existen, el veredicto reporta warning.
- El eval-runner P4 corre tasks deterministas (presencia de campos); el loop Rollout→Reflect full con LLM queda fuera de scope.

## Restricciones

- `skill-propose` MUST NOT crear/modificar archivos fuera de `openspec/changes/<change>/`.
- El flag `--exit-code` de `phase-gate` es opt-in (no rompe compatibilidad existente).
- Toda funcionalidad nueva incluye entradas en `tools-doctor` para que el host pueda verificar disponibilidad.

## Referencias

- `FacturacionDian: docs/adr/024-governance-engineering-harness.md`
- `FacturacionDian: docs/adr/025-living-skills-skillopt-loop.md`
- `FacturacionDian: openspec/changes/governance-harness-enforcement/`
- `FacturacionDian: openspec/changes/living-skills-eval-harness/`
