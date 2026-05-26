---
name: party-mode
description: "Coordina debate multi-rol acotado por perfil ORCHESTRATION. Usar solo en F2/F3/F4 o fase local equivalente cuando exista change OpenSpec activo y una decisión requiera contraste multi-voz."
---

# Party Mode

Party-mode no instala BMAD completo. Porta el patrón de debate multi-voz dentro del contrato SDLC sin reemplazar gates humanos.

## Fases permitidas

| Fase | Voces |
|---|---|
| F2 Análisis | `product-owner-agent`, `analista-requisitos`, `project-manager-agent`, `qa-test-architect-agent`, `ux-designer-agent` si hay UI |
| F3 Diseño | `planificador-opus`, `arquitecto`, `qa-test-architect-agent` y owners de superficie |
| F4 Validación | `qa-security-review`, `arquitecto`, owner de superficie y `tech-writer-agent` si hay ADR/guía |

## Fases no permitidas

- F0/F1: triage o definición sin debate.
- F5+ implementación: owner único por slice.
- F9/F10 QA/security: owner único `qa-security-review`.

## Reglas

- Rechazar si no hay `ChangeName` explícito (`party-mode <change-name>` o equivalente) ni una única referencia `openspec/changes/<change-name>` en `.github/agent-state/current-slice.md`.
- Validar que existe exactamente `openspec/changes/<ChangeName>/` y que la decisión debatida pertenece a ese change.
- Declarar `Perfil: ORCHESTRATION` y justificar por qué `ANALYSIS` no basta.
- Máximo 4 voces, 3 rondas y 400 palabras de contexto compartido por ronda.
- El owner de fase decide el artefacto final.
- No reemplaza gate humano ni promueve borradores por sí solo.
