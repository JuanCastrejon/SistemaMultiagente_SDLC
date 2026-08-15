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

> **SUPERSEDIDO** — ver el [addendum de 2026-08-14](#addendum-firma-supersedida). Ni el mecanismo (`gh api` sobre un review) ni el disparador (`tier`) son ya los de este ADR.

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

> **SUPERSEDIDO en su parte de autorización** — la frase «bloqueante para tier core y money_path» es exactamente el anclaje que el ADR 0008 D1 elimina. Ver el [addendum](#addendum-firma-supersedida). Lo que F13 *mide* no cambia; lo que cambia es qué obliga a firmarlo.

Se propone además colapsar F2 y F3 en una sola firma, lo que baja de cuatro a tres los round-trips humanos por slice y paga el contenido añadido a F4. Es decisión de proceso y requiere aprobación.

## Matriz F0-F17

| Fase | Modo | Control | Evidencia |
|---|---|---|---|
| F0 | bloquea | `sdlc-resolvable`, `surface-path-exists`, sin placeholders en config | `F0.yaml` bloque `install_health` |
| F1 | observa | Declaración de tier y `money_path` por superficie; baseline de masa (CC total, sitios) | `F1.yaml` bloque `scope` |
| F2 | gate-humano | Existente. El borrador enumera escenarios candidatos `SC-###` | review del Issue |
| F3 | gate-humano | Existente. Herencia de `SC-###` hacia el Issue | `F3.yaml` |
| F3.5 | bloquea | `spec-boundary-baseline`: merge-base remoto + sha256 de cada archivo protegido | `F3_5.yaml` bloque `spec_boundary` |
| F4 | gate-humano | **Contenido nuevo**: firma de la especificación y de los procedimientos de QA | ~~`F4.yaml` con `review_id`, `reviewer_login`, `head_sha`~~ **SUPERSEDIDO**: la evidencia de firma es la atestación por commit firmado; ver [addendum](#addendum-firma-supersedida) |
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
| **1.10.0** — especificación primero | F4 firma la especificación ~~vía review verificado~~ (**SUPERSEDIDO**: vía commit firmado, ver [addendum](#addendum-firma-supersedida)); F5 gana el gate mecánico de rojo; artefacto OpenSpec `acceptance` | Ningún slice llega a F8 sin escenarios firmados y demostrados en rojo en un run que no contiene la implementación |
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
2. ~~Degradar F13 para tier standard y shell en un dominio de pagos.~~
   **SUPERSEDIDO** — la pregunta ya no se plantea así: el ADR 0008 D1 saca la
   obligación de firma de `tier` y la deriva de riesgos declarados por
   superficie. Degradar el tier de una superficie de pagos ya no puede quitar
   la firma; solo baja el umbral de cobertura, que es una decisión distinta.
   Ver [addendum](#addendum-firma-supersedida).
3. Colapsar F2 y F3 en una sola firma.
4. Quiénes están en `maintainers-list`: de esa lista depende todo el modelo de amenaza.
5. Cupo de escenarios por slice que un humano se compromete a leer. **Es el único punto de fallo del sistema entero**: sin cupo, el agente firmará 40 escenarios que nadie leyó.
6. Política ante fraude detectado cuando salte `evidence-mismatch`.
7. Retención de evidencia y reportes, con implicaciones de auditoría en pagos.
8. Dueño y presupuesto de la habilitación del piloto.
9. Dejar de resolver el CLI por `npm link` global en los consumidores.

## Estado de implementación

Piezas de 1.8.0 ya entregadas en la rama `feature/entregabilidad-y-gauntlet-adr-0007`, todas con caso de regresión:

| Pieza | Estado | Verificación |
|---|---|---|
| Gate fantasma en `verdict` | hecho | En el piloto, `adr-integrity` y `active-slices` pasan de `pass` a `not-configured` |
| `upgrade --accept-managed` / `--accept-all-managed` | hecho | 57 conflictos que impedían todo upgrade ahora se aceptan; el dominio queda intacto |
| `.sdlc/overrides.yaml` y reclasificación en `doctor` | hecho | 57 `managed-file-drift` pasan a `managed-file-override` |
| Hash normalizado en `collectDrift` | hecho | Elimina 21 `override-stale` falsos por CRLF en Windows |
| `--version` y exit code de comando desconocido | hecho | Un typo en CI ya no se contabiliza como éxito |
| `.sdlc/session.json` fuera del set gestionado | hecho | Deja de producir drift permanente |
| Migraciones que leen disco | hecho | `up(files, context)` con `readDisk`/`existsOnDisk`; contrato en `migrations/README.md` |
| `validate-local-gate.ps1` en modo `-Strict` | hecho | `-Strict` exige solo lo que el framework entrega; los `validate:*` del consumidor se reportan como no configurados |
| `runCommand` con `shell: true` | hecho | Los tokens con metacaracteres se **rechazan** en vez de escaparse; el shell sigue siendo obligatorio en Windows por la mitigación de CVE-2024-27980 |
| Detección de `@latest` en scripts de gate | hecho | `tools-doctor` reporta `pinned-tooling`; el pin en sí lo aplica el consumidor |

Con esto, 1.8.0 queda funcionalmente completo salvo el re-baseline del manifiesto en los otros dos consumidores, que exige acceso a esos repos.

### 1.9.0 — observación y árbitro

| Pieza | Estado | Verificación |
|---|---|---|
| `src/quality-gates.js` (función pura, no-vacuidad, escalera) | hecho | Tests unitarios: gate vacuo nunca es `pass`; el mismo fallo bloquea o avisa según el modo |
| `src/evidence-validator.js` | hecho | Primer consumidor real del schema; detecta evidencia redactada a mano |
| `src/evidence-writer.js` (append-only, hash de árbol) | hecho | E2E: la segunda medición conserva la primera en `history` |
| `sdlc quality-gate --run / --from-evidence` | hecho | E2E con probe y adapter reales; `--from-evidence` se marca `advisory` |
| `quality-contract.yaml` + schema | hecho | Instalado por manifiesto |
| `phase-gate` lee y valida la evidencia | hecho | YAML corrupto o inválido ahora bloquea; gate humano exige firma |
| `quality-verify.yml` (árbitro en CI) | hecho | Instalado con sus expresiones intactas |
| `validate-spec-boundary.mjs` | hecho | Exit 2 al tocar ruta protegida, incluyendo working tree |
| `commandStatus` con componente `quality` | hecho | Cuarto componente en el payload y en `status.md`, marcado `advisory` cuando se midió en local |
| `phase-contract` v2 con `quality_gates` por fase | hecho | F8, F9 y F10 declaran sus gates; guard de versión avisa sobre contratos v1 sin romperlos |
| Baseline y modo `ratchet` operativo | pendiente | El modo está implementado y probado; falta el baseline versionado, que es 1.11.0 |

**1.9.0 cerrado.** Un contrato v1 sigue funcionando y solo recibe el aviso `contract-version-outdated`; un consumidor sin `quality-contract.yaml` obtiene `quality: not-configured`, que no lo pone en no-go. Ninguna de las dos situaciones rompe a los consumidores instalados.

Dos defectos del framework aparecieron al construir esto, ambos preexistentes:

- El interpolador de plantillas destruía las expresiones `${{ ... }}` de GitHub Actions, así que **el framework no podía entregar ningún workflow** con sintaxis de Actions sin romperlo. Corregido en `interpolate` y en su validador.
- `schemas/phase-evidence.schema.json` declara draft 2020-12 y Ajv 8 solo compila hasta draft-07 por defecto: el primer intento de validar evidencia fallaba con `no schema with key or ref`. Es la prueba de que el schema nunca se había compilado desde que se instaló en 1.5.0.

### 1.11.0 — ratchet

| Pieza | Estado | Verificación |
|---|---|---|
| `src/quality-baseline.js` (baseline versionado, tamper-evidente) | hecho | E2E: promoción, verificación de integridad, manipulación detectada por `doctor` |
| `sdlc quality-baseline --promote` | hecho | Sin `--source ci` exige `--allow-local` explícito; sin ninguno se rechaza |
| `evaluateQualityGates` compara contra baseline real | hecho | Conectado en `quality-adjudicate.js` y `quality.js`; ambos caminos (`--run`, `--from-evidence`, `phase-gate`, `status`) usan el mismo baseline |
| `doctor` detecta `baseline-tampered` | hecho | Edición manual sin recalcular `integrity_sha256` produce `status: error` |
| Gates de F8 y F10 suben a `ratchet` en el contrato por defecto | hecho | `F8.changed-lines-coverage`, `F10.dependency-violations`, `F10.dependency-cycles` |
| `NOT_CONFIGURED` pasa de WARNING a BLOCKING en `VERDICT_STEPS` | pendiente | Es el cierre de la escalera completa; queda para cuando haya consumidores reales operando en modo `ratchet` con historial |
| Guard anti-regresión explícito en F14 | resuelto en P7 (post-1.11.0) | Ver nota abajo |

**Bug real encontrado al conectar el baseline, no cosmético.** `evaluateQualityGates` calculaba la dirección de "empeorar" en modo `ratchet` con `gate.op === "lte" ? actual > baseValue : actual < baseValue`, es decir, asumía que cualquier operador distinto de `lte` se comporta como `gte` (más alto es mejor). Para gates con `op: eq` sobre conteos donde **menos es mejor** —violaciones de dependencias, ciclos— eso invierte el ratchet: bajar de 5 a 2 violaciones se marcaba como regresión, y subir de 2 a 5 como mejora. Es exactamente el tipo de falso verde que todo este diseño existe para impedir en el consumidor, cometido esta vez en el engine. Corregido antes de activar `ratchet` en el contrato por defecto, con test que cubre ambas direcciones.

**Gap cerrado en P7 (post-1.11.0): guard anti-regresión en F14 por herencia de gates.** La síntesis original proponía que F14 (merge) re-verificara que las métricas del slice no empeoraran el baseline antes de fusionar. Quedó sin conectar en 1.11.0 porque el mecanismo de `quality_gates` por fase adjudicaba sobre la evidencia **de esa misma fase**, y F14 es la fase de merge — no produce mediciones propias. La decisión que faltaba (¿evidencia copiada hacia adelante o releída directamente?) se resolvió por la segunda opción: `adjudicateFromEvidence` (`src/quality-adjudicate.js`) detecta cuando un gate que la fase declara pertenece a OTRA fase de origen (`gate.phase != phase`, dato que el propio gate ya trae) y lo evalúa leyendo la evidencia de esa fase de origen directamente, nunca la de F14. Sin mecanismo de arrastre: la evidencia de F8/F9/F10 nunca se copia ni se reescribe, solo se relee. `phase-contract.yaml` declara en F14 `quality_gates: [F8.changed-lines-coverage, F10.dependency-violations, F10.dependency-cycles]` — los gates en modo `ratchet`, que son los que tienen baseline contra el cual regresionar. Una evidencia de F14 sin `quality_metrics` propio deja de leerse como sospechosa: `harness.js` distingue gates propios de heredados antes de exigir medición.

`quality-baseline.yaml` recibió el mismo tratamiento que `.sdlc/session.json` en 1.8.0: se sacó del manifiesto porque `promoteBaseline` lo reescribe en runtime, y un archivo gestionado que otra ruta legítima reescribe produce `managed-file-drift` permanente contra sí mismo. Antes de la primera promoción no existe físicamente; `loadBaseline()` devuelve un baseline vacío en memoria y todo gate `ratchet` se evalúa sin comparación.

## Primer paso

Un solo cambio, con test de regresión, sin tocar ningún archivo gestionado del consumidor: añadir en `commandVerdict` (`src/harness.js`) un precheck de existencia contra `packageJson.scripts` antes de invocar el package manager, y clasificar el paso ausente como `NOT_CONFIGURED` en vez de `pass`.

Verificación binaria e inmediata: `sdlc verdict --target <piloto> --json` debe dejar de reportar `adr-integrity` y `active-slices` como `pass`, revelando que el `READY` actual es falso.

<a id="addendum-firma-supersedida"></a>

## Addendum 2026-08-14 — la firma humana de este ADR está supersedida

<!-- El ancla de arriba es explicita y ASCII a proposito. El ancla que
     GitHub genera a partir de esta cabecera CONSERVA la tilde de «está»,
     y los cinco enlaces internos se escribieron sin ella: apuntaban a un
     fragmento inexistente. Un ancla propia no depende de como se
     translitere el titulo, ni se rompe si el titulo cambia. -->

Este addendum no reescribe nada de arriba: lo marca. El historial se conserva
porque explica por qué el mecanismo llegó a ser el que era.

**Qué queda supersedido, y por qué.** La decisión P5 describe la firma humana
como un review `APPROVED` verificado con `gh api` sobre el `head_sha`, y la
sección de reubicación ancla la obligación de F13 a `tier core`/`money_path`.
Ninguna de las dos cosas es hoy cierta:

1. **El mecanismo cambió al implementarlo.** Con un solo maintainer GitHub
   prohíbe auto-aprobar el PR propio, así que `platform-review` es
   insatisfacible y `src/signoff.js` verifica un **commit vacío firmado**
   (`git verify-commit`) cuyo sujeto se recomputa siempre. El razonamiento está
   en la cabecera de ese módulo y en `governance.threatModel:
   single-maintainer`. Este ADR nunca se actualizó, y la contradicción vivió
   abierta hasta hoy.

2. **El disparador cambia con el [ADR 0008](0008-modelo-de-riesgos-de-autorizacion.md).**
   Su D1 separa los dos ejes: `tier` queda **solo** para umbrales de calidad, y
   la obligación de firma se deriva de riesgos de autorización declarados por
   superficie (`money_path`, `regulated_data`, `security_critical`,
   `state_machine_critical`), fail-closed. La razón es medida y está en aquel
   ADR: con la regla de este, esquivar una firma bastaba con bajar el tier — y
   eso **también** compraba diez puntos menos de cobertura. La gobernanza
   incentivaba degradar la calidad.

   D5 añade que el downgrade lo adjudica **únicamente** `phase-gate`, y D7 que
   la política (`attestation` / `declarative` / `none`) vive en
   `quality-contract.yaml`, nunca en `.sdlc/config.json`.

**Por qué este addendum existe ahora y no antes.** Mientras el ADR 0008 era
trabajo posterior, la contradicción era deuda documental anotada en el roadmap.
Desde que **el ADR 0008 entra en 2.0.0**, deja de serlo: quien implemente D1-D7
tiene delante dos fuentes incompatibles sobre quién debe firmar, y la de arriba
es la que invita a reintroducir el disparador por `tier` que D1 existe para
eliminar.

**Dónde están las marcas, y por qué se enumeran.** La primera versión de este
addendum marcó dos párrafos y afirmó que eran «la única parte supersedida». Era
falso, y peor que falso: daba señal de que no quedaba otra fuente normativa
viva. Quedaban tres —la fila de F4 en la matriz, el roadmap de 1.10.0 y la
decisión pendiente sobre degradar F13— y las tres reintroducían justo lo que
este addendum retira. Marcadas todas, y aquí queda la lista para que se pueda
comprobar en vez de creer:

| Dónde | Qué decía | Qué lo sustituye |
|---|---|---|
| D2, párrafo de firma humana | review `APPROVED` por `gh api` | commit firmado (`src/signoff.js`) |
| Reubicación del gate humano | F13 bloqueante por `tier core`/`money_path` | ADR 0008 D1: riesgos declarados por superficie |
| Matriz F0-F17, fila F4 | `review_id`, `reviewer_login`, `head_sha` | atestación por commit firmado |
| Roadmap 1.10.0 | «firma la especificación vía review verificado» | vía commit firmado |
| Decisiones pendientes, punto 2 | «degradar F13 para tier standard y shell» | la pregunta desaparece al separar los ejes |

**Lo que este addendum NO toca.** Todo lo demás del ADR 0007 sigue vigente: la
escalera de gates, la no-vacuidad, la evidencia append-only, el ratchet y su
baseline. Lo supersedido es **qué obliga a firmar y cómo se verifica esa
firma** — nada de lo que el gauntlet *mide*.
