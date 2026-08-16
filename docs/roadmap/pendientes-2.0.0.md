# Pendientes tras 2.0.0

Estado a 2026-08-14, rama `fix/hallazgos-consumidor-mvp` (44 commits sobre `develop`), tras seis rondas de revision adversarial (5 a 10).
`npm test` y `npm run validate` en verde, en Windows y en POSIX. **Empujada y con PR abierto contra `develop`; sin merge y sin publicar.**

Cada punto trae por dónde empezar. Lo que espera una decisión del mantenedor va
primero, porque bloquea al resto.

---

## Ronda 11 — ¿queda deuda para una 2.0.1? Ya no

Registro en `.codex-out/ronda-11/hallazgos.md`. La ronda murió por cuota tras
entregar **6 hallazgos, todos ejecutados**; el contrato incremental los salvó.

- [x] ~~SERIO — la matriz de regresión quedaba ROJA tras el `install` de
      2.0.0.~~ Reproducido: `init` sale 0 pero `doctor` sale **1** con
      `config-surfaces-empty`, porque desde 2.0.0 el instalador ya no escribe
      superficies de ejemplo. **El propio control de release del repo estaba
      roto por el cambio.** El workflow ahora (a) **afirma** ese error antes de
      configurar —si algún día `doctor` dejara de exigirlo, la regresión se
      entera— y (b) declara una superficie real, que es lo que hace un
      consumidor. Verificado en WSL de punta a punta.
- [x] ~~Los cinco MENORES «cerrados» seguían teniendo variantes vivas.~~ Codex
      confirmó que mis cinco mutantes mueren, y encontró **cinco variantes
      nuevas que pasaban**. Todas cerradas, y todas verificadas volviendo a
      aplicar **su** mutación exacta: **5 muertos, 0 sobreviven**.
      - **NFD parcial:** normalizar solo `e`+U+0301 no tocaba el vector de la
        eñe. Ahora hay cuatro vectores NFD independientes y se comprueba cada
        uno por separado — una normalización parcial sobrevive a una comparación
        global si el resto coincide.
      - **`runPool` degradado a 2:** el caso del default solo exigía
        `1 < máximo <= 4`. Ahora afirma `=== AUDIT_CONCURRENCY`.
      - **Detalle del `ls-tree` = solo el ref:** satisfacía un `includes(...)`
        sin explicar nada. Ahora se exige **igualdad exacta** con la vía
        síncrona.
      - **`trip` retrasado un 40 % de la gracia:** una cota relativa sola dejaba
        pasar 800 ms de bloqueo del pool. Ahora hay **cota absoluta** además.
      - **Sin comparador de orden:** el caso verificaba una salida *accidental*
        de `readdirSync`. El comparador se extrajo a `compareByUtf8Bytes`,
        exportado, y se prueba contra una entrada deliberadamente desordenada.

## Ronda 10 — un BLOQUEANTE más, cerrado

Registro en `.codex-out/ronda-10/hallazgos.md`.

- [x] ~~BLOQUEANTE — un fallo SÍNCRONO de `spawn` fugaba el presupuesto.~~
      `spawn()` tira síncronamente con argumentos inválidos, antes de que exista
      el hijo y antes de registrar la liberación. Reproducido:
      `spawnCapture("", [])` con el tope entero dejaba **268 435 456 bytes
      reservados para siempre** y colgaba toda captura posterior. **Tercera
      aparición de la misma familia de defecto** (ronda 6: registro de hijos;
      ronda 9: cupo al resolver un corte).
- [x] ~~SERIO — el override no estaba cubierto en import fresco.~~ Mutar
      `Number.isSafeInteger` a `isFinite` reabría `0.5` y la suite quedaba
      **17/17 verde**: el módulo se importa una sola vez, antes de poder variar
      el entorno. El caso 22 arranca subprocesos.
- [x] ~~MENOR — el CLI perdía su contrato de error.~~ La validación corre al
      evaluar imports, antes de que exista `main()`: con `--json` el stdout
      salía **vacío**. `bin/sdlc.js` importa dinámicamente dentro de un `try`.

Codex confirmó que **sí se sostienen** (sus mutaciones fallaron como debían): la
liberación en `trip`, la cola FIFO, los casos 19 y 20, y el vigilante global.

## Ronda 9 — dos BLOQUEANTES en los arreglos de la ronda 8, cerrados

Registro completo en `.codex-out/ronda-9/hallazgos.md`. La ronda se lanzó, murió
por cuota a mitad y se **reanudó con otra cuenta** sin perder nada: el contrato
incremental salvó 5 hallazgos antes de morir.

