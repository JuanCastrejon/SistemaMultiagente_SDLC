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

## Límites de Herramientas de Análisis

Para evitar duplicación de contexto y sobrecarga de tokens:

| Herramienta | Usar para | No usar para |
|---|---|---|
| **CodeGraph** (`codegraph_*`) | Estructura de código: callers, callees, impacto de cambio, firma de símbolo | Semántica documental, ADRs, specs, requisitos |
| **Graphify** (`graphify query/path/explain`) | Semántica cross-doc: relaciones entre docs, OpenSpec, ADRs, guides | Código de producto |
| **Grep / cavecrew-investigator** | Texto literal: strings de log, comentarios, contenido no estructurado | Lookups de símbolos o estructura |

Regla: nunca ejecutar CodeGraph y Graphify para la misma consulta.
- Pregunta estructural de código → CodeGraph primero.
- Pregunta semántica de docs/arquitectura → Graphify si el grafo existe.
- Búsqueda literal → Grep, solo si no aplican los anteriores.

**party-mode** solo en fases F2 (Análisis), F3 (Diseño) y F4 (Validación). No en F5+ ni para tareas CRUD estándar.

**Graphify** no se usa en loops normales de implementación. Solo para: onboarding, análisis de arquitectura cross-módulo, y research de prior art.

**Obsidian / resume** solo al inicio (`/resume`) y fin (`/save`) de un bloque de trabajo.

## Reglas

- No implementar sin OpenSpec change aprobado (cambios funcionales no triviales).
- No promover borradores a PR sin gate humano.
- Branches: `feature/`, `fix/`, `docs/` → `{{gitFlow.integrationBranch}}` → `{{gitFlow.stableBranch}}`.
- Escalar al humano para: decisiones arquitectónicas, cambios de infraestructura, merges a `{{gitFlow.stableBranch}}`.
