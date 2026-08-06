# ADR 0007: Gauntlet de calidad verificable sobre las fases F0-F17

- Estado: Propuesta
- Fecha: 2026-08-05
- Extiende: ADR 0006 (engine-harness-verdict-eval)
- Investigación: `docs/research/2026-08-quality-gauntlet-agentic.md`
- Consumidor piloto: `PasarelaDePago`

## Contexto

El framework instala un contrato de fases F0-F17 con evidencia por fase, pero **esa tubería está vacía**: `phase-gate` solo comprueba que el archivo de evidencia exista, `schemas/phase-evidence.schema.json` se instala y ningún código lo compila, `validators_run[]` no lo lee nadie y `human_gate: true` no se enforcea. Además, `commandVerdict` invoca los scripts del consumidor con `--if-present`, de modo que un paso BLOCKING inexistente se reporta `pass`: hoy el piloto aprueba en verde dos validators que no tiene definidos.

Se quiere adoptar la estrategia que Robert C. Martin documenta e implementa para trabajar con agentes: no revisar el código generado, sino rodear al agente de restricciones automáticas —tests, Gherkin, métricas, mutación y QA— de modo que el código demuestre por sí mismo que funciona.

## Decisión

Se adopta un **gauntlet de calidad contract-first con árbitro externo**, en cinco decisiones estructurales.

### D1. El árbitro es CI, no el harness local

El harness local calcula los controles y **se autodeclara advisory** en su payload. El veredicto que cuenta se produce donde el agente no escribe: un workflow que **re-ejecuta** los controles bloqueantes baratos y compara lo recomputado contra lo declarado. La discrepancia (`evidence-mismatch`) es el detector de fraude.

Corolario obligatorio: ese workflow instala el CLI **por versión publicada y pinneada**, nunca por `npm link`. Hoy los tres consumidores resuelven el CLI al mismo working copy del framework, con lo que el código que juzga es editable por el juzgado.

### D2. La evidencia se anexa, no se redacta

Ningún agente escribe `quality_metrics` a mano. Nuevo `src/evidence-writer.js`: el harness ejecuta el probe, lee el reporte nativo, calcula el hash del árbol de fuentes evaluadas y anexa un bloque en modo append-only. Escribir evidencia a mano pasa a ser una violación detectable.

La firma humana deja de ser un string: se deriva de un review `APPROVED` verificado por `gh api` sobre el `head_sha` exacto, con allowlist de logins y `dismiss-stale-reviews` activo.

### D3. No-vacuidad antes que umbral

Todo gate declara `min_denominator`. `survived == 0` sobre cero mutantes, `failed == 0` sobre cero tests E2E y `violations == 0` sobre una superficie cuyo path no existe son PASS hoy y son el modo de fallo más peligroso del sistema. El engine emite `gate-vacuous` **antes** de aplicar el operador.

### D4. Escalera obligatoria: observa → ratchet → absoluto

Ningún control nace absoluto. Los umbrales de Martin son de su stack y de proyectos personales sin regulación; aplicados de golpe a un repo con 7 tests y cero cobertura instrumentada bloquean el primer PR por deuda ajena, y entonces el equipo apaga el gate.

**Tabla única control × release × modo. Esta tabla es la fuente de verdad; deroga cualquier otra mención.**

