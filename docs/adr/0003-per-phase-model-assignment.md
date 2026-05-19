# ADR 0003: Per-phase model assignment en `models.yaml`

- Estado: Aceptada
- Fecha: 2026-05-19
- Decisor: equipo SistemaMultiagente_SDLC
- Implementación: v1.3.0

## Contexto

El framework declaró en `templates/scripts/models.yaml` una matriz `roles × platforms` para asignar modelos por rol (orquestador, planificador, developer, reviewer) y plataforma (Claude Code, Codex, Copilot, Windsurf). Ese mapeo es coarse-grained: un developer recibe siempre el mismo modelo aunque esté en F0 (triage rápido) o en F3 (diseño técnico crítico).

En 2026-05-19 se evaluó el patrón de [`gentle-ai` (Gentleman-Programming)](https://github.com/Gentleman-Programming/gentle-ai), que permite per-phase model routing vía `--profile-phase cheap:sdd-design:claude-sonnet-4-20250514`. La idea base: distintos pasos del SDD tienen distinto retorno marginal por tier de modelo. Asignar:

- Modelos baratos (Haiku, Qwen free) a exploración / triage / lectura masiva.
- Modelos potentes (Opus, GPT-5) a diseño y decisiones arquitectónicas.
- Modelos intermedios (Sonnet) a implementación y revisión.

reduce costo sin sacrificar calidad en las fases donde la precisión es crítica.

## Decisión

Extender `templates/scripts/models.yaml` con un bloque **opcional** `phases:` que permite override por fase del flujo SDD (F0-F17) o por pseudo-fase (`sdd-explore`, `sdd-design`, `sdd-implement`, `sdd-review`). Cuando una fase no aparezca en `phases`, se cae al rol equivalente del bloque `roles`.

Schema:

```yaml
phases:
  <phase-name>:
    primary: <model-id>
    fallback: <model-id>
```

- `phase-name` es libre: nombres canónicos F0-F17 documentados en `docs/agents/presentacion-sistema-multiagente-sdlc.md` o pseudo-fases SDD listadas arriba.
- `primary` y `fallback` siguen el mismo formato que `roles.*`.
- Modelos `:free` o `cheap:*` quedan permitidos para fases donde la precisión no es crítica (`sdd-explore`, F0 triage, lectura masiva, descubrimiento legacy).

El validador `scripts/validate-models-schema.mjs` se extiende para:

- Permitir `phases` como clave top-level (se añade al `allowedTopLevel`).
- Si el bloque existe, exigir que cada entrada declare `primary` y `fallback` (mismo shape que `roles`).
- Marcar como error un bloque `phases:` declarado pero vacío.

## Default values en el template

El template instalado distribuye:

| Fase | primary | fallback | Racional |
|---|---|---|---|
| `sdd-explore` | Haiku 4.5 | Sonnet 4.6 | F0 / triage / lectura amplia; precisión baja es aceptable |
| `sdd-design` | Opus 4.7 | Sonnet 4.6 | F2-F3 / decisiones arquitectónicas; precisión es la métrica clave |
| `sdd-implement` | Sonnet 4.6 | Haiku 4.5 | F5+ / código por slice; balance costo-precisión |
| `sdd-review` | Sonnet 4.6 | Haiku 4.5 | F6+ / verificación; precisión media es suficiente |

Estos defaults son opinados pero seguros. El equipo destino puede sobreescribirlos sin tocar el validador (el bloque entero es opt-in).

## Consecuencias

### Positivas

- Reducción de costo medible en flujos altamente exploradores (`enrich-us` paso 4.5, `cavecrew-investigator`, lectura de grafo).
- Calidad mantenida o mejorada en F2-F3 al subir a Opus por defecto en `sdd-design`.
- Compatibilidad total con la matriz `roles × platforms` previa (el bloque es additivo).
- Habilita medición posterior: comparar costo por slice antes/después del rollout.

### Negativas / riesgos

- Mayor superficie de configuración por mantener (un campo más en el `models.yaml` del repo destino).
- Posible drift si un equipo activa `phases` y olvida actualizar `roles`; la regla "phases override roles" debe quedar clara en la skill que consuma el archivo.
- No se enforza runtime que el agente realmente use el modelo asignado. Es un contrato de configuración; la verificación es manual o vía métricas posteriores.

### Reversibilidad

Total. Borrar el bloque `phases:` devuelve el comportamiento a v1.2.x.

## Implementación

- `templates/scripts/models.yaml` — bloque `phases:` con defaults documentados arriba.
- `scripts/validate-models-schema.mjs` — soporte para `phases` opcional + verificación de shape.
- `CHANGELOG.md` — sección [1.3.0] documenta el cambio.
- Documentación del flujo de override: aprovechar la skill `enrich-us` y `orquestacion-multiagente` para que el orquestador consulte `phases.<phase-name>` antes que `roles.<role>`.

NO se hace bump de `frameworkVersion` en v1.3.0 por este ADR aislado; ese bump corresponde al release agregado v1.3.0 cuando se sume el resto del batch (party-mode, delegation-triggers, etc.).

## Referencias

- `templates/scripts/models.yaml` — schema actualizado.
- `scripts/validate-models-schema.mjs` — validador.
- Inspiración: `gentle-ai` (Gentleman-Programming), patrón `--profile-phase`.
- ADR relacionada: `docs/adr/0002-codegraph-spike.md`.
