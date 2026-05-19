# Skill: enrich-us

Enriquece una historia de usuario vaga con contexto de negocio, KPI, readiness y NFRs mínimos antes de entrar al flujo OpenSpec.

## Trigger

`/enrich-us <#issue|texto>` — ejecutar antes de `/opsx:ff` en cambios funcionales no triviales.

## Pasos

1. **Leer input**: historia cruda, Issue o descripción informal.
2. **Prior art** (obligatorio):
   a. `graphify query "<tema>"` — nodos relacionados.
   b. `graphify path` y `graphify explain` para profundizar.
   c. `openspec/specs/`, `docs/architecture/`, `docs/domain/` — evidencia documentada.
   d. Si el grafo no devuelve hits útiles, buscar en código con Grep.
3. **Enriquecer**:
   - Objetivo de negocio explícito.
   - KPI principal medible.
   - Readiness L1/L2/L3 propuesto.
   - NFRs mínimos (rendimiento, seguridad, disponibilidad).
4. **Registrar conclusión de prior art** en el bloque `Prior art` del enhanced.
5. Presentar borrador enriquecido al humano antes de avanzar a `/opsx:ff`.
