# SistemaMultiagente SDLC

Plantilla operativa para instalar un SDLC multiagente gobernado en `{{project.name}}`.

## Tesis

BMAD orquesta; SistemaMultiagente_SDLC orquesta y verifica. El enfoque es brownfield-first, SDD por slice y agil por release.

## Flujo F0-F17

| Fase | Objetivo | Gate |
| --- | --- | --- |
| F0 | Bootstrap del sistema | `sdlc doctor` sin errores |
| F1 | Analisis de requisitos | alcance y KPI claros |
| F2 | Revision humana del borrador | aprobacion humana |
| F3 | Issue local y validacion | issue listo para promocion |
| F3.5 | Branch desde integracion | branch creada desde `{{gitFlow.integrationBranch}}` |
| F4 | Handoff readiness-gate | readiness L1/L2/L3 declarado |
| F5 | Planificacion SDD | OpenSpec/change listo |
| F6 | Handoff planificador-orquestador | rutas y owners definidos |
| F7 | Orquestacion | especialistas asignados |
| F8 | Implementacion | codigo y pruebas iniciales |
| F9 | QA tests | regresion verde |
| F10 | Security review | findings cerrados o aceptados |
| F11 | Commit y push | commit trazable |
| F12 | Pull request | PR con evidencia |
| F13 | Gate humano final | review final |
| F14 | Merge a integracion | merge controlado |
| F15 | Verify post-merge | verificacion post-merge |
| F16 | Archive | OpenSpec/archive actualizado |
| F17 | Doc viva y publish trace | docs y trazabilidad publicadas |

## Capas

- Governance: `AGENTS.md`, `.github/AGENTS.md`, `CLAUDE.md`, `indice-operativo.md`.
- Agent state: `.github/agent-state/`.
- Agents: `.github/agents/*.agent.md`.
- Skills: `.github/skills/` como fuente canonica.
- OpenSpec: `openspec/`.
- Memory opt-in: `scripts/obsidian-memory.config.local.json` + Obsidian/Graphify.

## Regla de rework

El rework se activa por labels explicitos `rework:<phase>:<reason>`, no por interpretacion libre de comentarios.
