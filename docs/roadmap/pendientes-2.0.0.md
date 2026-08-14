# Pendientes tras 2.0.0

Estado a 2026-08-14, rama `fix/hallazgos-consumidor-mvp` (44 commits sobre `develop`), tras seis rondas de revision adversarial (5 a 10).
`npm test` y `npm run validate` en verde, en Windows y en POSIX. **Empujada y con PR abierto contra `develop`; sin merge y sin publicar.**

Cada punto trae por dónde empezar. Lo que espera una decisión del mantenedor va
primero, porque bloquea al resto.

---

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

## Espera decisión del mantenedor

- [ ] **Publicar 2.0.0.** Rama empujada y **PR abierto contra `develop`**. Falta
      la revisión humana, el merge, y decidir si se publica a npm. El gate local
      (`scripts/validate-local-gate.ps1`) no se ha ejecutado todavía en modo
      `-Strict`.
      Tras seis rondas adversariales (5 a 10) no queda ningún BLOQUEANTE
      abierto. Sí quedan un SERIO declarado (pgid) y cinco MENORES, todos
      anotados abajo y ninguno bloqueante.
- [ ] **Montar un job de CI que corra la suite en Linux.** Es el hallazgo de
      mayor palanca de toda la sesión: los dos bloqueantes de la ronda 6 **solo**
      aparecen ejercitando POSIX, y uno de ellos habría roto CI en Linux en el
      primer push. Hoy nada en el repo lo garantiza: en Windows esos casos se
      saltan con `SKIP` y el verde es engañoso.
- [ ] **Número de versión del modelo de riesgos** (ADR 0008). No cabe en una
      minor: «superficie sin clasificar ⇒ firma obligatoria» bloquea a todo
      consumidor existente en su siguiente gate humano. Probablemente 3.0.0; se
      fija al implementarlo.
- [ ] **Periodo de gracia del fail-closed retroactivo.** El contraste
      adversarial recomendó bloquear desde el primer gate. El coste de
      migración de los consumidores ya instalados es decisión de producto.
- [ ] **Reconciliar el ADR 0007.** Su línea 29 describe la firma humana como
      review `APPROVED` verificado por `gh api`; `src/signoff.js` implementa
      commit firmado y su cabecera argumenta por qué la vía de plataforma es
      insatisfacible con un solo maintainer. ¿Addendum o revisión propia del
      ADR?

## Implementar el ADR 0008 — modelo de riesgos de autorización

Diseño cerrado y escrito en `docs/adr/0008-modelo-de-riesgos-de-autorizacion.md`.
**Nada de esto está implementado en 2.0.0.** Sus siete decisiones no se pueden
partir sin dejar hueco explotable, así que van juntas.

- [ ] `required(surface, contract)` como función pura y canónica, con tipos
      válidos, valores desconocidos, duplicados y superficie vacía.
- [ ] Riesgos por superficie: `money_path`, `regulated_data`,
      `security_critical`, `state_machine_critical`. **Ausente obliga.**
- [ ] Sujeto v2: `{ slice, phase, tree_hash, contract_sha256 }`. Hoy el
      `tree_hash` cubre solo las superficies, así que en un repo con superficies
      bajo `apps/` el contrato de la raíz queda fuera y la política se puede
      mutar sin invalidar ninguna atestación.
- [ ] Obligación efectiva BASE → HEAD por superficie, con `id` como identidad
      persistente. Borrar, renombrar o mover cuenta como downgrade si no se
      puede demostrar continuidad. BASE irresoluble bloquea.
- [ ] Sujeto de **autorización de reducción**, distinto del de atestación de
      fase: `{ base_sha, head_sha, contract_sha256_base, contract_sha256_head,
      surface_ids[] }`.
- [ ] Enforcement en `phase-gate`, y solo ahí: `signoff` no adjudica downgrades
      porque no conoce el BASE de la evaluación.
- [ ] Rechazo visible de atestaciones v1 en `doctor` y `upgrade`.
- [ ] Divergencia config/contrato pasa de `warning` a **error**.
- [ ] Precedencia entre `phase.human_gate`, `humanGate.policy` y la obligación
      derivada de riesgos.
- [ ] Alcance de `humanGate.policy`: por repositorio, superficie, fase o slice.
- [ ] Los ocho tests mínimos que enumera el ADR antes de publicar.

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