| Control | 1.9 | 1.10 | 1.11 | 1.12 |
|---|---|---|---|---|
| spec-boundary | bloquea | bloquea | bloquea | bloquea |
| spec-trace (SC-### ↔ test) | observa | bloquea | bloquea | bloquea |
| proof-of-red (F5) | observa | bloquea | bloquea | bloquea |
| canary-mutants | observa | observa | ratchet | bloquea |
| changed-line coverage | observa | observa | ratchet | ratchet |
| CRAP | observa | observa | ratchet | ratchet (nunca absoluto) |
| module-size (sitios de mutación) | observa | observa | observa | observa |
| dependency rules | observa | ratchet | ratchet | bloquea |
| duplicación (jscpd) | observa | observa | observa | observa |
| mutación de código | — | — | observa | bloquea (solo tier core) |
| QA caja negra (E2E) | — | observa | observa | bloquea (tier core / money_path) |

`dependency rules` no salta a absoluto en 1.9 aunque nazca limpio: la excepción contradecía el principio y se elimina.

### D5. El engine no sabe de stacks

Cero adapters de Vitest, Stryker o Playwright dentro del framework. El consumidor declara `probe {command, emits, format}` y el engine lee un **sobre normalizado** con schema propio. Los adapters JS/TS se publican como paquete opcional aparte. Hay un consumidor que es Python con un `package.json` shim: si el adapter vive en el engine, el framework deja de ser portable.

## Reubicación del gate humano

**No se añade un quinto gate humano.** Cambia el *contenido* del gate existente de F4, que pasa a firmar la especificación (Gherkin en prosa + procedimientos de QA + tier). F13 **sigue bloqueante para tier core y money_path**; su degradación para tier standard y shell queda como decisión de gobierno, no como default silencioso.

Se propone además colapsar F2 y F3 en una sola firma, lo que baja de cuatro a tres los round-trips humanos por slice y paga el contenido añadido a F4. Es decisión de proceso y requiere aprobación.

## Matriz F0-F17

| Fase | Modo | Control | Evidencia |
|---|---|---|---|
| F0 | bloquea | `sdlc-resolvable`, `surface-path-exists`, sin placeholders en config | `F0.yaml` bloque `install_health` |
| F1 | observa | Declaración de tier y `money_path` por superficie; baseline de masa (CC total, sitios) | `F1.yaml` bloque `scope` |
| F2 | gate-humano | Existente. El borrador enumera escenarios candidatos `SC-###` | review del Issue |
| F3 | gate-humano | Existente. Herencia de `SC-###` hacia el Issue | `F3.yaml` |
| F3.5 | bloquea | `spec-boundary-baseline`: merge-base remoto + sha256 de cada archivo protegido | `F3_5.yaml` bloque `spec_boundary` |
| F4 | gate-humano | **Contenido nuevo**: firma de la especificación y de los procedimientos de QA | `F4.yaml` con `review_id`, `reviewer_login`, `head_sha` |
| F5 | bloquea | `failing-first` verificado por `workflow_run_id` en CI | `F5.yaml` bloque `scenario_traceability` |
| F6 | observa | `probe-availability`: todo probe del tier existe como script real | `F6.yaml` bloque `probe_budget` |
| F7 | n/a | Sin control. No produce artefactos verificables propios | — |
| F8 | ratchet | `canary-mutants`, changed-line coverage, CRAP, module-size, DRY | `F8.yaml` bloque `quality_metrics` |
| F9 | bloquea | Fail-fast barato→caro: unitarias → aceptación → cobertura → CRAP → mutación → DRY | `F9.yaml` + `reports[{path, sha256, tree_hash}]` |
| F10 | bloquea | Dirección de dependencias y ciclos (reglas transitivas); inventario de supresiones | `F10.yaml` bloque `dependencies` |
| F11 | bloquea | `spec-boundary` recalculado; evidencia append-only no reescrita | `F11.yaml` bloque `boundary_check` |
| F12 | bloquea | **Re-ejecución autoritativa en CI** + `evidence-mismatch` | `F12.yaml` bloque `verification` |
| F13 | gate-humano | Existente. QA de caja negra por UI, sin API interna | `F13.yaml` bloque `qa_blackbox` |
| F14 | gate-humano | Existente + `ratchet-guard` contra el baseline de la rama de integración | `F14.yaml` bloque `ratchet` |
| F15 | observa | Promoción del baseline; telemetría de tendencia | `quality-baseline.yaml` + JSONL |
| F16 | observa | Promoción de los `SC-###` del change a specs canónicas | `F16.yaml` bloque `promoted` |
| F17 | observa | Tendencia publicada; inventario de waivers vencidos | `status.md` |

## Roadmap

| Release | Alcance | Criterio de salida |
|---|---|---|
| **1.8.0** — entregabilidad | `sdlc upgrade --accept-managed`, `.sdlc/overrides.yaml` con `expires_at`, `sdlc reconcile`, migraciones que leen disco, precheck de scripts en `verdict`, arreglo de `validate-local-gate.ps1`, pin de `@fission-ai/openspec`. **Cero gates de calidad.** | `upgrade` completa sin abortar en los 3 consumidores (hoy 0 de 3) |
| **1.9.0** — observación y árbitro | `src/quality-gates.js` (función pura con no-vacuidad), `evidence-validator`, `evidence-writer`, `phase-contract` v2, `quality-contract.yaml`, workflow `quality-verify.yml` | Un slice recorre F0-F17 con evidencia anexada por el harness; un intento de editar `quality_metrics` a mano es detectado |
| **1.10.0** — especificación primero | F4 firma la especificación vía review verificado; F5 gana el gate mecánico de rojo; artefacto OpenSpec `acceptance` | Ningún slice llega a F8 sin escenarios firmados y demostrados en rojo en un run que no contiene la implementación |
| **1.11.0** — ratchet | Baseline versionado, guard anti-regresión y anti-degradación, `NOT_CONFIGURED` pasa a BLOCKING | Dos meses sin que un PR legítimo sea bloqueado por deuda preexistente |
| **1.12.0** — mutación y absolutos acotados | Stryker fuera del camino de PR, adjudicado por `tree_hash`; absolutos solo para tier core con dos releases en ratchet verde | Camino de PR sigue < 5 min |

Backlog sin release asignada, declarado explícitamente para no venderlo como cubierto: mutación de escenarios Gherkin, métricas de secuencia principal, adapters Python.

## Presupuestos

- Camino de PR ≤ 5 min · payload de evidencia ≤ 256 KB por fase · timeout por probe declarado (mutación 3.600.000 ms, resto ≤ 120.000 ms).
- Los probes de gate corren con `TURBO_FORCE=1`. **Desviación consciente** del principio de aprovechar caché: con cache hit, Turbo restaura `coverage/` sin ejecutar nada y el gate certificaría un árbol nunca medido.

## Umbrales iniciales para el piloto

Punto de partida medido: 7 tests, 0 cobertura instrumentada, sin `vitest.config`, lint y e2e rotos, 16 de 18 fuentes sin test, 25 escenarios con 3 cubiertos.

- **Cobertura**: sin umbral absoluto en 1.x. Gate sobre líneas cambiadas del diff. La cobertura agregada no se usa ni como señal: con `coverage.all` eliminado en Vitest 4, un archivo nuevo sin tests no entra al denominador.
- **CRAP**: nunca absoluto, solo ratchet por función. Ver la identidad `CRAP(cov=1) = CC` en la investigación.
- **Canary mutants**: `survived == 0` con `canaries_run >= 5`. Único control de discriminación barato, determinista y siempre accionable.
- **Mutación**: solo `payment-core`, desde 1.12, `survived == 0 AND noCoverage == 0` sobre el delta. Excluidos los módulos de datos declarativos.
- **Dependencias**: 0 violaciones y 0 ciclos, con `modules_scanned >= 10` como denominador mínimo.
- **Escenarios**: `SC-###` obligatorio solo para escenarios nuevos o modificados. Los 25 existentes quedan `legacy-unversioned` y exentos de forma permanente.

## Correcciones aplicadas tras la verificación de completitud

El plan sintetizado se sometió a un crítico de completitud, cuyo veredicto fue *implementable-con-correcciones*. Se incorporan:

1. El árbitro se ancla por versión publicada del CLI; deja de ser decisión diferida y pasa a regla de 1.8.0.
2. El `proof-of-red` gana condición de diff: el árbol en el commit rojo no debe contener los símbolos exportados que la implementación introduce. Un run rojo no distingue "implementación ausente" de "implementación stubeada".
3. `min_denominator` instanciado en los tres gates que no lo tenían: dependencias, F5 y F4.
4. Contradicción de escalones resuelta con la tabla única de D4.
5. `maintainers-list` y el contenido de `governance_locked` pasan a entregables de 1.8.0 con default conservador, porque bloquean 1.9 y 1.10.
6. Retirada de controles medible: evento de telemetría `gate-block{control_id, slice, resolution: fixed|waived|false-positive}`, clasificado por el humano que lo cierra. Un criterio de retirada sin instrumentación no es un criterio.
7. El catálogo del canario y `validate-canary-mutants.mjs` entran en `governance_locked`: son la única prueba de que el gauntlet detecta algo.
8. El ratchet de CRAP declara política de renombres y movimientos: sin ella, renombrar una función la saca del baseline y borra la regresión.

## Consecuencias

### Positivas

- El `READY` del harness pasa de ser una afirmación a ser recomputable por un tercero.
- Cierra el gate fantasma: dos pasos BLOCKING del piloto se reportan `pass` hoy sin ejecutarse.
- La especificación queda fuera del alcance de escritura del agente, que es la precondición de todo lo demás.
- El framework gana entregabilidad real: hoy `upgrade` no puede llegar a ninguno de los tres consumidores.

### Negativas y costes

- 1.8.0 es una release sin ninguna funcionalidad de calidad visible y es la más ingrata; sin ella el resto no existe.
- Los devDeps nuevos y los navegadores de Playwright suben `npm ci` de ~45 s a 2-3 min por job, coste que se paga incluso en PRs de documentación.
- Matar supervivientes suele requerir 2-4 vueltas y cada vuelta es un F9 completo: el coste de *pasar* F9 puede ser 3-4 veces el de una pasada.
- Escribir tests para 16 de 18 fuentes del piloto no lo hace el framework. Sin dueño y presupuesto, el roadmap se detiene en 1.9.

## Decisiones que requieren juicio humano

1. Aceptar o no "nadie lee el código" en rutas de dinero. Recomendación: preservar revisión humana del diff para `money_path` mientras el gauntlet no tenga historial propio.
2. Degradar F13 para tier standard y shell en un dominio de pagos.
3. Colapsar F2 y F3 en una sola firma.
4. Quiénes están en `maintainers-list`: de esa lista depende todo el modelo de amenaza.
5. Cupo de escenarios por slice que un humano se compromete a leer. **Es el único punto de fallo del sistema entero**: sin cupo, el agente firmará 40 escenarios que nadie leyó.
6. Política ante fraude detectado cuando salte `evidence-mismatch`.
7. Retención de evidencia y reportes, con implicaciones de auditoría en pagos.
8. Dueño y presupuesto de la habilitación del piloto.
9. Dejar de resolver el CLI por `npm link` global en los consumidores.

## Primer paso

Un solo cambio, con test de regresión, sin tocar ningún archivo gestionado del consumidor: añadir en `commandVerdict` (`src/harness.js`) un precheck de existencia contra `packageJson.scripts` antes de invocar el package manager, y clasificar el paso ausente como `NOT_CONFIGURED` en vez de `pass`.

Verificación binaria e inmediata: `sdlc verdict --target <piloto> --json` debe dejar de reportar `adr-integrity` y `active-slices` como `pass`, revelando que el `READY` actual es falso.
