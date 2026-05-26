# Copilot Instructions — {{project.name}}

Proyecto gobernado por SistemaMultiagente_SDLC {{frameworkVersion}}.
Modo: {{mode}}

{{sdlcSharedRulesBlock}}

## Contexto normativo

- La verdad normativa vive en `.github/AGENTS.md`, `AGENTS.md`, `openspec/` y `docs/`.
- Elegir perfil operativo antes de cargar contexto.
- Usar CodeGraph para estructura de código y `graphify-out/` para exploración documental cross-doc si el perfil lo permite.
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

| Nivel | Herramienta | Usar para |
|---|---|---|
| 0 | Read directo | Artefacto conocido por path |
| 1 | **CodeGraph** (`codegraph_*`) | Estructura de código: callers, callees, impacto, firma de símbolo |
| 2 | **Graphify** (`graphify query/path/explain`) | Semántica cross-doc: docs, OpenSpec, ADRs, guides |
| 3 | Obsidian vault | `/resume`, checkpoints y chats importados |
| 4 | OpenSpec specs | Capacidades canonizadas |
| 5 | **Grep / Glob** | Texto literal |
| 6 | WebSearch / WebFetch | Conocimiento externo |

Regla: usar el nivel más bajo aplicable y justificar cualquier salto. Nunca ejecutar CodeGraph y Graphify para la misma consulta.

**party-mode** solo en fases F2 (Análisis), F3 (Diseño) y F4 (Validación). No en F5+ ni para tareas CRUD estándar.

**Graphify** no se usa en loops normales de implementación. Solo para: onboarding, análisis de arquitectura cross-módulo, y research de prior art.

**Obsidian / resume** solo al inicio (`/resume`) y fin (`/save`) de un bloque de trabajo.

## Reglas

- No implementar sin OpenSpec change aprobado (cambios funcionales no triviales).
- No promover borradores a PR sin gate humano.
- Branches: `feature/`, `fix/`, `docs/` → `{{gitFlow.integrationBranch}}` → `{{gitFlow.stableBranch}}`.
- Escalar al humano para: decisiones arquitectónicas, cambios de infraestructura, merges a `{{gitFlow.stableBranch}}`.
