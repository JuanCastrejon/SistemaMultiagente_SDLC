# ADR 0002: Adopción de CodeGraph en coexistencia con Graphify

- Estado: Aceptada (2026-05-19, reemplaza la versión Propuesta original)
- Fecha: 2026-05-19
- Decisor: equipo SistemaMultiagente_SDLC
- Issue de seguimiento: pendiente
- Reemplaza: la versión inicial de este ADR proponía un spike de 7 días con benchmarks sintéticos obligatorios. La estrategia se simplificó a "instalar y observar" según indicación del decisor: la verificación del ahorro de tokens claimado por CodeGraph (94 % menos tool-calls según su README) se hará por observación natural durante varias sesiones reales, no por benchmark forzado. El histórico de la versión Propuesta queda accesible en el historial git del archivo.

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

Adoptar CodeGraph **en coexistencia con Graphify**, sin spike sintético previo. El install y la integración MCP se hacen ya; la decisión sobre si CodeGraph se vuelve preferente sobre Graphify (o lo reemplaza) se posterga hasta tener evidencia natural acumulada de varias sesiones reales.

### Qué se hace inmediatamente

1. Instalar CodeGraph global vía `npm install -g @colbymchenry/codegraph` en la máquina del decisor.
2. Inicializar el index en repos consumidores con `codegraph init` + scope narrow en `.codegraph/config.json` (excluir tests, generated, docs, openspec, graphify-out; `maxFileSize=512KB`) para evitar el OOM observado al indexar un monorepo NestJS+Next completo con la config default.
3. Registrar el MCP server en Claude Code vía `.claude.json` local (per-project).
4. Commitear los artefactos versionables (`.claude.json`, `.claude/CLAUDE.md`, `.codegraph/config.json`, `.codegraph/.gitignore`) y gitignorar la base SQLite + cache.
5. Preservar el hook PreToolUse Bash que apunta a `graphify-out/GRAPH_REPORT.md` (Graphify sigue siendo primer paso en `enrich-us` 4.5).

### Qué NO se hace todavía

- **No se modifica** `templates/` ni `bootstrap-agent-skills.ps1` del framework reusable. La adopción es local-first en repos consumidores; la canonización en el template viene cuando haya evidencia de coexistencia estable.
- **No se reemplaza** el paso 4.5 de `enrich-us` (Graphify-first). CodeGraph entra como complemento MCP-runtime.
- **No se exige benchmark sintético**. La verificación de los claims de ahorro de tokens (94 % menos tool-calls según README de CodeGraph) se hará por observación natural durante uso real.

### Reglas de coexistencia

| Caso | Herramienta preferida | Razón |
|---|---|---|
| `enrich-us` paso 4.5, prior art investigation, lectura humana del grafo | Graphify | Genera markdown reports, HTML viewer, community detection con god nodes, export Obsidian. |
| Queries estructurales dentro de una sesión agentic (símbolos, callers, impact, context) | CodeGraph vía MCP | Sub-milisegundo, devuelve kind+location+signature en una llamada, framework-aware. |
| Snapshot persistente versionado del grafo para diffs cross-PR | Graphify | `graphify-out/` se commitea para review humano y onboarding. |
| Refresh incremental tras edits | CodeGraph (`codegraph sync .`, watcher 2 s) | Graphify requiere `graphify update .` manual. |

### Trigger para canonizar el cambio (ADR 0004)

Abrir ADR 0004 cuando se cumpla cualquiera:

1. Se observa reducción medible de tool-calls/tokens en sesiones reales del repo `FacturacionDian` (no benchmark sintético — log natural de uso).
2. Se confirma que la cobertura de rutas framework para NestJS+Next.js es suficientemente alta para sustituir parte del trabajo manual de Graphify.
3. El costo operativo (OOMs adicionales, drift, MCP availability) supera el beneficio.

En el caso (3) la decisión esperada es retroceso parcial; en (1)+(2) podría canonizarse la preferencia en el template del framework reusable.

## Consecuencias

- Costo inmediato: bajo. La instalación y wiring están hechos. Sin slice dedicado.
- Riesgo: bajo. El install es reversible vía `codegraph uninit` + `git rm` de los archivos versionados. El hook Graphify se preserva.
- Reversibilidad: total. Tanto en el repo consumidor (FacturacionDian) como en este framework (que NO se ha modificado por este ADR).
- Si la observación natural arroja evidencia clara, ADR 0004 canoniza el cambio en `templates/`. Si no, se mantiene la coexistencia indefinidamente o se documenta el retroceso.

## Implementación en FacturacionDian

La adopción operativa se ejecutó en `FacturacionDian` el 2026-05-19 vía PR `chore(codegraph): instalar CodeGraph local + MCP server Claude Code`. Ver `docs/agents/external-tools-matrix.md` de ese repo para footprint, triggers MCP reales y reglas de coexistencia.

Métricas del index inicial sobre `FacturacionDian` (scope narrow):

- 658 archivos parseados (TypeScript en `apps/` y `packages/`).
- 7.954 nodes (3.879 method, 2.268 import, 658 file, 492 class, 277 function, 189 interface, 152 constant).
- 14.869 edges.
- 14.48 MB native SQLite (better-sqlite3).

## Referencias

- README oficial CodeGraph: https://github.com/colbymchenry/codegraph
- Graphify (en uso): https://github.com/safishamsi/graphifyy
- ADR relacionada: `docs/adr/0001-repo-limpio-y-extraccion-gobernada.md` (gobierno de qué entra al manifest).
