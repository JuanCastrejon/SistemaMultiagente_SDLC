# Pendientes tras 2.0.0

Estado a 2026-08-14, rama `fix/hallazgos-consumidor-mvp` (33 commits sobre `develop`), tras siete rondas de revision adversarial.
`npm test` y `npm run validate` en verde. **Sin push, sin PR y sin publicar.**

Cada punto trae por dónde empezar. Lo que espera una decisión del mantenedor va
primero, porque bloquea al resto.

---

## Bloquea el push — ronda 8 CERRADA, 0 bloqueantes y 3 SERIOS

La ronda 8 se completó reanudando la sesión con otra cuenta (ver
`docs/guides/codex-revision-reanudable.md`). Veredicto: **0 BLOQUEANTES**, 3
SERIOS y 7 MENORES. Registro completo en `.codex-out/ronda-8/hallazgos.md`.
Mínimo para publicar según Codex: los tres SERIOS.

- [ ] **SERIO — `CAPTURE_CEILING_BYTES` no es un techo aplicado.** El cálculo
      *64 MiB × 4* solo vale dentro de UNA ejecución de `auditAttestations`.
      `spawnCapture` es exportación pública sin tope de concurrencia propio.
      **Medido por Codex:** cinco capturas simultáneas de 63 MiB retuvieron
      315 MiB con pico de 497 MiB de RSS. Y un mutante que reintroduce un límite
      compartido *a partir de la quinta* captura dejó la suite en 14/14, porque
      el caso 12 solo lanza cuatro.
      **Corregido en el README** (ya no se presenta como límite aplicado);
      queda decidir si se impone el tope en el borde público.
- [ ] **SERIO — la regresión 256→64 MiB no tiene escape.**
      `computeTreeHashAtRef` y `computeTreeHashAtRefAsync` fijan
      `TREE_HASH_MAX_BUFFER` y **no aceptan opciones**; `signoff --create`,
      `--verify` y `--record` tampoco. Un árbol >64 MiB queda
      `tree-ref-unreadable` y no puede firmarse ni avanzar de fase.
      **El README afirmaba que bastaba pasar `maxBuffer`: era falso y ya está
      corregido.** Falta la decisión de producto: exponer configuración
      coherente para las dos vías, o conservar explícitamente los 256 MiB
      síncronos.
- [ ] **SERIO — 30 s de gracia no hacen despreciable el pgid reciclado.**
      `pid_max` es un valor de wrap configurable del kernel, no una garantía de
      esta librería, así que el argumento no es portable a otros consumidores o
      namespaces. Y el propio caso 18 usa el peor valor permitido. Mitigación
      mínima: bajar el máximo cerca del default de 2 s con una prueba literal.
      Cierre real: cgroup o job object.

### Mutantes que SOBREVIVIERON (los tests afirman más de lo que prueban)

Todos ejecutados por Codex sobre la copia POSIX:

- [ ] `+1 KiB` al límite combinado → 14/14 verde. La vía async acepta hasta
      1 KiB más que `spawnSync`: **la paridad vuelve a romperse en el borde**.
      Falta probar exactamente `maxBuffer` y `maxBuffer + 1` en ambos órdenes.
- [ ] `.normalize("NFC")` en `decodeCapture` → 14/14 verde. Un principal de
      firma en NFD podría juzgarse distinto en las dos vías.
- [ ] `MAX_KILL_GRACE_MS` de 30 s a 60 s → 14/14 verde, porque el test calcula
      su entrada inválida como `MAX_KILL_GRACE_MS + 1` **importado del propio
      código**. Hay que afirmar el máximo literal.
- [ ] `Math.min(4, …)` en vez de `Math.min(concurrency, …)` en `runPool` →
      14/14 verde. El grado de paralelismo que pida un consumidor se ignora.
- [ ] Orden por bytes: cambiar `Buffer.compare` por comparación UTF-16 → 14/14
      verde. `Z`, `a`, `ñ` ordenan igual por ambos criterios.
- [ ] Detalle de error del `ls-tree` async → 14/14 verde: el caso del ref
      inexistente compara solo `ok` y `code`, no el diagnóstico.
- [ ] `trip` con resolución retrasada 1 s → 14/14 verde: el caso 6 solo exige
      <10 s, no la propiedad comentada de liberar el hueco del pool de inmediato.

## Espera decisión del mantenedor

- [ ] **Publicar 2.0.0.** Falta `git push`, PR contra `develop` y decidir si se
      publica a npm. El gate local (`scripts/validate-local-gate.ps1`) no se ha
      ejecutado todavía en modo `-Strict`. **Sujeto a cerrar el bloque de
      arriba.**
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
