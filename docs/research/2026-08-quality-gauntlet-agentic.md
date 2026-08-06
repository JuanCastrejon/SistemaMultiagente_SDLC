# Investigación: el gauntlet de calidad de Robert C. Martin aplicado a F0-F17

- Fecha: 2026-08-05
- Alcance: framework `SistemaMultiagente_SDLC` 1.7.1 y su consumidor piloto `PasarelaDePago`
- Estado: investigación cerrada, decisión en ADR 0007
- Método: 16 agentes de investigación en cinco fases (research externo, medición de repos, diseño de propuestas independientes, refutación adversarial por tres lentes, síntesis y verificación de completitud)

## 1. La premisa, verificada en fuente primaria

La tesis del usuario proviene de un mensaje de Robert C. Martin en X (julio 2026):

> "My current strategy is to not read any of the code written by my agents. […] What I do instead is to surround the agents with extreme constraints. Unit tests, gherkin tests, QA procedures, quality metrics, mutation testing, test coverage […]"
> — [x.com/unclebobmartin/status/2080257779395154409](https://x.com/unclebobmartin/status/2080257779395154409)

**Advertencia metodológica.** No fue posible renderizar `x.com` (HTTP 402) ni su mirror. La primera mitad del texto aparece verbatim en el `<title>` indexado; el resto está corroborado por tres fuentes secundarias independientes que lo reproducen de forma idéntica. Confianza alta, no total.

Existen fuentes primarias más fuertes que el propio tuit, y son las que sostienen esta investigación:

| Fuente | Qué aporta |
|---|---|
| [empire-2025/AGENTS.md](https://raw.githubusercontent.com/unclebob/empire-2025/master/AGENTS.md) | La secuencia canónica por cambio, escrita por Martin para sus propios agentes |
| [swarm-forge, rama six-pack](https://github.com/unclebob/swarm-forge) | Los prompts de los seis roles: specifier, coder, cleaner, architect, hardender, QA |
| [Acceptance-Pipeline-Specification](https://github.com/unclebob/Acceptance-Pipeline-Specification) | El contrato del pipeline de aceptación y la mutación de Gherkin |
| [crap4java](https://github.com/unclebob/crap4java), crap4clj, crap4go | La métrica CRAP con fórmula, umbral y exit codes |
| mutate4java, clj-mutate, mutate4go | Mutación diferencial y el modo `--scan` |
| dry4java, dry4clj, dry4go, dependency-checker, arch-view | Duplicación y reglas de dependencia |
| [Clean AI: Agentic Discipline](https://cleancoders.com/series/clean-ai/agentic-discipline) (cleancoders / O'Reilly ISBN 9780135968819) | La serie donde explica el sistema completo; ep. 6 del 23-jun-2026 |

Es decir: la postura no es una declaración provocadora, está implementada y publicada.

## 2. Tres correcciones al encuadre popular

### 2.1 No elimina la revisión humana: la reubica

Lo que deja de revisarse es la implementación y los tests unitarios. Lo que Martin **sí** revisa y aprueba explícitamente, antes de que se genere una línea de código, es la especificación Gherkin y los procedimientos de QA. Su rol `specifier` lo dice literalmente:

> "Do not commit or notify coder until the user explicitly approves the handoff."
> — `swarmforge/roles/specifier.prompt`

Consecuencia para nosotros: esto **refuerza** la regla 4 del bloque `SDLC_SHARED_RULES` ("los gates humanos no se automatizan") en lugar de contradecirla. Lo que cambia es *dónde* pesa la firma, no si existe.

### 2.2 Su métrica de complejidad no es la ciclomática: es CRAP

```
CRAP = CC² × (1 − coverage)³ + CC        umbral 8.0, exit code 2 al excederlo
```

Es anti-gaming por construcción: castiga la complejidad **solo cuando no está cubierta**. Con `coverage = 1`, `CRAP = CC`. No se aprueba subiendo cobertura basura ni partiendo funciones sin tests.

Identidad que hay que documentar antes de adoptarla: **`CRAP ≤ 8` con cobertura total equivale a `CC ≤ 8` para siempre**. Aplicado como umbral absoluto es un límite de complejidad ciclomática disfrazado. `evaluateRetryEligibility` en `packages/payment-core/src/orchestration/retry-policy.ts` ya tiene CC ≈ 15.

### 2.3 Su proxy de tamaño de módulo no son líneas: son sitios de mutación

Medidos con el modo `--scan` del mutador, sin ejecutar tests. Y muta también el Gherkin (`--level soft`), no solo el código.

Precisión importante: `--level soft` **no significa "gate débil"**. Los tres niveles controlan la política de reuso del caché diferencial; `soft` ignora el `implementation_hash` y por eso es el nivel correcto *después* de un refactor que preserva comportamiento.

### 2.4 Sobre los umbrales

**Martin no publica ningún objetivo de cobertura ni de mutation score en ninguna fuente revisada.** Los únicos números suyos son `CRAP ≤ 8` (empire-2025, nivel proyecto) y `CRAP ≤ 6` (rol cleaner). Sus propias fuentes se contradicen entre sí (50 advisory vs 100 bloqueante; `--max-workers 3` vs 8).

Regla derivada: **todo porcentaje que fijemos es decisión nuestra y debe firmarse como tal.** Cada umbral declara su procedencia: `fuente-primaria-martin`, `default-de-herramienta` o `decisión-de-equipo`.

## 3. El orden de las restricciones

Martin especifica dos secuencias, y no son la misma.

**Por cambio** (`empire-2025/AGENTS.md`):

1. Escribir escenarios de aceptación y **confirmar que fallan**
2. Escribir tests unitarios que fallan y hacerlos pasar hasta que pasen los escenarios
3. Validación estructural de los tests
4. CRAP hasta ≤ 8, refactorizando
5. Mutación diferencial módulo por módulo: cubrir sitios no cubiertos y matar supervivientes antes de pasar al siguiente

**En el pipeline de seis roles** (`hardender.prompt`), la verificación final es fail-fast y más estricta: mutación de código → mutación Gherkin suave → CRAP → DRY, **arreglando lo que encuentra cada herramienta antes de correr la siguiente**. El `cleaner` corre CRAP primero (a ≤ 6) y después DRY.

## 4. Estado medido del framework

Hallazgo central: **la tubería de evidencia existe y está vacía.**

| Componente | Estado real verificado |
|---|---|
| `phase-gate` | Solo hace `pathExists` sobre el YAML de evidencia. Nunca lo abre |
| `schemas/phase-evidence.schema.json` | Se instala en el consumidor y **ningún código lo compila ni lo valida** |
| `validators_run[]` | No lo lee nadie |
| `human_gate: true` | No se enforcea en ninguna parte |
| `<phase>-verdict.yaml` de `verdict --write` | No es input de ninguna fase |
| Cobertura, mutación, complejidad, dependencias | Cero nociones en el engine (grep sin resultados funcionales) |

Y un defecto activo, no teórico:

> **Gate fantasma en `verdict`.** Con npm y pnpm, `run --if-present` sobre un script inexistente sale 0 y el paso se reporta `pass`. Hoy `PasarelaDePago` aprueba en verde `validate:adr-integrity` (BLOCKING) y `validate:active-slices`, **que no tiene definidos**. Su `READY` actual es parcialmente falso.

Los cinco planos de extensión, todos editables sin refactor: el contrato declarativo `phase-contract.yaml`; `evaluatePhaseReadiness` en `src/harness.js` (único origen de un blocker de fase); `VERDICT_STEPS` (único array que define qué corre y qué bloquea); el dispatch de `src/cli.js`; y los schemas de OpenSpec con su cadena `requires[]`.

## 5. Estado medido del consumidor piloto

| Dimensión | Medición |
|---|---|
| Tests | 7, en 2 archivos. Verdes en < 3 s |
| Fuentes sin test | 16 de 18 (12 en `payment-core` + 6 en `apps/web`, con 1 test cada uno) |
| Cobertura | Cero instrumentada. Ningún `@vitest/coverage-*` instalado |
| Config de Vitest | **No existe** ningún `vitest.config.*` en el repo |
| CI | No ejecuta tests. Corre 5 `validate:*` + typecheck + build |
| Gate local | No corre tests, ni typecheck, ni build, ni lint |
| `npm run lint` | **Roto**: `next lint` fue removido en Next.js 16 |
| `npm run test:e2e` | **Roto**: sin `playwright.config`, recoge un test unitario y falla |
| Escenarios Given/When/Then | 25 en OpenSpec, **3** con equivalente en tests |
| Sin cobertura | `provider-status-map.ts` (223 LOC), `capability-matrix.ts` (148), `retry-policy.ts` (101) — justo la lógica que describen los 22 escenarios huérfanos |
| `sdlc status` | `no-go` |
| `sdlc doctor` | 82 findings |
| Coste dominante medido | `verdict` = 9302 ms, de los cuales 9120 ms son `npx @fission-ai/openspec@latest` resolviendo contra la red en cada corrida |

## 6. Reusar, construir, descartar

**Reusar** (superan a los equivalentes de Martin en Java/Go/Clojure):

| Capacidad | Herramienta | Nota |
|---|---|---|
| Mutación de código | StrykerJS + `@stryker-mutator/vitest-runner` | Fijar `thresholds.break` explícitamente: el default `null` informa y **nunca bloquea** |
| Reglas de dependencia | dependency-cruiser | Parsear el JSON, no confiar en el exit code |
| Duplicación | jscpd | Advisory también en el flujo de Martin: `dry4*` no documenta exit codes |
| Cobertura (insumo de CRAP) | `@vitest/coverage-v8` con remapeo AST | Da el `fnMap` por función que CRAP necesita |
| QA de caja negra | Playwright | Ya es devDependency de `apps/web` |

**Construir en el framework:**

| Capacidad | Por qué | Esfuerzo |
|---|---|---|
| `sdlc crap` | No hay implementación JS con masa crítica: `crap-score` dormido desde 2023 con dependencias absurdas (`@nestjs/core`), `typhonjs-escomplex` muerto desde 2018 | ~150-250 LOC |
| `sdlc scan-sites` | Stryker no expone un conteo estático barato de sitios de mutación | Bajo |
| Acceptance Boundary Guard | No existe como herramienta; es lógica de repositorio | **< 1 día** |
| Clasificación testable vs environmentally-unsuitable | Convención + validador | 1-2 días |

**Descartar:** `arch-view` (dependency-cruiser + Graphify + CodeGraph ya lo cubren), similitud AST con Jaccard de `dry4*`, adoptar los seis prompts de rol como agentes literales, y **construir la mutación de Gherkin en 1.x**.

### El hallazgo negativo decisivo

**No existe ninguna herramienta de mutación de Gherkin en el ecosistema JS/TS.** Ni paquete npm, ni plugin de Cucumber, ni extensión de Stryker. Construirla implica parser + IR + generador de entrypoints + manifiesto: es un proyecto propio, no una línea de roadmap. Se declara **gap permanente** y se sustituye por dos controles más baratos: la prueba de rojo verificada en CI y los canary mutants deterministas.

### Gherkin: especificación firmada, no capa de ejecución

Decisión contraintuitiva pero sostenida por la medición: **no se adopta Cucumber**. El valor está en la especificación aprobada por un humano antes de generar código, no en ejecutarla con un segundo runner (~30 dependencias, ~10 s de arranque). Gherkin queda como prosa aprobada en `openspec/changes/<slice>/acceptance/*.feature.md`, con IDs `SC-###` enlazados al **nombre del test de Vitest**.

Esto además esquiva la objeción documentada de que Gherkin para E2E resultó comercialmente costoso: la objeción aplica a Gherkin como capa de ejecución, no como contrato firmado.

## 7. Las tres correcciones que hacen la diferencia entre gauntlet y teatro

La refutación adversarial produjo cuatro objeciones bloqueantes. Las tres primeras cambian la arquitectura:

**1. El árbitro no puede ser el evaluado.** Ambas propuestas de diseño validaban la *forma* de la evidencia (Ajv) pero no su *verdad*. Un agente termina F9 con tres tests rojos, escribe a mano el YAML de evidencia con `status: ok` y el gate pasa. Por tanto: la evidencia **la anexa el harness tras ejecutar**, nunca el agente; y el veredicto autoritativo se recomputa en CI, donde `evidence-mismatch` entre lo declarado y lo recomputado es el detector de fraude.

**2. La firma humana no puede ser un string.** `approved_by: 'juan.castrejon'` en un YAML lo escribe el agente en diez segundos. La firma se **deriva** de un review `APPROVED` de GitHub sobre el `head_sha` exacto, con allowlist de logins y `dismiss-stale-reviews`.

**3. Todo umbral con forma `== 0` es satisfacible con denominador vacío.** `survived == 0` sobre cero mutantes, `failed == 0` sobre cero tests E2E, `violations == 0` sobre una superficie cuyo path no existe: los tres son PASS hoy. Cada gate declara **denominador mínimo** y el engine emite `gate-vacuous` cuando no se alcanza.

Y la cuarta, que es de entregabilidad pura: **ninguna propuesta puede llegar hoy a los consumidores**. `sdlc upgrade` aborta entero ante cualquier archivo gestionado modificado localmente (61 en PasarelaDePago) y las migraciones solo ven archivos recién renderizados, no el disco. Sin resolver eso, el resto no existe.

## 8. Superficie de gaming que hay que proteger

Además del código: `vitest.config`, `stryker.conf`, `.dependency-cruiser`, `eslint.config`, la sección `scripts` de `package.json`, `turbo.json`, los workflows de CI, los globs `include`/`exclude` y los comentarios de supresión (`v8 ignore`, `Stryker disable`, `eslint-disable`, `@ts-expect-error`, `test.skip`). Son gobernanza, no código.

Vectores concretos identificados y su contramedida:

| Vector | Contramedida |
|---|---|
| Bajar `timeoutMS` de Stryker: los mutantes `Timeout` cuentan como detectados | Desglosar killed/timeout/no_coverage/ignored y exigir `timeouts/(killed+timeouts) ≤ 0.05` |
| Escribir el Gherkin después del código, calzado a lo implementado | El commit que añade la especificación debe ser ancestro estricto del primero que toca implementación, verificado sobre refs remotas |
| `it('SC-001', () => { throw new Error('not implemented') })` como prueba de rojo | Registrar sha256 del test en el instante rojo y exigir que en F9 sea idéntico o solo-aditivo |
| Tier shopping: implementar la regla de dinero en `apps/web` para caer en un tier laxo | Detector de fuga de dominio: prohibir aritmética monetaria fuera de las superficies core |
| Tests tautológicos que suben cobertura | `@vitest/eslint-plugin` con `expect-expect`, `no-skipped-tests` y `no-focused-tests` en error — coste cero en CI |

## 9. Lo que la investigación no pudo verificar

- El tuit nuclear no fue renderizable; la segunda mitad depende de tres fuentes secundarias coincidentes.
- El coste real de mutación sobre este dominio no se midió: se estimó. `provider-status-map.ts` y `capability-matrix.ts` son tablas de datos declarativas (~150 y ~120 sitios) donde la mutación es cara y probablemente vacua.
- La portabilidad a Python (DemoMeridian) se diseñó pero no se construyó ni se probó.
- `ArchUnitTS` se listó por su README; no se instaló ni se ejecutó.

## 10. Riesgos que el plan no resuelve

1. **El gate humano de F4 es el único punto de fallo real.** Si el Gherkin aprobado modela mal una regla de negocio de pagos, todo el gauntlet pasará en verde sobre comportamiento equivocado. Ninguna cantidad de mutación lo detecta.
2. **Cupo de escenarios que un humano se compromete a leer.** Si nadie lo fija, el agente firmará 40 escenarios que nadie leyó y la reubicación de la revisión será nominal.
3. **Erosión del conocimiento del equipo.** Si nadie lee `payment-core`, la capacidad de diagnosticar incidentes en producción bajo presión se degrada. Martin no aborda esto en ninguna fuente revisada.
4. **Mutantes equivalentes reales.** `survived == 0` es inalcanzable con clamps ya acotados y ajustes de timeout, y este dominio es literalmente política de retry y backoff.
5. **Validación en contexto ajeno.** Martin valida su postura en proyectos personales, sin cumplimiento regulatorio, sin datos de terceros y sin clientes. Él mismo admite que habrá que esperar un par de años para evaluar satisfacción de cliente. Esto es una plataforma de pagos.

## 11. Referencias

- Fuentes primarias de Martin: las siete filas de la tabla de la sección 1.
- Herramientas verificadas contra el registro de npm y ejecutadas donde fue posible: StrykerJS 9.6.1, `@vitest/coverage-v8` 4.1.10, dependency-cruiser 18.1.1, jscpd 5.0.14, `@cucumber/gherkin` 42, quickpickle 1.11.2, playwright-bdd 9.2.0.
- Descartadas por estar muertas o marginales: `typhonjs-escomplex` (2018), `jest-cucumber` (2024), `stryker-diff-runner` (2022), `jest-coverage-ratchet` (2017), `crap-score` (2023).
- Decisión derivada: `docs/adr/0007-quality-gauntlet-f0-f17.md`.
