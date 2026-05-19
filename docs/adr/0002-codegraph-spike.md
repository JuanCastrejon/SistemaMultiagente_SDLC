# ADR 0002: Spike de CodeGraph como complemento o reemplazo de Graphify

- Estado: Propuesta
- Fecha: 2026-05-19
- Decisor: equipo SistemaMultiagente_SDLC
- Issue de seguimiento: pendiente

## Contexto

El framework ya integra [Graphify (`safishamsi/graphifyy`)](https://github.com/safishamsi/graphifyy) como motor de knowledge graph del repo. Graphify cubre:

- Build inicial vía LLM (`graphify .`) y refresh AST local (`graphify update .`).
- Reportes Markdown (`graphify-out/GRAPH_REPORT.md`) y HTML viewer.
- Community detection con god nodes.
- Export a vault de Obsidian para continuidad multiagente.

La skill `enrich-us` lo declara fuente preferida sobre `grep`/`cavecrew-investigator` cuando `graphify-out/` existe.

En 2026-05-19 se evaluó [CodeGraph (`colbymchenry/codegraph`)](https://github.com/colbymchenry/codegraph) como alternativa o complemento. Hallazgos:

| Atributo | CodeGraph (v0.7.9) | Graphify (paquete `graphifyy`) |
|---|---|---|
| License | MIT | (a confirmar) |
| Lenguaje implementación | TypeScript (95%) | Python |
| Storage | SQLite + FTS5 | JSON + Markdown |
| Parser | tree-sitter (19+ lenguajes, incluido Pascal/Delphi) | AST local + extracción semántica LLM |
| **MCP server nativo** | **Sí** (`codegraph serve --mcp`) | **No** |
| **Framework route extraction** | **Sí**, 13 frameworks (Django, FastAPI, Express, NestJS, Next, Spring, Rails, etc.) | **No** |
| Auto-config Claude Code / Codex / Cursor / opencode | Sí (escribe `CLAUDE.md`, `.cursor/rules/`, `~/.codex/AGENTS.md`) | No (manual) |
| Watcher incremental | Sí, debounce 2 s | No (manual `graphify update`) |
| Comunidad y madurez | 5.1k★, 263 commits, 18 issues abiertos, 37 PRs | uso interno, sin métricas públicas comparables |
| Benchmarks self-reported | 94 % menos tool-calls, 77 % más rápido sobre 6 codebases | sin benchmarks publicados |
| Community detection / god nodes | No | **Sí**, distintivo |
| Markdown/HTML reports | No (datos en SQLite) | **Sí** |
| Export Obsidian | No | **Sí** vía `scripts/export-graphify-obsidian.py` |

## Decisión

Aprobar un **spike de 7 días calendario** para evaluar CodeGraph sin abandonar Graphify. El spike debe responder con datos medibles si:

1. El MCP server de CodeGraph reduce realmente el consumo de tokens en flujos típicos del repo (búsqueda de capacidades, navegación cross-module, resolución de impacto).
2. La extracción de rutas framework cubre NestJS y Next.js de forma usable en este monorepo.
3. La complejidad operativa adicional (SQLite, MCP wiring) cabe en el flujo `bootstrap-agent-skills.ps1` o si requiere un instalador separado.

El spike NO compromete ninguna migración. Al cierre se decide:

- **Coexistencia**: CodeGraph como MCP-runtime para queries de agentes, Graphify como snapshot persistente + reportes humanos + exportación Obsidian.
- **Reemplazo total**: descartar Graphify si CodeGraph cubre community detection (vía features de roadmap) y reports markdown.
- **Descartar CodeGraph**: si los benchmarks no se reproducen sobre el stack NestJS+Next o el costo operativo es alto.

## Alcance del spike

Branch: `spike/codegraph-evaluation` desde `develop`.

Entregables obligatorios:

- `docs/spikes/codegraph/README.md` — protocolo de medición y resultados.
- `docs/spikes/codegraph/benchmark.md` — comparativa por flujo (`enrich-us`, `cavecrew-investigator`, `analista-requisitos-migracion`):
  - tokens consumidos por consulta típica
  - llamadas a herramienta por consulta
  - latencia end-to-end
  - cobertura de rutas detectadas para NestJS y Next.js
- `docs/spikes/codegraph/risks.md` — riesgos identificados (vendor lock, drift, MCP availability).
- `docs/spikes/codegraph/decision.md` — recomendación final: coexistencia, reemplazo o descarte.

NO se modifica `bootstrap-agent-skills.ps1` ni `agent-skills.manifest.json` durante el spike. Cualquier instalación de CodeGraph queda local en `.codegraph/` y NO se versiona dentro del repo donor.

## Consecuencias

- Costo: 7 días calendario, foco en F0-F2 del slice "evaluación tooling".
- Riesgo: se introduce un MCP server extra en el entorno local del evaluador. Acotado a su máquina; nada se publica al manifest hasta decisión.
- Reversibilidad: total. El spike no toca `templates/`, `src/` ni `bin/`.
- Si la decisión es coexistencia o reemplazo, se abrirá ADR 0004 con la implementación concreta.

## Referencias

- README oficial CodeGraph: https://github.com/colbymchenry/codegraph
- Graphify (en uso): https://github.com/safishamsi/graphifyy
- ADR relacionada: `docs/adr/0001-repo-limpio-y-extraccion-gobernada.md` (gobierno de qué entra al manifest).
