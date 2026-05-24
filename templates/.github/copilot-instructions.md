# Copilot Instructions — {{project.name}}

Proyecto gobernado por SistemaMultiagente_SDLC {{frameworkVersion}}.
Modo: {{mode}}

{{sdlcSharedRulesBlock}}

## Contexto normativo

- La verdad normativa vive en `.github/AGENTS.md`, `AGENTS.md`, `openspec/` y `docs/`.
- Usar `graphify-out/` para exploración cross-module si el grafo existe.
- Toda decisión funcional no trivial requiere OpenSpec change antes de implementación.

## Stack

Backend: {{stack.backend}}
Frontend: {{stack.frontend}}
{{#stack.mobile}}Mobile: {{stack.mobile}}{{/stack.mobile}}

## Flujo canónico

```
/enrich-us <historia>   → enriquecer con business fit, KPI, readiness, NFRs
/opsx:ff <change-name>  → proposal + specs + design + tasks de un tirón
/opsx:apply             → implementar tasks una por una
/opsx:verify            → validar contra artefactos del change
/opsx:archive           → archivar y sincronizar specs canónicas
/commit [#issue]        → commit Conventional + PR contra {{gitFlow.integrationBranch}}
```

## Reglas

- No implementar sin OpenSpec change aprobado (cambios funcionales no triviales).
- No promover borradores a PR sin gate humano.
- Branches: `feature/`, `fix/`, `docs/` → `{{gitFlow.integrationBranch}}` → `{{gitFlow.stableBranch}}`.
- Escalar al humano para: decisiones arquitectónicas, cambios de infraestructura, merges a `{{gitFlow.stableBranch}}`.