- [x] ~~BLOQUEANTE — el escape documentado volvía falso el techo.~~ Con
      `SDLC_TREE_HASH_MAX_BUFFER_BYTES=134217728` (**el ejemplo del propio
      README**), cuatro cupos daban 512 MiB: el doble del techo que ese mismo
      commit afirmaba imponer. Contar capturas no bastaba porque el tope por
      captura es configurable. Ahora la admisión reserva **bytes declarados** y
      `MAX_CONCURRENT_CAPTURES` se **deriva** del techo. Verificado: con 128 MiB
      los cupos bajan solos a 2 → 256 MiB exactos.
- [x] ~~BLOQUEANTE — el cupo se devolvía al resolver, no al morir la captura.~~
      `trip()` resuelve de inmediato y deja al hijo vivo reteniendo buffers;
      liberar ahí admitía una segunda tanda encima de la primera (medido: ocho
      buffers a la vez). Ahora el cupo se suelta **cuando los buffers se sueltan
      de verdad** — en un corte, los buffers se descartan en el acto porque no se
      devuelven. **Es el mismo error que la ronda 6 ya había arreglado para el
      registro de hijos, repetido con el presupuesto.**
- [x] ~~SERIO — `0.5` en la variable publicaba un tope de cero bytes.~~ La guarda
      validaba `0.5 > 0` y luego `Math.floor` lo dejaba en 0. Ahora exige entero
      positivo que no supere el techo.
- [x] ~~SERIO — el caso 19 no probaba el cupo exacto ni detectaba una liberación
      que pierde la cuenta.~~ Aserciones **exactas** (`=== extra`,
      `=== techo`, `=== 0` al drenar) y **segunda tanda**. Los dos mutantes que
      Codex dejó vivos ahora mueren.
- [x] ~~Un cuelgue de la suite era un build VERDE.~~ Descubierto mutando la
      liberación: la suite se colgaba en el caso 7 y Node salía con **código 0**
      con solo un warning (`Detected unsettled top-level await`). Ahora hay un
      vigilante global que sale con **código 1** y mensaje. Esto valía más que el
      mutante que lo destapó.
- [x] ~~SERIO — el pgid sin identidad segura.~~ **Cerrado para el caso que
      importa.** Ya no se dispara contra un número: `killTreeForce` compara el
      `starttime` del líder (campo 22 de `/proc/<pid>/stat`) con el anotado al
      arrancarlo. Un pid reciclado trae otro `starttime`, así que **se detecta y
      no se manda nada**. Verificado en WSL: dos encarnaciones distintas dan
      `starttime` distinto, un pid inexistente devuelve `null` sin lanzar, y un
      nombre con paréntesis y espacios no rompe el parseo (se corta desde el
      último `)`, que es el error clásico al leer ese archivo).
      **Ventana residual declarada, no oculta:** si el líder ya fue recogido no
      hay `/proc` que leer, y ahí solo queda el sondeo con la señal 0 — que
      confirma que el grupo existe, no que sea nuestro. Cerrar *eso* pide
      contención del SO (cgroup, Job Object), que es un slice propio. En
      Windows no aplica: no hay `/proc` ni grupos POSIX.

## Ronda 8 — los tres SERIOS, atacados

Registro completo de la ronda en `.codex-out/ronda-8/hallazgos.md`.

- [x] ~~SERIO — `CAPTURE_CEILING_BYTES` no era un techo aplicado.~~ Cerrado:
      `spawnCapture` ahora admite como máximo `MAX_CONCURRENT_CAPTURES` (4)
      capturas a la vez, en cola FIFO que solo cuenta llamadas — nunca bytes ni
      contenido, para no repetir el bug de las rondas 5/6. Verificado con la
      **misma carga que midió Codex** (cinco capturas de 63 MiB): la 5ª queda
      en cola, profundidad máxima observada 1. Mutación: quitar el semáforo
      hace fallar el caso 19 (`captureQueueDepth()` se queda en 0).
- [x] ~~SERIO — la regresión 256→64 MiB no tenía escape.~~ Cerrado con
      `SDLC_TREE_HASH_MAX_BUFFER_BYTES`: se lee **una sola vez**, así que las
      dos vías comparten automáticamente el mismo valor y no pueden divergir
      (a propósito no es un parámetro por función — eso dejaría abierto que
      alguien subiera solo una vía). Un flag de CLI o campo de
      `.sdlc/config.json` sigue pendiente como decisión de producto aparte;
      esta variable ya es usable hoy. El README ya no promete un parámetro
      `maxBuffer` que no existía.
