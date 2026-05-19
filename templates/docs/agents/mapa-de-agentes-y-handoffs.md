# Mapa de Agentes y Handoffs

| Fase | Owner principal | Handoff esperado |
| --- | --- | --- |
| F1-F3 | `analista-requisitos` | requisitos -> planificador |
| F4-F5 | `planificador-opus` | plan -> orquestador |
| F6-F7 | `orquestador-opus` | routing -> especialistas |
| F8 | `api-nestjs`, `web-admin`, `mobile-sync` | implementacion -> QA |
| F9 | `qa-security-review` | QA -> security |
| F10 | `qa-security-review` | security -> commit |
| F11-F12 | `orquestador-opus` | commit/PR -> review |
| F13 | humano | review -> merge o rework |
| F14-F17 | `orquestador-opus` | merge -> verify -> archive -> trace |

## Regla

Todo cambio de owner o fase deja archivo en `.github/agent-state/handoffs/`.
