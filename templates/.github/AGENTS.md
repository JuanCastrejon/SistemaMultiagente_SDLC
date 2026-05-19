# AGENTS.md - Gobierno SDLC

Proyecto: {{project.name}}
Modo: {{mode}}

## Orden de prioridad

1. .github/AGENTS.md
2. .github/instructions/*.instructions.md
3. .github/skills/*/SKILL.md
4. AGENTS.md e indice-operativo.md
5. docs/agents/*.md y docs/guides/*.md

## Flujo canonico

F0-F17 gobierna ideas, analisis, planning, orquestacion, implementacion, QA, seguridad, PR, merge, archive y publish trace.

## Superficies

| ID | Path | Owner |
|---|---|---|
{{surfacesTable}}

## Reglas

- No implementar cambios funcionales no triviales sin definicion validada.
- No promover borradores a Issue ni PR sin gate humano.
- Usar handoffs cuando el trabajo cruce fase, agente o superficie.
- Ejecutar validators cuando cambie gobierno, specs, docs o superficies del producto.