- [x] ~~SERIO — 30 s de gracia no hacían despreciable el pgid reciclado.~~
      Bajado a `MAX_KILL_GRACE_MS = 5_000`. El riesgo no se elimina —cerrarlo
      de verdad pide cgroup o job object, no un pgid— pero la ventana es ahora
      seis veces más corta, y el test que afirma el tope lo hace **literal**
      (`assert.equal(MAX_KILL_GRACE_MS, 5_000, …)`), no `+1` sobre lo que sea
      que declare el código — ese era el mutante que sobrevivía.

También cerrado de los mutantes supervivientes: el de `+1 KiB` al límite
combinado (caso nuevo 5c, corte exacto sin margen — mutación verificada) y el
de `MAX_KILL_GRACE_MS` (arriba).

**Los cinco MENORES: cerrados.** Se atacaron todos antes de publicar 2.0.0, para
no arrastrar deuda a una 2.0.1. Cada uno se verificó **volviendo a aplicar el
mutante que Codex dejó vivo**: los cinco mueren ahora.

- [x] ~~`.normalize("NFC")` en `decodeCapture`.~~ Caso nuevo con una cadena en
      **NFD** real: se comprueba que async y sync entregan los mismos bytes y
      que el texto llega **literal**. Normalizar aquí cambiaría el sujeto de una
      firma.
- [x] ~~`runPool` ignoraba la concurrencia pedida.~~ Se ejercita con **dos
      valores distintos del default** (1 y 2) y se afirma el máximo simultáneo
      exacto. Probar solo el default no probaba nada del parámetro.
- [x] ~~Orden por bytes indistinguible de UTF-16.~~ `Z`, `a` y `ñ` ordenan
      **igual** por ambos criterios. Se añadieron `！` (U+FF01) y `😀`
      (U+1F600), que ordenan **al revés** — en UTF-16 el emoji usa surrogates
      menores que FF01. El caso afirma además que el conjunto discrimina.
- [x] ~~Detalle de error del `ls-tree` async.~~ Ahora se compara también el
      diagnóstico, no solo `ok` y `code`. Es lo único que le dice a quien opera
      *por qué* no se pudo leer la referencia.
- [x] ~~`trip` con resolución retrasada.~~ El umbral se mide **contra la
      gracia** (debe resolver en menos de la mitad), no contra un 10 s flojo que
      dejaba pasar un retraso de 1 s.

## Ronda 18 — la tercera instancia, cerrada (2026-08-15)

Sobre `a602f5c`, que nadie había revisado. Tres lentes despachadas (rastreador,
mutador, refutador) más síntesis en sesión principal; ninguna se cayó. Codex
sin cuota hasta el 12–13 de septiembre: la segunda voz fue local, declarado.
Registro completo en `.codex-out/ronda-18/hallazgos.md`.

- [x] ~~SERIO — «la adjudicación corre SIEMPRE» era falso: la tercera instancia
      del patrón.~~ Al izarla fuera de `if (phase.human_gate)`, la llamada quedó
      dentro de `if (evidence.exists)` y del `else` de `if (!read.ok)`
      (harness.js). En una fase sin `evidence_required`, borrar o corromper la
      evidencia dejaba el gate **en verde sin una sola comprobación de
      autorización**. La adjudicación corre ahora antes de mirar la evidencia.
- [x] ~~SERIO — el detector de puerta quitada tenía su propia puerta.~~
      `fasesBase.presente && fasesBase.ok` tragaba el YAML roto de BASE: puerta
      quitada + contrato de fases ilegible en BASE devolvía `ok:true`
      (reproducido). Ahora bloquea con `authz-base-contract-invalid`, como la
      mitad quality-contract ya hacía.
- [x] ~~SERIO — la regresión central de la 17 sobrevivía la suite COMPLETA
      (M1, tres corridas).~~ El cableado del harness no lo ejercitaba ningún
      test. Caso nuevo: fase sin puerta y sin evidencia, puerta quitada en
      BASE → `blocked`. M1', M3', M6', H2' y H5' mueren, cada uno por su caso.
- [x] ~~MEDIO — borrar la fase con puerta del contrato HEAD.~~ Nadie re-gatea
      una fase borrada; solo se miraba la fase actual. `adjudicarAutorizacion`
      recibe ahora `fasesHead` y enumera todas las fases con puerta de BASE.
