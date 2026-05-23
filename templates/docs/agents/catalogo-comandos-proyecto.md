# Catalogo de Comandos del Proyecto

## CLI SDLC

| Comando | Uso |
| --- | --- |
| `sdlc install --mode greenfield` | instala gobierno en proyecto nuevo |
| `sdlc install --mode legacy` | instala gobierno en proyecto brownfield |
| `sdlc doctor --json` | valida estado instalado |
| `sdlc diff --json` | detecta drift contra templates |
| `sdlc upgrade --to-version 1.3.0` | aplica migraciones |
| `sdlc rollback --to <backup>` | restaura backup |
| `sdlc prune-backups --keep 5` | limpia backups antiguos |

## Skills OpenSpec

| Skill | Proposito |
| --- | --- |
| `/opsx:new` | crear change nuevo |
| `/opsx:propose` | formular proposal/spec/design/tasks |
| `/opsx:explore` | investigar repo o legacy antes de cambiar |
| `/opsx:apply` | aplicar tasks aprobadas |
| `/opsx:verify` | verificar cumplimiento |
| `/opsx:archive` | archivar change cerrado |
| `/opsx:continue` | retomar change en curso |

## Scripts

| Script | Default seguro |
| --- | --- |
| `scripts/continua.ps1 -NoLock -Json` | lectura sin lock |
| `scripts/publish-trace.ps1 -DryRun -Json` | no crea issues |
| `scripts/bootstrap-agent-skills.ps1 -SkipExternalInstall` | mirrors locales, sin descargas |
| `scripts/register-claude-sync-task.ps1 -DryRun` | no registra scheduler |
| `scripts/bootstrap-obsidian-vault.ps1` | plan dry-run |
| `scripts/sync-claude-obsidian.ps1` | plan dry-run |

## Git Flow

- Rama estable: `{{gitFlow.stableBranch}}`.
- Rama de integracion: `{{gitFlow.integrationBranch}}`.
- Prefijos permitidos: `feature/`, `fix/`, `docs/`.
