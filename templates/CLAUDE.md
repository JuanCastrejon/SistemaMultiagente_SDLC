@AGENTS.md

{{sdlcSharedRulesBlock}}

## graphify

Este proyecto mantiene un grafo de conocimiento en `graphify-out/` con nodos dominantes, estructura por comunidades y relaciones entre archivos.

Reglas:
- Leer siempre `graphify-out/GRAPH_REPORT.md` antes de búsquedas amplias cuando el grafo cubra la pregunta.
- Preferir `graphify query`, `graphify path` y `graphify explain` sobre búsquedas raw con grep para razonamiento cross-module.
- Después de ediciones estructurales, ejecutar `graphify update .` para mantener el grafo actualizado.

## continuity

- La verdad canónica vive primero en el repo: `openspec/`, `docs/`, `.github/`, `AGENTS.md`, `indice-operativo.md`.
- La memoria persistente externa vive en `{{obsidian.vaultPath}}`, workspace `{{obsidian.memoryWorkspace}}`.
- `/resume` recompone contexto en este orden: repo → `graphify-out/` → último checkpoint del vault.
- `/save` escribe un checkpoint estructurado en el vault y nunca sustituye la promoción de decisiones duraderas al repo.
- Respetar el gate humano estricto: borrador local → revisión humana → Issue → validación → OpenSpec o implementación.

## skill-bootstrap

- Carpetas nativas de skills por agente:
  - Claude Code: `.claude/skills/`
  - GitHub Copilot / Codex: `.agents/skills/`
  - Windsurf: `.windsurf/skills/`
- Usar el script de bootstrap del repo para sincronizar skills desde `.github/skills/`.