- [x] ~~MEDIO — debilitar el override de OTRA fase pasaba limpio (M3).~~
      `compararPolitica` solo comparaba `[null, faseActual]`; ahora compara
      todos los ids con override en cualquiera de los dos contratos.
- [x] ~~MENOR — la severidad de `base-unresolvable` (bloqueo con puerta, aviso
      sin puerta) no tenía test (M6).~~ Caso 13.
- [x] ~~MENOR abierto — `exige` divergente para F2/F3 con puerta~~ Cerrado en
      la ronda 19 (caso 15).
- [x] ~~MENOR abierto — la mitad de auditoría** (`auditarAutorizacion`, doctor,
      upgrade) se salta en silencio con contratos ilegibles.~~ Cerrado en la
      ronda 19 (caso 17 y los `else` de doctor/upgrade).

Deuda declarada nueva, dicha de frente: la primera ejecución real del workflow
en Actions (tras empujar `0382d05`) dejó `validate` **en verde en un runner
Linux** y `frontera de especificacion` roja con **exactamente las 3 violaciones
diseñadas** — la incógnita de `fetch-depth: 0` y `refs/remotes/origin/<base>`
quedó contestada: el ref base resuelve en el runner. Y para POSIX hubo que
instalar PowerShell nativo en el home de WSL (tarball 7.6.3, sin sudo): libuv
no resuelve `pwsh.exe` por interop, y `run-regression` necesita un pwsh de
verdad. `checkPowerShell` ahora también prueba `pwsh.exe` en Linux.

## Ronda 19 — la otra mitad del guard, auditada (2026-08-16)

Cerró la deuda declarada más vieja: la mitad de la ATESTACIÓN (recomputación
del sujeto, verificación de firma, deriva de política) que nadie había
auditado. Registro en `.codex-out/ronda-19/hallazgos.md`. El rastreador cayó
por límite de concurrencia (declarado); mutador y refutador corrieron, y el
barrido lo hizo la sesión principal.

- [x] ~~SERIO — la comprobación del signoff vivía tras la evidencia.~~ Quinta
      instancia del patrón: una fase CON puerta y SIN `evidence_required`
      pasaba el gate **sin firma** con solo no escribir (o borrar/corromper)
      el archivo de evidencia. Reproducido antes de arreglar. Ahora la puerta
      bloquea sin evidencia legible, exista o no el archivo.
- [x] ~~MEDIO — `auditAttestations` saltaba la evidencia ilegible en
      silencio.~~ Corromper el YAML era la forma barata de esconder una
      atestación podrida de `doctor`/`upgrade`. Ahora es hallazgo de error.
- [x] ~~MENOR (r18) — `exige` divergente para F2/F3~~ y ~~la mitad de
      auditoría que se saltaba en silencio con contratos ilegibles~~. Cerrados.
- [x] ~~`authz-base-unreachable` sin caso~~ (DAG desconectado con
      `commit-tree`, caso 16) — y de propina, el bloqueo por
      quality-contract inválido en BASE tampoco tenía test (caso 20).
- [x] ~~M2/M5/M6/M7 sobrevivían la suite completa; v1 sin test.~~ La garantía
      de la huella, el canon del sujeto, la recomputación en el ref atestado
      y la deriva de política ahora tienen su test y su mutante muerto.
- **La mitad de la atestación sostuvo los seis ataques** del refutador con
      firmas reales (SSH y GPG): commit banal firmado, subject falseado,
      wildcards, v1, deriva selectiva — todos refutados. Sin bypass
      end-to-end.
- [ ] **Decisión de ADR — frescura obligatoria.** El replay de una atestación
      vieja pasa el gate con `fresh: false` como AVISO y la fase avanza. Es
      doctrina explícita del ADR 0008 («el árbol movido no invalida una
      aprobación»), no un defecto. Pero `--require-fresh` solo existe en
      `signoff --verify` y NADA lo invoca desde `phase-gate`: si algún
      consumidor quiere frescura obligatoria, hay que decidirlo en el ADR y
      cablearlo.

Lección de método anotada en el artefacto: mutar por ancla de cadena cae en
la primera ocurrencia y enseña huecos falsos — verificar siempre que la
mutación tocó el sitio que se quería mutar (nos costó dos falsos sobrevivientes
y un test real de propina).

## Para retomar en la próxima sesión — estado a 2026-08-16

Rama `fix/rupturas-declaradas-y-pgid`. **#41 ya está fusionado a `develop`
(c833945, con `--admin` y el motivo escrito en el PR).** El #40
(`develop` → `main`) quedó **congelado por decisión del mantenedor** hasta
cerrar los pendientes; las rondas 18 y 19 cerraron los suyos y queda la
lista de abajo.

