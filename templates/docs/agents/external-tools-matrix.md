# External Tools Matrix

Las herramientas externas son opt-in. La plantilla funciona sin ellas; al activarlas reducen reconstruccion de contexto, mejoran trazabilidad y ahorran tokens.

## Matriz

| Herramienta | Capa | Requerida | Proposito |
| --- | --- | --- | --- |
| OpenSpec | SDD | si | capacidad, proposal, specs, design y tasks |
| Graphify | memoria estructural | no | grafo de docs/codigo para exploracion rapida |
| Obsidian | memoria persistente | no | vault local para checkpoints y continuidad |
| caveman | compresion | no | reducir tokens en comunicacion operativa |
| headroom | presupuesto | no | estimar espacio de contexto antes de tareas largas |
| autoskills | skills | no | discovery de skills externas |
| vercel-labs/agent-skills | skills externas | no | skills UI/deploy opcionales |
| gh CLI | GitHub | si para publish | issues, PRs y releases |

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

Usar caveman solo en coordinacion operativa, no en specs finales ni docs publicas.

Modo recomendado:

```text
caveman lite: resumir estado F5/F6 y siguiente accion
```

Regla: caveman comprime conversacion, pero las decisiones durables deben quedar en OpenSpec, docs o `.github/agent-state/`.

## Sync Claude/Codex a Obsidian

Dry-run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-claude-obsidian.ps1 -Json
```

Aplicar:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-claude-obsidian.ps1 -Apply -Json
```

Registrar tarea programada en Windows:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/register-claude-sync-task.ps1 -DryRun -Json
powershell -ExecutionPolicy Bypass -File scripts/register-claude-sync-task.ps1 -Apply
```

## Politica opt-in

- Ningun script instala paquetes externos sin flag explicito.
- `publish-trace` no crea issues sin `-Apply`.
- Scheduler no se registra sin `-Apply`.
- Configs locales `*.local.json` no deben versionarse.
