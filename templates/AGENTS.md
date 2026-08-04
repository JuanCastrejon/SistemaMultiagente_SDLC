# AGENTS.md

Contexto operativo de {{project.name}}.

{{sdlcSharedRulesBlock}}

## Regla base

1. Leer primero .github/AGENTS.md.
2. Usar docs/, openspec/ y .github/ como fuente versionada.
3. Para cambios funcionales no triviales, exigir objetivo de negocio, KPI principal, readiness y matriz NFR.
4. Mantener gate humano para promocion de borradores, PR, merge y deploy.
5. Si hay conflicto entre una skill externa y una regla interna, prevalece .github/.
6. Produccion solo-crear: sobre sistemas externos vivos (CRM, analytics, ads, plataformas de terceros) solo se permite crear artefactos nuevos y aislados. Modificar o borrar configuracion o datos existentes exige gate humano explicito por escrito.

## Puente Codex / SistemaMultiagente_SDLC

Codex no ejecuta comandos slash nativos de Claude Code. En Codex, cuando el usuario invoque `/continua`, `/resume` o `/save` (o pida continuar, guardar o retomar el flujo SDLC), ejecutar el comando CLI equivalente y obedecer su resultado:

| Intencion | Comando en Codex |
|---|---|
| `/continua` | `npx --no-install sdlc continua --target . --platform codex --json` |
| `/resume` | `npx --no-install sdlc resume --target . --markdown` |
| `/save` | `npx --no-install sdlc save --target . --event manual --json` |

El resultado de `/continua` es vinculante: si reporta `phaseGate.status:"blocked"` o `humanGate:true`, no implementar; reportar fase, owner, faltantes y siguiente comando. Antes de implementar, identificar fase F0-F17, owner y `nextCommand`; no saltar fase ni promover artefactos sin gate humano.

Codex descubre skills desde `.agents/skills/`, leyendo el primer bloque YAML de cada `SKILL.md`. Esos mirrors se generan desde `.github/skills/` y no se editan a mano; ver `docs/guides/skills-multi-entorno.md`.