Suite completa en Windows y POSIX (exit 0, con pwsh nativo en WSL),
`npm run validate` en verde, 204 archivos de documentación con sus anclas.

### Lo primero, en este orden

- [x] ~~Empujar / ronda 18 / merge #41.~~ Hecho (ronda 18 en `25d1fa6`,
      merge `c833945`).
- [x] ~~**Ronda 18 sobre `a602f5c`**.~~ Cerrada; dos MENOR que quedaron
      abiertos se cerraron en la ronda 19.
- [x] ~~**Ronda 19: la otra mitad del guard.**~~ Auditada; ver su sección.
- [ ] **Decidir la frescura obligatoria** (ver ronda 19) y, con el criterio
      del mantenedor satisfecho, **mergear #40 a `main`** con `--admin`.
- [ ] **Decidir npm**: `gh workflow run publish.yml`, **nunca `npm publish` a
      mano**.

### Lo que quedó sin verificar de la ronda 17

- [ ] Los hallazgos **razonados** (no ejecutados) sobre códigos `authz-*` sin
      caso propio. `tests/authz-git.test.mjs` cubre la mayoría de forma
      estructural, y la ronda 18 añadió casos por código (10–14), pero no hay
      todavía un caso por cada código del modelo.
- [x] ~~`authz-base-unreachable` (clon superficial) no tiene caso.~~ Caso 16 en
      la ronda 19, con `commit-tree` sin padre.
- [x] ~~Ninguna ejecución real en **GitHub Actions**.~~ Contestado el
      2026-08-15 al empujar `0382d05`: `validate` verde en un runner Linux, y
      `refs/remotes/origin/<base>` **sí** existe con `fetch-depth: 0` — el paso
      nuevo del workflow no pone rojo ningún caso legítimo. El job
      `frontera de especificacion` bloquea con exactamente las 3 violaciones
      diseñadas (escenario bootstrap). Falta por ver: PRs desde fork y la ref
      `refs/pull/N/merge` en ese evento.

### Deuda declarada que sigue abierta

- [x] ~~**La otra mitad del guard de frontera no se auditó.**~~ **Auditada en
      la ronda 19** (2026-08-16): sostuvo los ataques con firmas reales; lo
      que había era cableado y tests, ambos cerrados.
- [ ] **El allowlist del guard no comprueba contenido, solo rutas.** Una
      excepción autoriza cambios ilimitados a esa ruta hasta que caduque. La
      granularidad por contenido es trabajo del ADR 0008 aplicado al
      allowlist, y no se hizo. Es el pendiente grande que queda.
- [ ] **`maxBuffer` de 64 MiB nunca se puso a prueba** con un diff real que lo
      desborde.

### Adopción de gstack — decidido, sin empezar

Análisis completo en la sesión del 2026-08-15. **No entra en
`external-tools.yaml`**: su modo `--team` escribe en el repo un hook
`PreToolUse` con matcher genérico `Skill` que devolvería `deny` para *cualquier*
skill si gstack no está instalado en la máquina de quien clona — interceptaría
las nuestras. Es una superficie de gobierno, no una herramienta puntual.

Lo que sí se decidió adoptar, por orden de valor/esfuerzo:

- [ ] **Enchufar el ledger de lecciones.** `src/skill-lessons.js` ya existe
      entero —fingerprint, `occurrences`, umbral de promoción, gate humano— y
      **nadie lo lee**: es un store de solo escritura. El mismo defecto apareció
      tres veces mientras el mecanismo para evitarlo estaba construido y
      desenchufado. Coste: cero código — añadir a las personas de F9/F10 un
      bloque que ejecute `sdlc skill-lesson --target . --json` y trate toda
      lección con `occurrences >= 2` como lente obligatoria.
      **Ojo**: `lessons.yaml` está en `DEFAULT_LOCKED`, así que cablear el
      `--record` a mitad de slice exige decidir el allowlist antes.
- [ ] **Un checklist de dominio** (`testing.md` de `review/specialists`) como
      sección de la persona de F9, con salida en `F9.yaml` validado. **Uno solo**
      hasta que un slice real justifique otro.
- [ ] **Escritura atómica del checkpoint.** `writeText` es `fs.writeFileSync`
      directo sobre un vault de Obsidian que puede estar sincronizando; un save
      cortado deja un checkpoint truncado que `analyzeCheckpointNarrative`
      leería como **completo**. Añadir `writeTextAtomic` (tmp + rename en el
      mismo directorio) y usarla **solo** en `commandSave`. Que falle ruidoso:
      un `EPERM` silencioso perdería el checkpoint sin avisar.
