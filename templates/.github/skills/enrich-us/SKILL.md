# Skill: enrich-us

Enriquece una historia de usuario vaga con contexto de negocio, KPI, readiness y NFRs mínimos antes de entrar al flujo OpenSpec.

## Trigger

`/enrich-us <#issue|texto>` — ejecutar antes de `/opsx:ff` en cambios funcionales no triviales.

## Pasos

1. **Leer input**: historia cruda, Issue o descripción informal.
2. **Declarar perfil**: `enrich-us` requiere `ANALYSIS`; no es elegible para `LEAN`.
3. **Prior art** (obligatorio), aplicando la jerarquía de retrieval:
   a. Read directo si el path canónico ya está citado.
   b. CodeGraph (`codegraph_*`) solo para estructura de código: símbolos, callers/callees, impacto.
   c. Graphify (`graphify query/path/explain`) para semántica documental, ADRs, OpenSpec, guides y relaciones cross-doc.
   d. Obsidian solo para `/resume` o lectura targeted de checkpoints/chats históricos.
   e. `openspec/specs/`, `docs/architecture/`, `docs/domain/` — evidencia documentada.
   f. Grep/Glob solo para texto literal o fallback justificado.
   g. WebSearch/WebFetch solo si el prior art interno no alcanza.
4. **Enriquecer**:
   - Objetivo de negocio explícito.
   - KPI principal medible.
   - Readiness L1/L2/L3 propuesto.
   - NFRs mínimos (rendimiento, seguridad, disponibilidad).
5. **Registrar conclusión de prior art** en el bloque `Prior art` del enhanced.
6. Presentar borrador enriquecido al humano antes de avanzar a `/opsx:ff`.
