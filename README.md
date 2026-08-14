# SistemaMultiagente_SDLC

Framework SDLC asistido por IA con governance enterprise, SDD y enfoque brownfield-first.

> BMAD orquesta; SistemaMultiagente_SDLC orquesta y verifica.

## Por qué

Este proyecto instala un SDLC multi-agente gobernado en repos greenfield o legacy. Combina personas de agente reutilizables, flujos OpenSpec/SDD, phase gates, migraciones, validadores, rollback y memoria persistente opcional.

El modelo operativo es SDD waterfall por slice y ágil por release: cada slice tiene gates explícitos de requisitos, readiness, diseño, implementación, verificación y archivo, mientras los releases permanecen iterativos.

Desde `1.8.0`, esos gates dejan de ser declarativos y pasan a **medirse**: contrato de calidad con umbrales por superficie, cobertura de las líneas que cambiaron, frontera de especificación que el propio PR no puede desactivar, firma humana verificable por commit firmado y un árbitro en CI que vuelve a medir lo que el harness local calculó. Ver [Gauntlet de calidad verificable](#gauntlet-de-calidad-verificable-180).

## Inicio rápido

Flujo con paquete publicado (>=1.2.1):

```powershell
# Desde la raíz del repo destino (cwd = repo).
# --target es opcional desde v1.2.1: si se omite, se usa el directorio actual.
npx sistema-multiagente-sdlc init --mode greenfield --project-name "Mi Proyecto"

# Smoke previo sin escribir nada:
npx sistema-multiagente-sdlc init --mode greenfield --project-name "Mi Proyecto" --dry-run --json
```

Para v1.2.0 (compatibilidad), el comando equivalente requería `--target` explícito:

```powershell
npx sistema-multiagente-sdlc@1.2.0 init --target . --mode greenfield --project-name "Mi Proyecto"
```

Flujo de desarrollo local:

```powershell
git clone https://github.com/JuanCastrejon/SistemaMultiagente_SDLC.git
cd SistemaMultiagente_SDLC
corepack prepare pnpm@11.3.0 --activate
pnpm install --frozen-lockfile
pnpm run validate
pnpm test
node ./bin/sdlc.js install --target ../mi-proyecto --mode greenfield --project-name "Mi Proyecto"
```

Legacy/brownfield:

```powershell
node ./bin/sdlc.js install --target ../proyecto-legacy --mode legacy --project-name "Proyecto Legacy"
node ./bin/sdlc.js doctor --target ../proyecto-legacy --json
```

## Runtime Multiagente

Desde `1.4.0`, `sdlc` incluye comandos ejecutables para continuidad cross-IDE. El runtime primario es Node; los wrappers PowerShell solo existen para ergonomía Windows.

```powershell
sdlc session-start --target . --json
sdlc resume --target . --markdown
sdlc save --target . --event manual --json
sdlc continua --target . --platform codex --json
sdlc memory-sync --target . --mode health --json
sdlc validate-runtime --target . --json
sdlc hooks install --target . --post-merge-checkpoint --json
```

Reglas base:

- `session-start` crea `.sdlc/session.json` con healthcheck de Headroom, CodeGraph, Graphify, caveman, vault y slice actual.
- `resume` es solo lectura y recompone contexto en orden repo → CodeGraph → Graphify → vault.
- `save` escribe checkpoints locales en el vault; no promueve GitHub Issues, OpenSpec ni PRs sin gate humano.
- `hooks install --post-merge-checkpoint` instala un hook local `post-merge` que ejecuta `sdlc save --event post-merge`.
- `memory-sync --mode nightly --apply` importa chats y exporta Graphify al vault; no crea checkpoints automáticos.

## Harness Ejecutable F0-F17

Desde `1.5.0`, el flujo F0-F17 tiene contrato ejecutable y evidencia por fase.

```powershell
sdlc phase-gate --target . --phase F5 --slice <slice> --json
sdlc governance-check --target . --json
sdlc tools-doctor --target . --profile full --json
sdlc pr-body-check --repo . --pr <number> --json
```

Reglas base:

- `phase-contract.yaml` declara owner, participantes, entradas, salidas, gate humano y siguiente fase.
- `.github/agent-state/evidence/<slice>/<phase>.yaml` registra evidencia trazable cuando la fase lo exige.
- `governance-check` compara el bloque `SDLC_SHARED_RULES` entre IDEs y valida mirrors de skills.
- `tools-doctor --profile full` reporta el stack de harness completo: OpenSpec, Graphify, CodeGraph, Obsidian, Headroom, Caveman, autoskills, Vercel skills, party-mode y el package manager del repo consumidor.

### Package manager del consumidor

`verdict`, `tools-doctor` y `scripts/validate-local-gate.ps1` detectan el package manager del repo destino en este orden: campo `packageManager` de `package.json`, lockfile presente (`pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, `package-lock.json`) y `pnpm` como default histórico. Un consumidor con `npm workspaces` ya no falla con `pnpm: missing`; el tool se reporta como `package-manager` con el manager detectado y su origen.

## Governance Engineering — Enforcement Duro (1.7.0)

Desde `1.7.0`, el engine expone primitivas para convertir gobernanza advisory en enforcement duro (ADR-0006). Ver arquitectura completa en ADR-024/ADR-025 del repo consumidor.

### Veredicto ordenado + status go/no-go

```powershell
# Veredicto READY/NOT-READY (fail-fast sobre validators del consumidor)
sdlc verdict --target . --json
sdlc verdict --target . --write --slice <slice> --phase <F> --json

# Snapshot go/no-go (governance + tools + phase-gate)
sdlc status --target . --markdown --write
sdlc status --target . --exit-code   # CI hard-block si no-go
```

- `verdict`: corre los scripts `validate:*` del consumidor en orden fail-fast; clasifica cada uno como BLOCKING/WARNING; emite un único `{verdict: "READY"|"NOT-READY"}` con exit 0/2.
- `status`: agrega `governance-check` + `tools-doctor` + `phase-gate` en un snapshot Markdown. Con `--exit-code` devuelve exit no-cero cuando cualquier componente está en error/blocked.
- `phase-gate --exit-code`: hard-block cuando la fase del slice activo está "blocked" (sin el flag, modo informativo — exit 0).

### Skills vivas — eval + propuesta gated

```powershell
# Score del canónico contra golden tasks en .github/skills/<skill>/evals/*.yaml
sdlc skill-eval --target . --skill enrich-us --json

# Propuesta de edición (solo escribe bajo openspec/changes/<change>/)
sdlc skill-propose --target . --skill enrich-us --change <change> --intent "descripción"
```

- `skill-eval`: carga golden tasks YAML del consumidor; scoring determinístico (presencia de campos); emite score numérico por task y global.
- `skill-propose`: genera `proposed-skill-diff.md` + `skill-eval-report.yaml` solo bajo `openspec/changes/<change>/`; nunca muta `.github/skills/` directamente (el hook deny del consumidor lo bloquearía de todos modos).
- `schemas/skill-eval.schema.json`: schema JSON Schema draft-07 para sets de golden tasks.

### Flujo de gate humano completo

```text
sdlc verdict → READY/NOT-READY
sdlc status --markdown --write → status.md
Adjuntar status.md al bloque [validation] del Issue → gate humano F4/F13 firma contra el número
```

## Gauntlet de calidad verificable (1.8.0)

Desde `1.8.0`, el framework implementa el ADR 0007: en vez de revisar línea por línea el código que genera un agente, se le rodea de restricciones automáticas **verificables**. La tesis viene de Robert C. Martin, con una corrección importante: Martin no elimina la revisión humana, la **reubica** — se deja de revisar implementación y tests, y se sigue revisando y firmando la especificación *antes* de que se genere código.

Dos reglas gobiernan todo lo de abajo:

- **Ningún *umbral* nace en `block`.** Los umbrales entran en `observe`, pasan a `ratchet` contra una línea base y solo después bloquean. Dos excepciones deliberadas, porque no son umbrales sino ausencias: un gate que la fase **declara** y no se mide es violación en cualquier modo (prometer una medición y no hacerla no es un aviso), y el guard de frontera bloquea si no puede resolver la base contra la que comparar.
- **El evaluado no firma su propio veredicto.** El harness local calcula lo mismo que CI, pero se autodeclara `advisory`; el árbitro es el workflow, que vuelve a medir en una máquina que el agente no controla.

  Ese arbitraje **no es automático por instalar el workflow**: exige dos controles de plataforma que el framework no puede imponer — marcar el check como *required* en la rama protegida, y restringir vía CODEOWNERS quién edita `.github/workflows/`. Sin ambos, el árbitro es editable por el evaluado y no arbitra nada. El propio workflow lo documenta en su cabecera.

### Contrato de calidad

`quality-contract.yaml` declara tiers, superficies, probes, umbrales por tier y **denominador mínimo** de cada gate. El motor solo adjudica: no sabe que existe Vitest ni Stryker. Los adapters de formato viven en el consumidor.

```powershell
# Ejecuta los probes declarados, anexa la evidencia medida y adjudica
sdlc quality-gate --slice <id> --phase <F> --run --exit-code --json

# Solo adjudica lo ya escrito (se marca advisory)
sdlc quality-gate --slice <id> --phase <F> --from-evidence

# Mueve la línea base de los gates ratchet a evidencia YA escrita, nunca a un número a mano
sdlc quality-baseline --promote --slice <id> --source ci

# Cobertura de las LÍNEAS CAMBIADAS, no del repo entero (se encadena tras el test runner)
sdlc coverage-diff --base-ref origin/develop
```

El `min_denominator` es lo que separa un gate que juzga de uno vacuo: «0 violaciones permitidas» y «0 violaciones permitidas, y solo cuenta si se escanearon ≥10 módulos» son controles distintos.

### Frontera de especificación

`scripts/validate-spec-boundary.mjs` bloquea cuando el diff toca specs, contratos, workflows o configuración de herramientas sin excepción aprobada. Sin este candado, la ruta más barata para pasar cualquier gate es reescribir el criterio.

En CI se ejecuta la copia del guard que vive en la rama de integración —no la del checkout del PR— y su allowlist se lee de la base vía `git show`: una excepción creada en el mismo PR no autoriza nada hasta estar mergeada.

Una salvedad honesta: si la rama base todavía no tiene el script (bootstrap, primera adopción), el workflow avisa y cae a la copia del checkout. Mientras dure esa ventana el guard sí es editable por el PR, y se cierra sola en cuanto el guard existe en la base.

### Firma humana verificable y cierre

```powershell
# El sujeto (slice + fase + tree_hash de las superficies) se recomputa siempre, nunca se recibe declarado
sdlc signoff --slice <id> --phase <F> --create
sdlc signoff --slice <id> --phase <F> --verify --commit <sha>

# Cada escenario Gherkin trae un sc_id cuyo hash debe coincidir con (capability, requirement, título)
sdlc acceptance-verify --change <slug>

# Ninguna tarea sin marcar; una tarea de merge marcada exige que HEAD sea antepasado real
sdlc change-close --change <slug> --integration-branch develop
```

Con un solo maintainer, GitHub prohíbe auto-aprobar un PR propio: `platform-review` es insatisfacible, así que la firma se verifica por **commit firmado** en vez de por review de plataforma (`governance.threatModel: single-maintainer`).

> Desde 2.0.0 el sujeto se ancla al **commit firmado** y `--create --record` enlaza la firma con la evidencia de su fase. Ver [Firma humana: emitir, enlazar y auditar](#firma-humana-emitir-enlazar-y-auditar).

### Documentación generada, no escrita

```powershell
sdlc quality-docs --out docs/quality-gates.md   # regenera desde los contratos
sdlc quality-docs --check                       # CI: exit 2 si la doc comiteada divergió
```

Mentir en esa doc exigiría editar el propio contrato que los gates evalúan. `--check` no escribe: compara y falla, para que una doc desactualizada no pase inadvertida. Es **opt-in**: el workflow que entrega el framework no lo invoca, así que cablearlo a CI es decisión del consumidor (regla de adopción).

### Adopción de un consumidor maduro

`sdlc install` asume un scaffold completo. Un repo con historia propia no quiere que eso le reescriba nada encima:

```powershell
sdlc adopt --target .    # aditivo: no pisa archivos existentes
```

Agrega la devDependency versionada (**nunca `npm link`**), un `.sdlc/config.json` mínimo **sin inventar superficies**, y el contrato de fases con su schema — solo los que falten. Correrlo dos veces es seguro.

Con una excepción explícita, que es el punto de la pieza: si la dependencia ya está declarada como `file:` o `link:`, **sí** edita `package.json` para reemplazarla por una versión real. Un árbitro que apunta a un working tree local no arbitra nada, así que ese estado no se conserva. Cuando la rama de integración es ambigua (típico en gitflow: `origin/HEAD` apunta a `main` mientras se integra en `develop`), el payload lo dice en vez de elegir en silencio.

### Prueba de rojo — advisory, y lo declara

```powershell
sdlc red-proof-verify --slice <id> --report reports/red-proof.json --format vitest-json
```

Todo escenario en `status: red` exige que el reporte declare `outcome: assertion-failed`: un error colateral (import roto, `throw` arbitrario) no da crédito, porque demuestra que algo se rompió, no que el escenario esté bien especificado.

Es **opt-in y no autoritativo**, y el payload lo declara (`authoritative: false`, `proofStrength: "heuristic"`, `limitations`). No consume aún procedencia de CI, así que adjudica un reporte que produce el propio evaluado: `ok` significa «no se detectó trampa», nunca «el rojo quedó demostrado». Ningún workflow lo invoca por defecto.

## Qué cambia en 2.0.0

Tres rupturas, todas salidas de **operar** el framework en un consumidor real y no de leer el código. Están repetidas en `migrations/2.0.0/up.mjs`, que deja constancia escrita en `.sdlc/migrations/` del repo actualizado.

| Ruptura | Qué implica al actualizar |
| --- | --- |
| El sujeto de la firma cambia de formato | Las atestaciones anteriores **no verifican**. Hay que volver a firmar (`sdlc signoff … --create --record`). `doctor` y `upgrade` las nombran una por una. |
| `install` deja de escribir superficies y stack de ejemplo | Un repo recién instalado sale en **error** en `doctor` hasta declarar sus superficies reales. Es deliberado: ver abajo. |
| `.github/agents/surface-traceability.json` se genera desde `config.surfaces` | Cambia de forma (`tier` en lugar de `repoSurface`). Nada del framework lo lee; revísalo si lo consumes a mano. |

### El instalador ya no finge configuración

Hasta 1.8.2, `install` escribía superficies de ejemplo (`apps/api`, `apps/web`) y cinco `<BACKEND_STACK>`. En un repo con otro layout **eso no era un ejemplo: era configuración activa**, con dos consecuencias que tardaron semanas en verse en un consumidor real:

- todos los gates sobre esas superficies eran vacuos (`surface-path-unresolved`), y
- el sujeto de la firma humana se calculaba sobre el **árbol vacío**, así que una atestación resultaba criptográficamente válida y semánticamente hueca: atestaba la nada.

Ahora `install` escribe `surfaces: []` y `stack` en `null`, y el estado a medio configurar se ve desde el primer minuto. **El framework no sabe nada del repo donde cae**: instala las bases y quien instala remata la configuración. Esa es la diferencia entre un repo sin configurar y uno que *parece* configurado.

## Configuración después de instalar

Cinco cosas que el instalador **no puede adivinar** y sin las cuales el árbitro no mide nada. `sdlc doctor` las reclama todas.

### 1. Superficies reales

```jsonc
// .sdlc/config.json
"surfaces": [
  { "id": "extension", "path": ".", "owner": "web-agent", "tier": "core", "hasUi": true }
]
```

`id` es identidad persistente y `path` tiene que existir en disco. Ojo con esto: las superficies se declaran **dos veces** —aquí y en `quality-contract.yaml`— y el árbitro y la firma leen **solo el contrato**. Corregir una sola de las dos no arregla nada, y por eso `checkSurfaces` reporta `surface-declaration-divergent` cuando divergen.

### 2. Stack real, o `null`

`null` significa «este proyecto no tiene esa superficie» y es un valor legítimo. Lo que no se admite es un placeholder sin sustituir: `doctor` reporta `config-stack-placeholder` como error.

### 3. Qué se puede medir y qué no

Aquí es donde la mayoría de repos se atascan, y el framework tiene una respuesta explícita. Los umbrales por tier que trae el contrato de fábrica:

| Gate | Fase | Métrica | core | standard | shell | Modo inicial |
| --- | --- | --- | --- | --- | --- | --- |
| `F8.changed-lines-coverage` | F8 | cobertura de **líneas cambiadas** | **90 %** | **80 %** | **0 %** | `ratchet` |
| `F9.mutation-survivors` | F9 | mutantes supervivientes | 0 | 0 | 0 | `observe` |
| `F9.no-coverage-mutants` | F9 | mutantes sin cobertura | 0 | 0 | 0 | `observe` |
| `F10.dependency-violations` | F10 | violaciones de dependencias | 0 | 0 | 0 | `ratchet` |
| `F10.dependency-cycles` | F10 | ciclos de dependencias | 0 | 0 | 0 | `ratchet` |

La cobertura es de **líneas cambiadas**, no del repo entero: un repo con 12 % histórico no queda bloqueado, pero lo que toque hoy sí responde por sí mismo.

**El denominador mínimo es parte del umbral, no un detalle.** «0 violaciones» y «0 violaciones sobre ≥10 módulos escaneados» son controles distintos: el primero lo cumple un repo vacío. Los de fábrica:

| Gate | Denominador | Mínimo | Qué evita |
| --- | --- | --- | --- |
| `F8.changed-lines-coverage` | `coverage.changed_lines_total` | **1** | Que un PR sin líneas nuevas dé 100 % |
| `F9.mutation-survivors` | `mutation.total` | **1** | Que «0 supervivientes» sea «0 mutantes generados» |
| `F9.no-coverage-mutants` | `mutation.total` | **1** | Igual que el anterior |
| `F10.dependency-violations` | `dependencies.modules_scanned` | **10** | Que «0 violaciones» sea «0 módulos escaneados» |
| `F10.dependency-cycles` | `dependencies.modules_scanned` | **10** | Igual que el anterior |

Por debajo del mínimo el gate no pasa ni falla: se marca como no concluyente.

**La escalera de adopción (ADR 0007): ningún control nace en `block`.**

| Modo | Qué hace | Cuándo se usa |
| --- | --- | --- |
| `observe` | Mide y reporta. Nunca bloquea. | Entrada obligatoria de todo gate nuevo |
| `ratchet` | Bloquea solo si **empeora** respecto de la línea base | Cuando ya hay baseline promovido |
| `block` | Bloquea contra el umbral absoluto | Solo cuando el repo ya lo cumple de forma estable |

`enforcement: observe` en la cabecera del contrato es el interruptor global; un gate en `ratchet` con línea base vacía se comporta como `observe` puro. La línea base se mueve con `sdlc quality-baseline --promote`, que exige `--source ci` o un `--allow-local` explícito.

**Cada probe declara su propio presupuesto y su política de ausencia:**

| Probe | Métricas | Timeout | Si no emite reporte |
| --- | --- | --- | --- |
| `coverage` | `coverage.*` | 120 s | `warn` |
| `deps` | `dependencies.*` | 60 s | `warn` |
| `mutation` | `mutation.*` | 3600 s (1 h) | `skip` |

`when_absent: warn` avisa pero no bloquea; `skip` lo omite en silencio, que es lo correcto para mutación, cuyo coste no siempre se paga en cada corrida. `applies_when.min_subjects` evita lanzar el probe cuando no hay nada que mutar. Y `command` es el **nombre de un script de `package.json`**, no una línea de shell: el engine lo invoca con el package manager detectado y rechaza cualquier token con metacaracteres.

**Si tu repo no puede medir alguno de esos, declara el probe no disponible con motivo escrito:**

```yaml
# quality-contract.yaml
probes:
  - id: coverage
    command: validate:coverage
    unavailable:
      reason: sin runner de tests; montarlo es un slice propio, no un ajuste
      since: "2026-08-13"
```

Con eso, **todos** los gates que dependen de sus métricas salen `not-applicable` con ese motivo, en un bucket propio que no entra en el veredicto. La distinción es el punto entero: *no medido* e *incumplido* son cosas distintas, y un check rojo permanente que las confunde enseña a ignorar la señal. Tres contenciones para que no sea una puerta trasera:

- sin `reason` escrito **no hay exención** y el gate se sigue adjudicando;
- si la métrica aparece de todas formas, **manda el número medido** y se avisa de que la declaración sobra;
- los gates de otras familias siguen bloqueando: la exención no se propaga.

### 4. Preparación de firma

```powershell
sdlc tools-doctor --json   # el probe `commit-signing` dice qué falta
```

Comprueba `governance.maintainers`, `user.signingkey`, `gpg.format` y —con SSH— que `gpg.ssh.allowedSignersFile` exista. Antes, un consumidor descubría que no podía atestar nada **en el momento en que un gate humano se lo pedía**, con la fase ya bloqueada.

Dos detalles que cuestan una tarde si nadie los dice:

- **`%GS` no tiene el mismo formato en GPG y en SSH.** Con GPG es el UID completo (`Nombre <email>`); con `gpg.format=ssh` es el **principal** de `allowed_signers`, normalmente el email solo. Se aceptan las dos formas, y el error muestra el `%GS` realmente observado.
- **Autorizar por email no autoriza una clave.** Con SSH, `allowed_signers` ya ata identidad a clave; con GPG, `%GS` es el UID que la propia clave declara, así que cualquiera puede fabricar una con tu email. Declara `fingerprint` y manda sobre el nombre:

```jsonc
"governance": {
  "maintainers": [
    { "signer": "juan@example.com", "fingerprint": "SHA256:…", "role": "human-review" }
  ]
}
```

El resultado de la verificación trae `identityBinding: "fingerprint" | "principal"` para que se sepa cuál de las dos garantías hay delante.

### 5. Estado por slice

`phase-status.yaml` admite un mapa `slices:` además del puntero global. Con varios slices en vuelo, el puntero solo describe uno y el árbitro quedaba ciego a los demás:

```yaml
current_slice: "slice-en-curso"   # lo que lee el workflow
current_phase: "F8"

slices:                            # lo que `sdlc status` adjudica entero
  slice-en-curso:  { phase: "F8" }
  otro-slice:      { phase: "F4" }
```

Es aditivo: un `phase-status.yaml` sin el mapa se comporta exactamente como antes.

### 6. Límites del runtime (normalmente no hay que tocarlos)

El framework lanza procesos externos —`git` sobre todo— y captura su salida. Esos límites viven en `src/file-utils.js` y **no están en ningún archivo de configuración a propósito**: cambiarlos mal rompe la propiedad que sostiene toda la verificación. Se documentan porque un repo muy grande puede necesitar subirlos.

| Constante | Valor | Qué acota |
| --- | --- | --- |
| `CAPTURE_CEILING_BYTES` | 256 MiB | Techo de diseño: memoria retenida con el pool caliente al completo |
| `TREE_HASH_MAX_BUFFER` | **64 MiB** | Tope por llamada del hash de árbol. Es `CAPTURE_CEILING_BYTES / 4` |
| `AUDIT_CONCURRENCY` | 4 | Atestaciones verificadas a la vez (`src/harness.js`) |
| `maxBuffer` (por llamada) | 1 MiB por defecto | Salida capturada de un proceso. **Un solo presupuesto entre `stdout` y `stderr`**, igual que `spawnSync` |
| `killGraceMs` | 2 s (máx. 30 s) | Gracia entre el `SIGTERM` al grupo de procesos y el `SIGKILL` |

**La regla que explica los números:** el pico de memoria retenida es *(tope por llamada) × (capturas en vuelo)*. Con `AUDIT_CONCURRENCY = 4` y 64 MiB por llamada, eso da exactamente el techo de 256 MiB. Si cambias uno, cambia el otro.

> **`CAPTURE_CEILING_BYTES` es un techo de diseño, no un límite aplicado.** Nada lo hace cumplir en tiempo de ejecución: solo se cumple porque la auditoría es hoy el único consumidor concurrente y corre a cuatro. `spawnCapture` es una exportación pública sin tope de concurrencia propio, así que quien la llame en paralelo por su cuenta —o solape dos auditorías— puede pasarse. Medido en la revisión adversarial: **cinco capturas simultáneas de 63 MiB retuvieron 315 MiB con un pico de 497 MiB de RSS**. Si vas a usar `spawnCapture` directamente, el tope de concurrencia lo pones tú.

**Cuánto es 64 MiB en la práctica:** `git ls-tree -r -z` gasta ~94 bytes por entrada, así que da para ~715 000 archivos en un solo árbol. Esa media es de *este* repo; rutas más largas la suben y bajan el número de archivos que caben.

> **Límite conocido, sin escape hoy.** Si tu árbol pasa de 64 MiB, `signoff` y el phase-gate devuelven `tree-ref-unreadable` y **no hay forma de subir el tope**: `computeTreeHashAtRef` y `computeTreeHashAtRefAsync` fijan `TREE_HASH_MAX_BUFFER` y no aceptan opciones. Antes de 2.0.0 la vía síncrona admitía 256 MiB, así que **para árboles de entre 64 y 256 MiB esto es una regresión de capacidad**. Está anotada en `docs/roadmap/pendientes-2.0.0.md` y pendiente de decisión: exponer configuración coherente para las dos vías, o conservar explícitamente la capacidad síncrona.

Si algún día se expone ese ajuste, tendrá que ser **en las dos vías a la vez**. Que declaren el mismo número es lo único que garantiza que acepten y rechacen las mismas entradas; si divergen, la auditoría y el gate pueden juzgar distinto la misma firma, y ese desacuerdo no se ve.

**`killGraceMs` está acotado arriba por seguridad.** La escalada a `SIGKILL` identifica al grupo por *pgid*, y ese pgid solo sigue siendo el nuestro mientras la ventana sea corta: una gracia larga convierte un riesgo despreciable en uno real.

## Firma humana: emitir, enlazar y auditar

```powershell
# Firma y ENLAZA con la evidencia de la fase en un solo paso
sdlc signoff --slice <id> --phase <F> --create --record

# Enlazar un commit que ya existe y ya está firmado (si el enlace falló antes)
sdlc signoff --slice <id> --phase <F> --record --commit <sha>

# Verificar, exigiendo además que el árbol aprobado siga siendo el actual
sdlc signoff --slice <id> --phase <F> --verify --commit <sha> --require-fresh
```

Cuatro propiedades que conviene entender antes de usarlo:

- **El sujeto se ancla al commit firmado, no al working tree.** Antes caducaba con el commit siguiente, así que no servía como registro de que una fase se aprobó. Que el árbol se haya movido después es otra pregunta: se responde con `fresh: false` y `--require-fresh`.
- **`--record` verifica antes de escribir.** Si la firma no verifica, no escribe nada. `approved_by` se deriva del firmante que reporta git, nunca de una opción, y la referencia previa se conserva en `history`.
- **Firmar el vacío es error duro.** Si ninguna superficie resuelve a archivos, `signoff-empty-subject`.
- **No se firma con el árbol sucio.** El commit de atestación es vacío y firmaría el árbol de `HEAD`, no lo que tienes delante (`--allow-dirty` para saltarlo a sabiendas).

### Auditoría de atestaciones

`doctor` y `upgrade` re-verifican **todas** las atestaciones declaradas, no solo la de la fase en curso. Una firma que dejó de valer se descubría al llegar a su gate humano, con el trabajo ya hecho.

| Veredicto | Qué significa | Efecto |
| --- | --- | --- |
| `invalid` | la firma existe y no vale | error en `doctor`, `action-required` en `upgrade` |
| `unverifiable` | no hay con qué comprobarla (clon superficial, commit ausente) | aviso, pero **nunca** produce éxito |
| `valid` | verificada | — |

Un clon superficial no es culpa de nadie, así que su remedio no es «vuelve a firmar» sino traer la historia que falta — y el hallazgo lo dice. En cambio un repo sin maintainers **sí** es error: es configuración local que desactiva el verificador entero.

**Coste medido** (superficie de 200 archivos, firmas válidas, mediana de tres corridas):

| Atestaciones | En serie | Con pool de 4 |
| --- | --- | --- |
| 1 | 524 ms | 314 ms |
| 5 | 2 490 ms | 616 ms |
| 20 | 9 693 ms | 1 703 ms |
| marginal | ~485 ms | **~67 ms** |

El recorrido de la evidencia sin firmas cuesta ~30 ms: lo caro son los procesos de git, no leer YAML.

## Puente de Codex — preflight obligatorio

Si delegas trabajo a Codex (ver `AGENTS.md`), ejecuta esto antes:

```powershell
node scripts/codex-session-check.mjs           # cuenta, plan, vencimiento
node scripts/codex-session-check.mjs --probe   # además, una llamada real
```

Cubre tres modos de fallo que no se parecen entre sí y ninguno se ve hasta que algo se rompe a mitad de trabajo:

1. **Sesión de otra cuenta** — la terminal sigue con la anterior aunque creas que cambiaste.
2. **Credencial rechazada por el servidor** — está en disco y sin vencer, pero se inició sesión con otra cuenta desde otro sitio. `codex login status` responde «Logged in using ChatGPT» y sale `0` mientras la llamada real falla. Solo `--probe` lo detecta, y por eso es opt-in: gasta cuota.
3. **Proceso con la credencial vieja en memoria** — un `codex` arrancado antes del último login. Se detecta comparando su arranque con la fecha de `auth.json`, y **la reparación es cerrar y reabrir la app**, no matar procesos: matarlos deja al puente sin su sesión compartida y el siguiente trabajo se cuelga sin escribir log.

El preflight no imprime tokens ni el `account_id` completo, y el plan **avisa pero no bloquea**: ve el plan, no la cuota restante.

## Modos

| Modo | Cuándo usar | Qué agrega |
| --- | --- | --- |
| `greenfield` | repo nuevo o inicio limpio de producto | plantillas SDD greenfield y governance |
| `legacy` | repo existente, migración o modernización brownfield | plantillas de research obligatorio y gates de descubrimiento legacy |

## Agentes

| Plano | Personas |
| --- | --- |
| Control | `planificador-opus`, `orquestador-opus` |
| Producto/coordinación | `product-owner-agent`, `project-manager-agent` |
| Definición | `analista-requisitos`, `arquitecto-modular-clean`, `qa-test-architect-agent` |
| Especialista | `api-nestjs`, `web-admin`, `mobile-sync`, `ux-designer-agent`, `tech-writer-agent` |
| Gate | `qa-security-review` |

## Flujo de Fases

```mermaid
flowchart LR
  F0["F0 Bootstrap"] --> F1["F1 Requisitos"]
  F1 --> F2["F2 Revisión humana borrador"]
  F2 --> F3["F3 Issue local"]
  F3 --> F35["F3.5 Rama"]
  F35 --> F4["F4 Handoff readiness"]
  F4 --> F5["F5 Planificación SDD"]
  F5 --> F6["F6 Handoff planificador"]
  F6 --> F7["F7 Orquestación"]
  F7 --> F8["F8 Implementación"]
  F8 --> F9["F9 QA"]
  F9 --> F10["F10 Seguridad"]
  F10 --> F11["F11 Commit"]
  F11 --> F12["F12 PR"]
  F12 --> F13["F13 Gate humano"]
  F13 --> F14["F14 Merge"]
  F14 --> F15["F15 Verificación"]
  F15 --> F16["F16 Archivo"]
  F16 --> F17["F17 Docs + trazabilidad"]
```

## Validadores

`pnpm run validate` ejecuta los validadores del framework:

- schema de config
- sin rutas personales
- sin bytes de control crudos
- sanitización de plantillas
- sin contenido gestionado inline
- integridad del manifiesto
- sin scripts placeholder
- política de herramientas externas
- precedencia de governance
- consistencia del manifiesto de skills
- schema de persona de agente
- existencia de links en docs
- consistencia de OpenSpec
- existencia de referencias Mustache
- schema de modelos

## Herramientas Externas — inventario, diagnóstico e instalación

Las herramientas externas son opt-in, y ese era el problema: `tools-doctor` decía `tool-graphify: warning` con una ruta, y el usuario que instala no tenía forma de saber **cuál** de las opcionales le hacía falta ni **cómo** conseguirla sin ir a leer otro documento.

`external-tools.yaml` es ahora la fuente única: propósito, si es requerida, perfil operativo elegible, comando de instalación (cuando existe) y cuándo **no** usarla. `tools-doctor` y `tools-install` leen de ahí.

```powershell
sdlc tools-doctor --target . --json     # que falta, QUE ES y como conseguirlo
sdlc tools-install --target .           # plan: dry-run, no ejecuta nada
sdlc tools-install --target . --apply   # instala solo lo automatizable
sdlc tools-install --tool graphify --apply
```

El plan separa tres grupos, porque mezclarlos era lo que impedía saber qué falta de verdad:

| Grupo | Qué es |
| --- | --- |
| `installable` | hay comando declarado y la herramienta no está |
| `manualOnly` | **no** hay instalación automatizable; el paso lo hace una persona (con la instrucción concreta) |
| `satisfied` | ya está presente |

### Cómo está acotada la ejecución

Un inventario que declara comandos es una superficie de ejecución, así que:

- Los comandos son **listas de argumentos**, nunca cadenas de shell. No hay shell que interprete `;`, `|` o backticks: un token raro es un argumento literal, no un comando.
- El ejecutable debe estar en una **allowlist corta** (`npm`, `npx`, `pnpm`, `yarn`, `node`, `pip`, `pip3`, `pwsh`, `gh`, `corepack`). Una entrada con otro binario se rechaza **al cargar el inventario**, no al ejecutarlo. Si una herramienta necesita otra cosa, se declara como paso manual.
- **Dry-run por defecto**: instalar software de terceros no puede ser un efecto secundario de pedir un diagnóstico.
- Nada de esto corre durante `sdlc install`.

Cuando una herramienta no tiene instalador automatizable, el inventario lo dice y entrega la instrucción manual. Inventar un comando que no existe sería peor que no tener ninguno.

## Guía de instalación por herramienta

Las herramientas externas son opt-in. El framework funciona sin ellas; al activarlas reducen reconstrucción de contexto, mejoran trazabilidad y ahorran tokens de forma significativa. Esta sección está dirigida al **agente que trabaja en el repo consumidor** para que pueda guiar al desarrollador correctamente.

Ver detalles completos en `templates/docs/agents/external-tools-matrix.md`.

| Herramienta | Requerida | Propósito |
| --- | --- | --- |
| OpenSpec | sí | SDD: specs, changes y archivo |
| gh CLI | sí para GitHub | issues, PRs y releases |
| headroom | no | proxy de contexto + ahorro de tokens en llamadas Anthropic |
| Graphify | no | grafo semántico de docs para exploración cross-módulo |
| CodeGraph | no | grafo estructural AST para navegación de código |
| Obsidian | no | vault local para checkpoints y continuidad multi-sesión |
| caveman | no | compresión de tokens en comunicación operativa |
| autoskills | no | discovery de skills externas curadas |
| vercel-labs/agent-skills | no | skills UI/deploy opcionales |

### headroom (proxy de contexto)

headroom actúa como proxy entre el agente y la API de Anthropic. Comprime payloads, aplica presupuestos de contexto y reduce costos en sesiones largas.

**Instalación:**

```powershell
npm install -g headroom
# o con npx sin instalar globalmente
npx headroom proxy --no-telemetry
```

**Configuración en Claude Code** (`~/.claude/settings.json`):

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:8787"
  }
}
```

**Arranque del proxy** (script incluido en `templates/scripts/`):

```powershell
pwsh -NonInteractive -File scripts/headroom-start.ps1
```

**Autoarranque en Windows** (una sola vez por máquina — acción del usuario, no automatizable por el agente):

```powershell
pwsh -ExecutionPolicy Bypass -File scripts/register-headroom-task.ps1 -Json
pwsh -ExecutionPolicy Bypass -File scripts/register-headroom-task.ps1 -Apply
Get-ScheduledTask -TaskName "<ProjectSlug>-Headroom-Autostart"
```

Sin esta tarea registrada, Codex y VS Code/Copilot no arrancan headroom automáticamente; Claude Code sí (via hook SessionStart en `~/.claude/settings.json`).

**Regla crítica:** si el proxy falla tras los reintentos, **no limpiar `ANTHROPIC_BASE_URL`**. Eso causaría que el agente llame directamente a Anthropic sin que el usuario lo sepa. El script registra el fallo en `%APPDATA%\headroom\health-last-fail.txt` y termina con `exit 1` para que el error sea visible.

### Graphify (grafo semántico de documentación)

Graphify indexa `docs/`, `openspec/`, `.github/agents/`, `.github/skills/` y raíz como knowledge graph semántico. **No indexa código de producto** (`apps/`, `packages/`).

```powershell
pip install --user graphifyy
graphify update .                    # re-extracción AST local, sin costo LLM
graphify query "<tema>"              # búsqueda semántica
graphify path "<A>" "<B>"           # relaciones entre nodos
graphify explain "<nodo>"           # descripción expandida
```

Cuándo usar: onboarding al proyecto, análisis de arquitectura cross-módulo, research de prior art en paso 4.5 de `enrich-us`. **No usar en loops normales de implementación.**

### CodeGraph (grafo estructural de código)

CodeGraph construye un índice AST de todo el código de producto. Responde preguntas estructurales sub-milisegundo sin grep.

```powershell
codegraph init -i                    # construir índice
codegraph status                     # verificar salud
```

Cuándo usar: "¿dónde está definida X?", "¿qué llama a Y?", "¿qué rompería si cambio Z?", firma de un símbolo, navegación cross-module en `apps/` y `packages/`. **No usar para docs ni semántica.**

### Regla de ahorro de tokens: CodeGraph vs Graphify vs Grep

Esta regla es crítica. Violarla duplica contexto y eleva costos 3x–8x en sesiones largas.

| Pregunta | Herramienta correcta |
|---|---|
| Estructura de código (callers, callees, impacto, firma) | CodeGraph — siempre primero, sin fallback a grep |
| Semántica cross-doc (docs, ADRs, specs, guides, agents) | Graphify si el grafo existe, sino docs raw |
| Texto literal (strings de log, comentarios, contenido sin estructura) | Grep — solo si no aplican los anteriores |

**Nunca ejecutar CodeGraph y Graphify para la misma consulta.** Son capas distintas con distinto scope.

### caveman (compresión de tokens en conversación)

caveman comprime solo los tokens de **output** del agente, no el razonamiento ni los payloads MCP. Útil para coordinación operativa entre agentes.

```text
/caveman lite    → modo conversacional comprimido (sin artículos, fragmentos OK)
/caveman full    → máxima compresión (solo para coordinación interna)
```

Regla: caveman **solo en conversación operativa**. Off en documentación, commits, PRs y artefactos finales. Las decisiones durables van a OpenSpec, docs o `.github/agent-state/`.

**party-mode** solo en fases F2 (Análisis), F3 (Diseño) y F4 (Validación). El costo multiagente (3x–8x tokens) solo se justifica en decisiones de diseño con trade-offs reales.

### Skills multi-entorno (bootstrap)

Después de instalar el framework, sincronizar las skills a todos los agentes:

```powershell
pwsh -ExecutionPolicy Bypass -File scripts/bootstrap-agent-skills.ps1
```

Esto copia las skills gobernadas desde `.github/skills/` a `.claude/skills/`, `.agents/skills/` y `.windsurf/skills/`. Si el manifiesto tiene entradas `crossMirrorSkills`, también copia skills entre carpetas de agente (por ejemplo, caveman ecosystem a Claude Code).

Verificar con:

```powershell
pwsh -ExecutionPolicy Bypass -File scripts/bootstrap-agent-skills.ps1 -Json
sdlc tools-doctor --target . --profile full --json
```

## Comparativa BMAD

Comparativa lado a lado de los dos frameworks. La intención no es competir sino aclarar dónde se solapan y dónde cada uno se especializa. Datos de BMAD tomados de su README oficial v6 (`bmad-code-org/BMAD-METHOD`, npm `bmad-method`).

| Característica | BMAD-METHOD v6 | SistemaMultiagente_SDLC v1.8.0 |
| --- | --- | --- |
| Licencia | MIT | MIT |
| Runtime requisitos | Node ≥20.12, Python ≥3.10, `uv` | Node ≥22.13, PowerShell (pwsh/powershell), Git |
| Comando de instalación | `npx bmad-method install` (interactivo) o `--yes --modules --tools` (CI) | `npx sistema-multiagente-sdlc init` (cwd default desde v1.2.1) |
| Scope principal | Desarrollo ágil asistido por IA | SDLC asistido por IA con governance enterprise y SDD |
| Flujos de trabajo | 34+ flujos ágiles (BMM core) | SDD waterfall por slice + ágil por release (fases F0-F17) |
| Scale-adaptive | sí, automático (bug → enterprise) | scale hint activo desde v1.3.0 |
| Agentes/personas | 12+ personas (PM, Arquitecto, Dev, UX, …) | 8 personas activas + roadmap extensible |
| Modo party / colaboración | sí (múltiples personas en sesión) | roundtable opt-in planificado v1.3.0 |
| CLI de ayuda / coach de siguiente paso | skill `bmad-help` | `sdlc doctor` (verificaciones de estado); `sdlc next` planificado v1.3.0 |
| Módulos / ecosistema | BMM (core) + BMB (builder) + TEA (test architect) + BMGD (game dev) + CIS (creative) | basado en modos (`greenfield` / `legacy`) + packs extensibles planificados v2.0.0 |
| Arquitectura de skills | sí (V6 + Sub-Agent inclusion + Cross-Platform Agent Team) | mirroring de skills a `.claude/`, `.agents/`, `.windsurf/` (`bootstrap-agent-skills.ps1`) con soporte `crossMirrorSkills` |
| Constructor de agentes/flujos personalizados | BMad Builder v1 | personas `.agent.md` + validadores (`validate-agent-persona-schema`) |
| Automatización del loop de desarrollo | en roadmap V6 | `phase-graph.yaml` + rework label-driven + lock TTL |
| Brownfield-first | no | sí (modo legacy con research obligatorio antes de proposal) |
| Validadores de governance | no es core | 15 validadores (config, personal-paths, no-control-bytes, template-sanitization, manifest-integrity, governance-precedence, …) |
| Gates de calidad medidos | no es core | contrato declarativo con tiers, umbrales por superficie y denominador mínimo; árbitro en CI que vuelve a medir (ADR 0007) |
| Cobertura de lo que cambió | n/d | `sdlc coverage-diff` cruza el diff de git contra el detalle de statements, no el porcentaje global |
| Frontera de especificación | no es core | guard que bloquea editar specs/contratos sin excepción ya mergeada; en CI corre la copia de la rama base, no la del PR |
| OpenSpec / SDD | no es core | integrado (capacidades canónicas en `openspec/specs/`) |
| Readiness L1/L2/L3 + matriz NFR | no es core | integrado (spec `business-production-readiness`) |
| Sistema de migración + rollback | no es core | backup automático + `sdlc upgrade --to-version` + `sdlc rollback --to <id>` |
| Lock multi-agente | no es core | TTL `platform-context.json` lock |
| Sanitización de paths/plantillas | no es core | `validate:no-personal-paths` + `validate:template-sanitization` |
| Provenance (SLSA) | n/d explícito | sí, SLSA v1 + firmas vía OIDC GitHub (workflow `publish.yml`) |
| Comunidad | Discord abierto, YouTube, X | GitHub Issues + Discussions (Discord no necesario) |
| Marca registrada | BMad / BMAD-METHOD trademarks of BMad Code, LLC | sin restricción explícita más allá de MIT |

Lectura corta: BMAD lidera en amplitud ágil y comunidad (12+ personas, 34+ flujos, 5 módulos, Discord activo, Skills Architecture V6). SistemaMultiagente_SDLC lidera en governance + brownfield + SDD + validadores (15) + gates de calidad medidos con árbitro en CI + sistema de migración + readiness L1/L2/L3 + sanitización. Ambos pueden coexistir: BMAD orquesta; SistemaMultiagente_SDLC orquesta **y verifica**.

## Roadmap

v1.3.0:

- paridad bash para scripts críticos
- `sdlc next`
- scale adaptativo: bug, feature, epic, platform
- extensiones de calibración
- roundtable opt-in
- sitio de documentación
- matriz de instalación de regresión: agregar `macos-latest` (cobertura triple ubuntu + windows + macos)
- bump `actions/checkout@v5` + `actions/setup-node@v5` con `node-version: 24`; deadline GitHub: Node 20 deprecated jun 2026, removido sep 2026

v2.0.0:

- packs extensibles
- API de plugins
- registro marketplace
- internacionalización en inglés
- ayuda contextual interactiva

## Contribución

Leer `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` y `SECURITY.md`.

## Licencia

MIT.