- [ ] **Validador Tier 1**: que los comandos `sdlc <sub>` citados en las
      SKILL.md existan en el `switch` de `src/cli.js`. Solo subcomandos al
      principio — validar flags contra un parser genérico daría una garantía que
      no existe.


## Espera decisión del mantenedor

- [ ] **Firma del propio repo del framework.** El job `spec-boundary` de
      `.github/workflows/ci.yml` ya corre el guard contra este repo, y hoy
      reporta cuatro violaciones legítimas (su propio `ci.yml`, el
      `regression-install.yml`, la fuente del guard y su allowlist). No hay
      forma de conceder la excepción porque **este repo no tiene
      `.sdlc/config.json` con `governance.maintainers` ni firma de commits
      configurada**: sin un `signer` real, ninguna entrada del allowlist puede
      ser válida.
      Hace falta, y solo lo puede dar el mantenedor: (a) la cadena exacta que
      `git log --format=%GS` reporta para su clave, (b) firma de commits
      activa en el repo. Con eso se escribe `.sdlc/config.json` y las
      excepciones de las rutas que el framework edita de forma rutinaria.
      **Hasta entonces, ese job deja el repo sin poder mergear.**


- [ ] **Publicar 2.0.0.** Estado a 2026-08-16: el ADR 0008 está **implementado
      y auditado** (rondas 11–19), #41 fusionado a `develop` con CI verde
      completo — incluida `frontera de especificacion`, con la allowlist ya en
      la base. Falta: el PR de la ronda 19 a `develop`, deshelar y mergear #40
      a `main`, y decidir npm. El bloqueo de alcance de la sección de abajo
      está resuelto.
- [x] ~~**Montar un job de CI que corra la suite en Linux.**~~ Cubierto de
      hecho: el job `validate` del `ci.yml` corre `pnpm test` completo en un
      runner Linux, y está **verde** sobre `develop` desde el merge de #41
      (2026-08-16) — primera corrida real que incluye los casos POSIX que en
      Windows se saltan con SKIP.
- [x] ~~**Número de versión del modelo de riesgos** (ADR 0008).~~ **Decidido el
      2026-08-14: entra en 2.0.0.** Se descarta la 3.0.0 que se venía asumiendo.
      Razón: 2.0.0 sigue sin publicar, y diferirlo obligaría al consumidor a dos
      majors seguidas sobre el **mismo** mecanismo (sujeto de atestación,
      `signoff`, `phase-gate`), con dos migraciones que se pisan. Consecuencia
      que hay que mirar de frente: **la publicación de 2.0.0 pasa a estar
      bloqueada** por la sección de abajo, y el CHANGELOG deja de tener cuatro
      rupturas. Las rupturas nuevas se declaran **al implementarlas**, no ahora
      — declarar una ruptura que el código no ejerce es el defecto que esta
      misma rama ya cometió dos veces.
- [ ] **Periodo de gracia del fail-closed retroactivo.** El contraste
      adversarial recomendó bloquear desde el primer gate. El coste de
      migración de los consumidores ya instalados es decisión de producto.
- [ ] **Reconciliar el ADR 0007.** Su línea 29 describe la firma humana como
      review `APPROVED` verificado por `gh api`; `src/signoff.js` implementa
      commit firmado y su cabecera argumenta por qué la vía de plataforma es
      insatisfacible con un solo maintainer. ¿Addendum o revisión propia del
      ADR?

## ~~Implementar el ADR 0008~~ — HECHO (2026-08-15)

D1–D7 implementados. Los siete huecos de diseño se cerraron **antes** de
escribir código, y un ataque adversarial al diseño encontró cuatro bloqueantes
más —entre ellos que D3 no producía la propiedad que prometía— que se corrigieron
en el ADR antes de cablear nada.

Qué quedó: `src/authz.js` (puro), `src/authz-git.js` (resolución de BASE y
adjudicación), sujeto v2 con `contract_sha256` y `phase_contract_sha256`,
detección de deriva de política, la matriz de G7 en `doctor`/`upgrade`, el paso
de autorización en el workflow gestionado, `tests/authz.test.mjs` con 9 de 9
mutantes muertos, y las cinco rupturas declaradas.

