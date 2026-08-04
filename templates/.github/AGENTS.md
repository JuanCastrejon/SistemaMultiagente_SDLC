# AGENTS.md - Gobierno SDLC

Proyecto: {{project.name}}
Modo: {{mode}}

{{sdlcSharedRulesBlock}}

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
- Antes de `git push` o `gh pr create`, ejecutar `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/validate-local-gate.ps1 -ChangeName <change>` y resolver errores de harness.
- `qa-security-review` revisa la evidencia local antes del cierre humano.
- Produccion solo-crear: sobre sistemas externos vivos solo se crean artefactos nuevos y aislados; modificar o borrar configuracion o datos existentes exige gate humano explicito por escrito.
- Seguridad de skills: escanear `.github/skills/` (por ejemplo con `nvidia/skillspector`) antes de ejecutar `bootstrap-agent-skills`, para no propagar una skill comprometida a los tres mirrors.

## Puente Codex

Codex no ejecuta slash commands nativos. Equivalencias obligatorias:

| Intencion | Comando en Codex |
|---|---|
| `/continua` | `npx --no-install sdlc continua --target . --platform codex --json` |
| `/resume` | `npx --no-install sdlc resume --target . --markdown` |
| `/save` | `npx --no-install sdlc save --target . --event manual --json` |

Si `/continua` reporta `phaseGate.status:"blocked"` o `humanGate:true`, Codex no implementa: reporta fase, owner, faltantes y siguiente comando.

Codex descubre skills en `.agents/skills/` leyendo el primer bloque YAML de cada `SKILL.md`. Los mirrors se regeneran con `scripts/bootstrap-agent-skills.ps1` y se verifican con `node scripts/validate-codex-skills.mjs`; nunca se editan a mano.
