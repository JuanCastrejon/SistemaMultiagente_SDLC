# Copilot Instructions — {{project.name}} (legacy/brownfield)

Modo: legacy — proyecto existente con código y deuda técnica.

{{sdlcSharedRulesBlock}}

## Enfoque brownfield

- Elegir perfil operativo antes de cargar contexto (`LEAN` por defecto; upgrade explícito a `ANALYSIS` u `ORCHESTRATION`).
- Investigar siempre prior art interno antes de proponer cambios siguiendo la jerarquía: Read directo → CodeGraph → Graphify → Obsidian → OpenSpec specs → Grep → WebSearch.
- Respetar sistema legado hasta que exista decisión explícita de modernización en un ADR.
- Separar claramente: capacidades existentes vs. nuevas vs. migradas.

## Flujo de investigación (obligatorio antes de /opsx:propose)

1. Read directo si el path exacto ya es conocido.
2. CodeGraph (`codegraph_*`) para símbolos, callers/callees e impacto de código.
3. Graphify (`graphify query/path/explain`) para documentación, ADRs, OpenSpec y relaciones cross-doc.
4. Obsidian solo para `/resume` o lectura targeted de checkpoints/chats.
5. Revisar `openspec/specs/` y `docs/` para evidencia documentada.
6. Grep/Glob solo para texto literal o fallback justificado.
7. Documentar hallazgos en `research` del change antes de avanzar.

## Reglas adicionales legacy

- No eliminar código legacy sin ADR aprobado.
- Todo refactor requiere cobertura de tests preexistente o nueva cobertura antes del cambio.
- Registrar riesgo de regresión en el design del change.