Antes de escribir código hay que cerrar los siete huecos de diseño que el propio
ADR lista en «Estado de la implementación» (`required()` canónico, match
BASE/HEAD, definición de BASE/HEAD y códigos de salida, precedencia con
`phase.human_gate`, alcance de `humanGate.policy`, migración de evidencia v1 y
matriz de enforcement por comando). Implementar con esos huecos abiertos es
reabrir el diseño a mitad de camino.

- [x] `required(surface, contract)` como función pura y canónica, con tipos
      válidos, valores desconocidos, duplicados y superficie vacía.
- [x] Riesgos por superficie: `money_path`, `regulated_data`,
      `security_critical`, `state_machine_critical`. **Ausente obliga.**
- [x] Sujeto v2: `{ slice, phase, tree_hash, contract_sha256 }`. Hoy el
      `tree_hash` cubre solo las superficies, así que en un repo con superficies
      bajo `apps/` el contrato de la raíz queda fuera y la política se puede
      mutar sin invalidar ninguna atestación.
- [x] Obligación efectiva BASE → HEAD por superficie, con `id` como identidad
      persistente. Borrar, renombrar o mover cuenta como downgrade si no se
      puede demostrar continuidad. BASE irresoluble bloquea.
- [x] Sujeto de **autorización de reducción**, distinto del de atestación de
      fase: `{ base_sha, head_sha, contract_sha256_base, contract_sha256_head,
      surface_ids[] }`.
- [x] Enforcement en `phase-gate`, y solo ahí: `signoff` no adjudica downgrades
      porque no conoce el BASE de la evaluación.
- [x] Rechazo visible de atestaciones v1 en `doctor` y `upgrade`.
- [x] Divergencia config/contrato pasa de `warning` a **error**.
- [x] Precedencia entre `phase.human_gate`, `humanGate.policy` y la obligación
      derivada de riesgos.
- [x] Alcance de `humanGate.policy`: por repositorio, superficie, fase o slice.
- [x] Los ocho tests mínimos que enumera el ADR antes de publicar.

## Deuda técnica conocida

- [ ] **El transitorio de decodificación queda fuera del tope.** `spawnCapture`
      acota los chunks *retenidos*; `Buffer.concat` + `toString` + `split`
      asignan memoria extra que nadie contabiliza. El pico real de RSS sigue sin
      acotar.
- [x] ~~El SIGKILL al grupo usa un pgid que pudo reciclarse.~~ Acotado en la
      ronda 7: `killGraceMs` se valida contra `MAX_KILL_GRACE_MS` (30 s). El
      riesgo no se elimina —cerrarlo pide cgroup o job object, no un pgid— pero
      el argumento de por qué es despreciable ya no depende de un parámetro sin
      límite, que era la objeción real: la prueba usaba 30 s mientras la
      justificación escrita hablaba de 2 s.
- [x] ~~El presupuesto global de memoria.~~ **Eliminado** en la ronda 7, y con
      él la cola, el barging, `grow()`, el crecimiento por bloques y la
      validación de total inválido: −212 líneas netas entre código y pruebas.
      Era la causa raíz de tres bloqueantes seguidos y no acotaba nada que el
      tope por llamada no acotara ya — el pico retenido es (tope por llamada) ×
      (capturas en vuelo), que con `AUDIT_CONCURRENCY` da exactamente el mismo
      techo. La diferencia: el tope por llamada es **local**, el presupuesto era
      **estado compartido**, y por eso dos capturas con la misma entrada podían
      terminar distinto.
      **Lo que se perdió, y es real:** el presupuesto permitía que una captura
      sola usara los 256 MiB enteros. Ahora el tope es fijo en 64 MiB por
      llamada. Quien necesite más pasa su propio `maxBuffer` — en **las dos**
      vías.
- [x] ~~El test POSIX del watchdog no demuestra el SIGKILL.~~ Resuelto, pero en
      la **ronda 6**, no en la 5 como se anotó primero. Lo que la ronda 5 dejó
      escrito era falso por partida doble: el test no llegaba a montar el
      escenario (el nieto moría mientras Node arrancaba, antes de registrar su
      handler) y el fix tampoco funcionaba (`close` cancelaba la escalada). Las
      dos cosas solo se vieron al ejercitar la suite **de verdad en POSIX**,
      bajo WSL. Ahora el nieto sobrevive al SIGTERM, la escalada lo mata, y la
      mutación que revierte el fix hace fallar la prueba.
