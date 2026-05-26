# Memoria Persistente Multiagente

Guía operativa para combinar la verdad versionada del repo, Graphify y un vault local de Obsidian sin mezclar responsabilidades.

## Objetivo

- reducir reexplicación de contexto entre sesiones,
- mantener continuidad entre Claude, Codex, Copilot y Windsurf,
- preservar que la verdad normativa siga en el repositorio,
- permitir que un agente continúe trabajo iniciado por otro sin perder owner, change, slice, decisiones, riesgos ni gate humano.

## Jerarquía de contexto

1. **Repositorio versionado**:
   - `.github/`
   - `AGENTS.md`
   - `indice-operativo.md`
   - `openspec/specs/`
   - `openspec/changes/`
   - `docs/`
2. **CodeGraph**:
   - estructura de código,
   - símbolos,
   - callers/callees,
   - impacto.
3. **Graphify**:
   - `graphify-out/GRAPH_REPORT.md`
   - `graphify query|path|explain`
   - notas Obsidian derivadas en `graphify/{{project.slug}}/`
4. **Vault externo**:
   - checkpoints,
   - logs de sesión,
   - chats importados,
   - notas derivadas.
5. **Código raw / historial no importado**:
   - solo cuando las capas 1-4 no resuelven la duda.

## Regla central

El vault **no reemplaza** la fuente de verdad del repositorio.

Si del vault sale una decisión duradera, debe promoverse a una de estas superficies:

- `docs/`
- `openspec/`
- `AGENTS.md` / `.github/AGENTS.md`
- `CHANGELOG.md`

## Gate humano estricto

La memoria compartida no elimina revisión humana. Toda promoción sigue esta secuencia:

1. borrador local en vault o artefacto local
2. revisión humana
3. promoción a `GitHub Issue`
4. validación humana del Issue
5. OpenSpec o implementación

`GitHub Issues` sigue siendo la autoridad operativa de validación funcional humana.

## Comandos operativos

### `Continua`

Comando principal de reanudación de ejecución. Retoma desde el último checkpoint técnico/documental y sigue con el siguiente bloque pendiente.

### `/resume`

Comando auxiliar de reconstrucción de contexto.

Secuencia:

1. leer repositorio canónico,
2. leer CodeGraph para estructura de código,
3. leer `graphify-out/` si el perfil es `ANALYSIS` u `ORCHESTRATION`,
4. leer el último checkpoint del vault,
5. resumir estado y dejar listo el siguiente paso para `Continua`.

`/resume` no implementa cambios solo por invocarse.

### `/save`

Comando auxiliar de checkpoint.

Debe escribir en el vault:

- `owner-agent`
- `change-id`
- `slice-id`
- `phase`
- `estado`
- trabajo realizado,
- decisiones tomadas,
- pendientes,
- riesgos,
- `promotion-status`,
- vínculos útiles,
- promoción pendiente al repo si aplica.

`/save` no reemplaza el update de documentación viva ni hace commit/push automático. La importación de chats completos al vault es determinística y no usa modelo por defecto; los auto-resúmenes con LLM requieren un change separado.

## Layout local recomendado

Para este proyecto se usa un workspace local fuera de sincronización en la nube. Configurar la ruta en `scripts/obsidian-memory.config.local.json`.

Estructura recomendada bajo `{{obsidian.memoryWorkspace}}`:

```text
{{obsidian.memoryWorkspace}}/
├── vault/
│   ├── AGENTS.md
│   ├── CLAUDE.md
│   ├── permanent/
│   ├── inbox/
│   ├── fleeting/
│   ├── templates/
│   ├── logs/
│   ├── references/
│   ├── chats/
│   │   ├── code/
│   │   ├── web/
│   │   ├── codex/
│   │   └── copilot/
│   ├── graphify/
│   │   └── {{project.slug}}/
│   └── {{project.slug}}/
│       ├── architecture/
│       ├── pipeline/
│       ├── data/
│       ├── features/
│       ├── drafts/
│       ├── reviews/
│       └── logs/
├── exports/
│   ├── code/
│   └── web/
└── logs/
```

## Scripts versionados

- `scripts/bootstrap-obsidian-vault.ps1`
  - crea estructura del workspace,
  - si hace falta registra el vault en Obsidian,
  - deja notas base para el proyecto.
- `scripts/claude-to-obsidian.py`
  - importa Markdown de Claude y sesiones repo-scoped de Codex/Copilot,
  - agrega frontmatter, tags y wikilinks,
  - evita reimportar por manifest y actualiza sesiones cuando cambian.
- `scripts/sync-claude-obsidian.ps1`
  - instala/verifica el extractor,
  - exporta conversaciones de Claude Code,
  - ejecuta el importador multiagente.
- `scripts/register-claude-sync-task.ps1`
  - mantiene la tarea diaria de Windows apuntando al sync multiagente.
- `scripts/export-graphify-obsidian.py`
  - exporta `graphify-out/graph.json` a notas derivadas para el árbol `vault/graphify/`.

## Configuración local

El contrato portable vive en:

- `scripts/obsidian-memory.config.example.json`

La configuración real de esta máquina vive fuera de Git en:

- `scripts/obsidian-memory.config.local.json`

## Graphify + Obsidian

`graphify-out/` sigue siendo la fuente estructural primaria del repo.

La exportación a Obsidian se usa como derivado navegable:

```powershell
graphify update .
python scripts/export-graphify-obsidian.py --graph graphify-out/graph.json --output-dir {{obsidian.memoryWorkspace}}\vault\graphify\{{project.slug}}
```

Nota:
la documentación upstream de Graphify menciona flags `--obsidian`, pero la versión local instalada no siempre los expone en su CLI. Por eso este framework versiona un exportador de compatibilidad.

## Automatización diaria

La sincronización multiagente se puede registrar como tarea de Windows con:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/register-claude-sync-task.ps1
```

El directorio `exports/web/` queda preparado para que el usuario copie exportaciones manuales de Claude Web/App cuando lo necesite. Codex y Copilot se leen directo desde sus stores locales, filtrados por `repoRoot`.

## Privacidad y saneamiento

- no versionar el vault ni sus exports,
- no guardar secretos en notas importadas,
- auditar antes de promover una nota a `docs/` o `openspec/`,
- mantener el workspace fuera de sincronización en la nube para evitar fallas de ruta y locking.

## Validación mínima

Después de tocar esta capa, ejecutar las validaciones locales del proyecto (ver `package.json` para los scripts disponibles).
