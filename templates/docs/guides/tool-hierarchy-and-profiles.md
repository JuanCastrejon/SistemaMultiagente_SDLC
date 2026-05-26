# Guía operativa: jerarquía de retrieval y perfiles operativos

- Estado: vigente desde SistemaMultiagente_SDLC {{frameworkVersion}}
- Referencia normativa: ADR local de jerarquía/perfiles
- Enforcement: soft (docs + skills + revisión humana)

Esta guía define cuándo usar cada herramienta de contexto y bajo qué perfil operativo. El objetivo es evitar `context amplification`: cargar AGENTS, CLAUDE, Copilot, Graphify, CodeGraph, Obsidian, OpenSpec y skills al mismo tiempo sin necesidad.

## Jerarquía obligatoria de retrieval

Toda consulta "where / what / why / who" usa el nivel más bajo aplicable. Saltar a un nivel superior solo es válido cuando el nivel inferior no resolvió la pregunta.

| Orden | Cuándo aplica | Tool |
|---|---|---|
| 0 | Artefacto conocido por path | `Read` directo |
| 1 | Estructura de código: símbolo, callers, callees, impacto | CodeGraph (`codegraph_*`) |
| 2 | Semántica documental, arquitectura, prior-art cross-doc | Graphify (`graphify query/path/explain`) |
| 3 | Memoria persistente, checkpoints, chats históricos | Obsidian vault (`/resume`, lectura targeted) |
| 4 | Capacidades funcionales canonizadas | OpenSpec `specs/` |
| 5 | Texto literal, strings de error, comentarios | `Grep` / `Glob` |
| 6 | Conocimiento externo | `WebSearch` / `WebFetch` |

Reglas:

- CodeGraph y Graphify no se ejecutan para la misma consulta.
- Graphify no se usa en loops normales de implementación.
- Obsidian no es retrieval continuo; se usa para `/resume`, `/save` y lectura targeted.
- WebSearch es último recurso y requiere fuente, fecha y fit.

## Matriz de propiedad

| Dominio | Fuente única |
|---|---|
| Estructura de código | CodeGraph |
| Semántica documental | Graphify |
| Memoria operativa, checkpoints, chats | Obsidian vault externo |
| Capacidades funcionales | `openspec/specs/` |
| Decisiones arquitectónicas | `docs/adr/` |
| Gobierno | `.github/` + bloque `SDLC_SHARED_RULES` |
| Skills | `.github/skills/` |
| Inventario de tools externas | `docs/agents/external-tools-matrix.md` |
| Doctrina jerarquía + perfiles | `docs/guides/tool-hierarchy-and-profiles.md` |

Otros documentos referencian; no duplican.

## Perfiles operativos

### LEAN

Default para CRUD, bug fix, refactor menor a 3 archivos y edición documental puntual.

Carga:

- bloque `SDLC_SHARED_RULES`
- CodeGraph
- OpenSpec specs mínimas de la capability tocada
- headroom si está disponible

No carga:

- Graphify
- Obsidian retrieval
- party-mode
- enrich-us
- specialist personas

### ANALYSIS

Para F2/F3, prior-art, onboarding o diseño cross-doc.

Carga:

- todo `LEAN`
- Graphify
- Obsidian (`/resume` un checkpoint relevante)
- OpenSpec change completo del trabajo en curso

No carga:

- party-mode
- specialist personas en loop de implementación

### ORCHESTRATION

Para F4, validación, tradeoffs complejos o debate multi-voz.

Carga:

- todo `ANALYSIS`
- party-mode
- enrich-us si la historia llega vaga
- specialist personas necesarias

Límites:

- máximo 4 voces
- máximo 3 rondas
- máximo 400 palabras de contexto compartido por ronda

## Context budget soft

| Perfil | Capas máximas activas | Heurística |
|---|---|---|
| `LEAN` | 4 | No cargar Graphify, Obsidian retrieval, party-mode ni enrich-us |
| `ANALYSIS` | 6 | No cargar specialist personas ni party-mode |
| `ORCHESTRATION` | 9 | Techo de carga; requiere justificación |

KPI recomendado: tokens por cambio útil, no tokens absolutos por sesión.

## Obsidian

La importación de chats completos al vault es evidencia histórica y no usa modelo por defecto. `/save` es el checkpoint decisional explícito. No crear auto-resúmenes con LLM sin un change separado.

## Gate local pre-push/pre-PR

Antes de `git push` o `gh pr create`, ejecutar:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/validate-local-gate.ps1 -ChangeName <change> -SkipInstall
```

Para paridad total con CI desde instalación limpia, omitir `-SkipInstall`.

Este gate ejecuta validadores locales, OpenSpec, bootstrap de skills, `sdlc governance-check` y `sdlc tools-doctor`. Si falla `shared-rules-hash-mismatch`, usar el hash `actual` reportado por `sdlc governance-check`; no recalcular manualmente con otro algoritmo. `qa-security-review` revisa esta evidencia antes del cierre humano.

## Referencias

- `docs/agents/external-tools-matrix.md`
- `docs/guides/memoria-persistente-multiagente.md`
- `.github/skills/contexto-proyecto/SKILL.md`
- `.github/skills/enrich-us/SKILL.md`
- `.github/skills/party-mode/SKILL.md`