- [x] ~~Cuatro hallazgos SERIOS/MENORES de la ronda 5.~~ Resueltos
      (`fix(async): los cuatro SERIOS/MENORES...`): listener de `error` en los
      dos `spawn("taskkill", ...)` (antes tumbaba Node entero con un ENOENT sin
      atrapar); `killAllActiveChildren` + registro de hijos detached + listener
      de SIGINT/SIGTERM para que Ctrl-C alcance al grupo POSIX, no solo al
      proceso original de Node; `ensureBudget` pide el delta exacto en vez de
      redondear a bloques de 8 MiB; `createCaptureBudget` rechaza total
      inválido (`NaN`/negativo) en la creación en vez de dejar la cola
      bloqueada para siempre. El de Ctrl-C/detached quedó **a medias** hasta la
      ronda 6: el hijo salía del registro al resolver la promesa, así que un
      Ctrl-C en la ventana entre el corte y su muerte real no lo encontraba.
- [x] ~~Los tests POSIX no se pueden ejercitar en esta máquina.~~ Sí se puede:
      Node instalado en WSL (sin sudo, tarball oficial al home) y la suite
      corriendo sobre una copia nativa del repo. **Merece la pena montarlo en
      CI**: los dos bloqueantes de la ronda 6 solo aparecieron ahí, y uno de
      ellos habría roto CI en Linux en el primer push.
- [ ] **`file-utils` se apropia de SIGINT/SIGTERM del proceso entero** (MENOR de
      la ronda 6). Tras la primera captura POSIX quedan listeners permanentes
      que llaman `process.exit()`. `harness.js` y `signoff.js` también son
      módulos importables: un integrador que instale su propia limpieza puede
      perder el control del ciclo de vida, y `process.exit()` trunca escrituras
      asíncronas pendientes. La política de salida debería vivir en el punto de
      entrada del CLI (`src/cli.js`), con el módulo limpiando y dejando decidir
      a quien llama. Se deja abierto a propósito: moverlo es un cambio de
      arquitectura, no un parche, y no bloquea la publicación.
- [ ] **`run()` cambió de contrato** (devolvía objeto o Promise según comando;
      ahora siempre Promise). El binario está cubierto por `await`, pero es
      cambio de API que merece nota de migración si alguien lo consume.
- [ ] **La auditoría no atribuye la causa de un `subject-mismatch`.** Puede
      venir de una actualización del framework o de un cambio posterior del
      contrato, y el sujeto no guarda la lista histórica de superficies con la
      que se emitió.

## Skills

- [ ] **`configuracion-post-instalacion`** — la skill que no existe en ningún
      sitio y que este README documenta a mano: qué hace el agente **después**
      de instalar en un repo del que el framework no sabe nada. Cierra el hueco
      que justifica todo el trabajo de C1.
- [ ] **Adaptar las cinco skills candidatas de `addyosmani/agent-skills`** (MIT),
      ya inventariadas en `templates/scripts/agent-skills.manifest.json`:
      `security-and-hardening`, `debugging-and-error-recovery`,
      `deprecation-and-migration`, `observability-and-instrumentation`,
      `documentation-and-adrs`. Por la vía del ADR 025: propuesta bajo
      `openspec/changes/`, aprobación humana. **No copiar archivos**: adoptar la
      anatomía (Racionalizaciones, Señales de alarma, Verificación).
- [ ] **Retro-aplicar esa anatomía a las 22 skills canónicas.** Hoy son
      `Trigger` + `Pasos`: dicen qué hacer, no cómo saber que te estás
      engañando. `codex-sesion` es la primera con el formato nuevo.

## El framework no se aplica a sí mismo

- [ ] **`sdlc adopt` sobre este repo.** Gobierna a otros con un ciclo OpenSpec
      que él mismo no usa: no tiene `openspec/`, y sus decisiones viven en
      `docs/adr/`. Es un slice propio y no debería ir de polizón dentro de otro.

## Del lado del consumidor (`manga-translator-mvp`)

- [ ] Declarar los probes no disponibles con motivo en su `quality-contract.yaml`
      — es su tramo 3 y desbloquea F8. **Probado que funciona** sobre una copia:
      F8 pasa de `blocked` a `ok`.
- [ ] `sdlc upgrade --accept-managed` con sus 7 archivos en conflicto, cuando
      2.0.0 esté publicada.
- [ ] Re-firmar la atestación F5 tras actualizar
      (`sdlc signoff … --create --record`).
- [ ] Clasificar la superficie `extension` con los cuatro riesgos cuando exista
      el modelo del ADR 0008. Partirá de `security_critical: true`: declara
      `host_permissions: ["<all_urls>"]` e inyecta content script en cualquier
      origen. Su `tier` sigue en `core` tras revertir una reclasificación a
      `standard` que no estaba justificada.
