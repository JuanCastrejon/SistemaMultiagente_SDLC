# Copilot Instructions — {{project.name}} (legacy/brownfield)

Modo: legacy — proyecto existente con código y deuda técnica.

## Enfoque brownfield

- Investigar siempre prior art interno antes de proponer cambios (graphify → openspec/specs → docs → código).
- Respetar sistema legado hasta que exista decisión explícita de modernización en un ADR.
- Separar claramente: capacidades existentes vs. nuevas vs. migradas.

## Flujo de investigación (obligatorio antes de /opsx:propose)

1. `graphify query "<tema>"` — detectar nodos relacionados.
2. `graphify path "<A>" "<B>"` — trazar relaciones cross-module.
3. Revisar `openspec/specs/` y `docs/` para evidencia documentada.
4. Documentar hallazgos en `research` del change antes de avanzar.

## Reglas adicionales legacy

- No eliminar código legacy sin ADR aprobado.
- Todo refactor requiere cobertura de tests preexistente o nueva cobertura antes del cambio.
- Registrar riesgo de regresión en el design del change.
