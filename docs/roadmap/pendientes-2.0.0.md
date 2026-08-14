# Pendientes tras 2.0.0

Estado a 2026-08-14, rama `fix/hallazgos-consumidor-mvp` (28 commits sobre `develop`).
`npm test` y `npm run validate` en verde. **Sin push, sin PR y sin publicar.**

Cada punto trae por dónde empezar. Lo que espera una decisión del mantenedor va
primero, porque bloquea al resto.

---

## Espera decisión del mantenedor

- [ ] **Publicar 2.0.0.** La rama está lista. Falta `git push`, PR contra
      `develop` y decidir si se publica a npm. El gate local
      (`scripts/validate-local-gate.ps1`) no se ha ejecutado todavía en modo
      `-Strict`.
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

- [ ] **El transitorio de decodificación queda fuera del presupuesto.**
      `spawnCapture` acota los chunks *retenidos*; `Buffer.concat` + `toString`
      + `split` asignan memoria extra que nadie contabiliza, y la reserva se
      libera antes de que `hashLsTree` termine. El pico real de RSS sigue sin
      acotar.
- [x] ~~El test POSIX del watchdog no demuestra el SIGKILL.~~ Resuelto en la
      ronda 5 (`fix(async): dos bloqueantes...`): el caso nuevo de
      `tests/async-parity.test.mjs` escribe el PID de un nieto que ignora
      SIGTERM, espera `killGraceMs + margen` y comprueba que ya no existe. Solo
      cubre el escenario del nieto (POSIX); el caso viejo (test 6, lider suelto)
      sigue sin ejercitar la escalada en Windows por la misma razón de siempre.
- [ ] **Cuatro hallazgos SERIOS/MENORES de la ronda 5, dejados fuera del commit
      a propósito por no ser bloqueantes** (Codex + contraste propio,
      `src/file-utils.js`):
      - `taskkill` se lanza sin listener de `error`: si no está en PATH, el
        ENOENT es asíncrono, el `try/catch` no lo atrapa, y tumba el proceso
        Node entero en vez de fallar limpio.
      - `detached: true` cambia la semántica de Ctrl-C: el terminal señala al
        grupo original de Node, no al hijo detached: puede quedar huérfano.
      - El presupuesto cuenta bloques de crecimiento (≥8 MiB) reservados por
        adelantado, no bytes realmente retenidos: puede cortar por
        "presupuesto" con margen real de sobra.
      - `createCaptureBudget(-1 | NaN)` dejan la cola bloqueada para siempre en
        vez de rechazar el total inválido en la creación.
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
