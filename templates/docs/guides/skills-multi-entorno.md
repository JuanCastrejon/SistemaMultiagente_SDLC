# Skills Multi-Entorno

Guía para mantener `Claude Code`, `Codex`, `VS Code / GitHub Copilot` y `Windsurf` alineados en este repositorio.

## Respuesta corta

No, **solo** poner `@AGENTS.md` dentro de `CLAUDE.md` **no basta**.

Eso resuelve la **delegación de reglas compartidas**, pero no instala ni sincroniza las skills que cada agente necesita en sus rutas nativas.

## Qué resuelve cada capa

| Capa | Propósito | Superficies |
|---|---|---|
| Contrato compartido | Reglas, gobierno, flujo, gates, contexto | `AGENTS.md`, `.github/AGENTS.md`, `.github/copilot-instructions.md`, `indice-operativo.md`, `CLAUDE.md` |
| Skills internas del repo | Dominio, OpenSpec, control plane, documentación viva | `.github/skills/` |
| Skills nativas por agente | Hacer que cada entorno realmente pueda cargar las skills | `.claude/skills/`, `.agents/skills/`, `.windsurf/skills/` |
| Comandos de agente | Superficies de invocación específicas, por ejemplo Claude | `.claude/commands/` |

## Mapa por entorno

| Entorno | Entry point principal | Skills nativas | Notas |
|---|---|---|---|
| Claude Code | `CLAUDE.md` | `.claude/skills/` | También usa `.claude/commands/` |
| Codex | `AGENTS.md` | `.agents/skills/` | Codex no consume `.github/skills/` como skill root nativo |
| GitHub Copilot / VS Code | `.github/copilot-instructions.md` | `.github/skills/` y `.agents/skills/` | `.github/skills/` gobierna el repo; `.agents/skills/` cubre skills del ecosistema `skills` |
| Windsurf | `AGENTS.md` + `.windsurf/rules/` | `.windsurf/skills/` | Requiere rule + skill path propios |

## Decisión adoptada

La fuente canónica de las skills **gobernadas por el repo** es `.github/skills/`.

Luego se replican a las rutas nativas de los agentes con:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/bootstrap-agent-skills.ps1
```

Esto evita mantener `.claude/skills/`, `.agents/skills/` y `.windsurf/skills/` a mano.

## Qué se versiona y qué se genera

Se versiona:

- `AGENTS.md`, `CLAUDE.md`, `.github/AGENTS.md`, `.github/copilot-instructions.md`
- `.github/skills/` como fuente canónica del repo
- `scripts/agent-skills.manifest.json`
- `scripts/bootstrap-agent-skills.ps1`
- esta guía y la matriz documental relacionada

Se genera localmente y se reconstruye con bootstrap:

- `.claude/skills/`
- `.agents/skills/`
- `.windsurf/skills/`

Motivo:

- evita clobber manual entre agentes,
- reduce drift entre entornos,
- y permite que Claude Code, Codex, Copilot y Windsurf arranquen desde el mismo contrato sin versionar copias redundantes.

## Skills externas curadas

Usar `npx skills add vercel-labs/agent-skills --list` para ver la colección disponible al momento de configurar el proyecto.

Registrar las skills aprobadas en `scripts/agent-skills.manifest.json` con justificación de inclusión/exclusión según el stack del proyecto.

## Qué no se externaliza

Estas capacidades siguen gobernadas por skills internas del repo y **no** deben ser sustituidas por skills externas genéricas:

- `commit`
- `enrich-us`
- `openspec-*`
- `contexto-proyecto`
- `orquestacion-multiagente`

Motivo:

- ya están adaptadas al flujo `feature/* -> {{gitFlow.integrationBranch}} -> {{gitFlow.stableBranch}}`,
- respetan el esquema OpenSpec activo del proyecto,
- conocen el gate humano estricto,
- y usan el lenguaje operativo propio de `{{project.name}}`.

## Manifiesto y bootstrap

La configuración curada vive en:

- [scripts/agent-skills.manifest.json](../../scripts/agent-skills.manifest.json)
- [scripts/bootstrap-agent-skills.ps1](../../scripts/bootstrap-agent-skills.ps1)

El bootstrap hace dos cosas:

1. sincroniza skills internas desde `.github/skills/` a `.claude/skills/`, `.agents/skills/` y `.windsurf/skills/`
2. instala las skills externas curadas desde `vercel-labs/agent-skills` en esos mismos entornos

## Comandos útiles

```powershell
# Reinstalar / sincronizar todo
powershell -ExecutionPolicy Bypass -File scripts/bootstrap-agent-skills.ps1

# Solo resincronizar skills internas del repo
powershell -ExecutionPolicy Bypass -File scripts/bootstrap-agent-skills.ps1 -SkipExternalInstall

# Solo reinstalar skills externas curadas
powershell -ExecutionPolicy Bypass -File scripts/bootstrap-agent-skills.ps1 -SkipRepoGovernedSync
```

## Regla operativa

Cuando cambie una skill versionada en `.github/skills/`, se debe:

1. actualizar la skill fuente,
2. correr `scripts/bootstrap-agent-skills.ps1`,
3. validar que Claude, Codex, Copilot y Windsurf queden alineados,
4. documentar el cambio en `CHANGELOG.md` y en la matriz de tools externas si aplica.
