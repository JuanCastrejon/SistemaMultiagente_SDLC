---
name: party-mode
description: "Coordina debate multi-rol acotado por fase F1/F2/F5. Usar cuando una fase necesita voces especializadas antes de producir el artefacto canónico."
---

# Party Mode

Party-mode no instala BMAD completo. Porta el patrón de debate multi-voz dentro del contrato F0-F17.

## Fases permitidas

| Fase | Voces |
|---|---|
| F1 Requirements Analysis | `product-owner-agent`, `analista-requisitos`, `project-manager-agent`, `qa-test-architect-agent`, `ux-designer-agent` si hay UI |
| F2 Human Draft Review | resumen de PO, analista, PM y QA test architect como apoyo a la decisión humana |
| F5 SDD Planning | `planificador-opus`, `arquitecto`, `qa-test-architect-agent` y owners de superficie |

## Fases no permitidas

- F9 QA: owner único `qa-security-review`.
- F10 Security: owner único `qa-security-review`.

## Reglas

- Máximo una ronda por voz y un resumen consolidado.
- El owner de fase decide el artefacto final.
- No reemplaza gate humano ni promueve borradores por sí solo.
