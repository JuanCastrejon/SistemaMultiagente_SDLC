# External Tools Matrix

Las herramientas externas son opt-in. La plantilla funciona sin ellas; al activarlas reducen reconstrucción de contexto, mejoran trazabilidad y evitan scanning innecesario cuando se usan bajo el perfil correcto.

## Matriz

| Herramienta | Capa | Perfil elegible | Requerida | Propósito |
| --- | --- | --- | --- | --- |
| OpenSpec | SDD | `LEAN` mínimo, `ANALYSIS` completo | sí | capacidad, proposal, specs, design y tasks |
| CodeGraph | estructura código | `LEAN` | no | símbolos, callers/callees, impacto y contexto AST |
| Graphify | semántica documental | `ANALYSIS` / `ORCHESTRATION` | no | grafo de docs/OpenSpec/ADRs para exploración cross-doc |
| Obsidian | memoria persistente | `ANALYSIS` con `/resume`; cierre con `/save` | no | vault local para checkpoints, chats importados y continuidad |
| caveman | compresión output | cualquiera, conversación | no | reducir output conversacional, no contexto ni reasoning |
| headroom | proxy/cache | cualquiera | no | caché y compresión de tráfico cuando el cliente lo soporte |
| autoskills | skills | según tarea | no | discovery de skills externas |
| vercel-labs/agent-skills | skills externas | según tarea frontend/deploy | no | skills UI/deploy opcionales |
| gh CLI | GitHub | `LEAN` | sí para publish | issues, PRs y releases |

## Cuando NO usar

| Herramienta | No usar para |
|---|---|
| OpenSpec | Reemplazar lectura directa de un path exacto o inflar tareas CRUD triviales |
| CodeGraph | Semántica documental, ADRs, specs o memoria |
| Graphify | Loops normales de implementación `LEAN` o estructura de código |
| Obsidian | Retrieval continuo o fuente de verdad normativa |
| caveman | Docs, commits, PRs o como solución a contexto alto |
| headroom | Sustituir perfiles operativos o ocultar fallos de proxy |

## Instalacion base

1. Instalar Node.js >= 18.
2. Instalar `gh` y autenticar:

```powershell
gh auth login
gh auth status
```

3. Instalar PowerShell 7 (`pwsh`) en Linux/macOS o usar PowerShell en Windows.
4. Desde el repo consumidor ejecutar:

```powershell
npm install
node ./bin/sdlc.js install --mode greenfield --target .
node ./bin/sdlc.js doctor --target . --json
```

## Obsidian + memoria persistente

1. Copiar la config ejemplo:

```powershell
Copy-Item scripts/obsidian-memory.config.example.json scripts/obsidian-memory.config.local.json
```

2. Editar `scripts/obsidian-memory.config.local.json`:

- `workspaceRoot`: `{{obsidian.memoryWorkspace}}`
- `vaultRoot`: `{{obsidian.memoryWorkspace}}\vault`
- `projectSlug`: `{{project.slug}}`
- `graphifyObsidianDir`: `{{obsidian.memoryWorkspace}}\vault\graphify\{{project.slug}}`

3. Revisar el plan sin escribir:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/bootstrap-obsidian-vault.ps1 -Json
```

4. Crear el vault cuando el plan sea correcto:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/bootstrap-obsidian-vault.ps1 -Apply
```

5. Abrir Obsidian y seleccionar el vault creado. La plantilla no requiere plugins obligatorios.

## headroom (proxy de contexto)

headroom actúa como proxy entre el agente y la API de Anthropic. Aporta caché y compresión de tráfico; no reemplaza la disciplina de perfiles ni reduce por sí mismo el contexto cargado.

**Instalación:**

```powershell
npm install -g headroom
```

**Configurar Claude Code** (`~/.claude/settings.json`):

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:8787"
  }
}
```

**Arranque del proxy:**

```powershell
pwsh -NonInteractive -File scripts/headroom-start.ps1
```

**Registrar autoarranque en Windows** (una sola vez por máquina — acto del usuario, no del agente):

```powershell
pwsh -ExecutionPolicy Bypass -File scripts/register-headroom-task.ps1
Get-ScheduledTask -TaskName "{{project.slug}}-Headroom-Autostart"
```

Sin la tarea registrada, Codex y VS Code/Copilot no arrancan headroom automáticamente. Claude Code sí (vía hook SessionStart).

**Regla crítica:** si el proxy falla, **no limpiar `ANTHROPIC_BASE_URL`**. Silenciar el bypass es peor que un fallo visible. El script registra fallos en `%APPDATA%\headroom\health-last-fail.txt`.

## Regla de ahorro de tokens: jerarquía de retrieval

Violar esta separación duplica contexto y eleva costos 3x–8x en sesiones largas.

| Nivel | Herramienta | Usar para |
|---|---|---|
| 0 | Read directo | Artefacto conocido por path |
| 1 | CodeGraph (`codegraph_*`) | Estructura de código |
| 2 | Graphify (`graphify query/path/explain`) | Semántica documental cross-doc |
| 3 | Obsidian vault | `/resume`, checkpoints y chats |
| 4 | OpenSpec specs | Capacidades canonizadas |
| 5 | Grep / Glob | Texto literal |
| 6 | WebSearch / WebFetch | Conocimiento externo |

Regla de oro: usar el nivel más bajo aplicable y justificar cualquier salto. Nunca ejecutar CodeGraph y Graphify para la misma consulta.

## Graphify

1. Generar o actualizar el grafo con la herramienta que uses para tu repo:

```powershell
graphify update .
```

2. Exportar el grafo hacia el vault:

```powershell
python scripts/export-graphify-obsidian.py --graph graphify-out/graph.json --output-dir "{{obsidian.memoryWorkspace}}\vault\graphify\{{project.slug}}"
```

3. En futuras sesiones, `scripts/continua.ps1` revisa `graphify-out/GRAPH_REPORT.md` si existe.

## caveman para ahorro de tokens

Usar caveman solo en coordinación operativa, no en specs finales ni docs públicas.

Modo recomendado:

```text
caveman lite: resumir estado F5/F6 y siguiente acción
```

Regla: caveman comprime output conversacional, pero no reduce contexto ni reasoning. Las decisiones durables deben quedar en OpenSpec, docs o `.github/agent-state/`.

## Sync Claude/Codex a Obsidian

Dry-run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-claude-obsidian.ps1 -Json
```

Aplicar:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-claude-obsidian.ps1 -Apply -Json
```

La importación de chats completos es determinística y no usa modelo por defecto. `/save` sigue siendo el checkpoint decisional explícito; no generar auto-resúmenes con LLM sin un change separado.

Registrar tarea programada en Windows:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/register-claude-sync-task.ps1 -DryRun -Json
powershell -ExecutionPolicy Bypass -File scripts/register-claude-sync-task.ps1 -Apply
```

## Política opt-in

- Ningún script instala paquetes externos sin flag explícito.
- `publish-trace` no crea issues sin `-Apply`.
- Scheduler no se registra sin `-Apply`.
- Configs locales `*.local.json` no deben versionarse.
