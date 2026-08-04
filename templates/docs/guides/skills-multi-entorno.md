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
| Codex | `AGENTS.md` | `.agents/skills/` | Codex no consume `.github/skills/` como skill root nativo; `/continua`, `/resume` y `/save` se puentean a `npx --no-install sdlc ...` |
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

El bootstrap puede hacer dos cosas:

1. sincroniza skills internas desde `.github/skills/` a `.claude/skills/`, `.agents/skills/` y `.windsurf/skills/`
2. con `-InstallExternal`, instala las skills externas curadas; la descarga nunca es implícita

La lectura y escritura se realiza explícitamente en UTF-8 sin BOM para que Windows
PowerShell 5.1 y PowerShell 7 produzcan el mismo contenido, incluidos tildes y otros
caracteres no ASCII.

## Formato de mirror y discovery en Codex

Codex descubre cada skill leyendo el **primer bloque YAML** de `SKILL.md`. Por eso el mirror:

- conserva el frontmatter real de la skill (`name`, `description`) como primer bloque —
  si la skill canónica no lo trae, el bootstrap lo sintetiza a partir del nombre y la
  primera línea de prosa;
- escribe la metadata de gestión al final, como comentarios HTML
  (`sdlc-managed`, `sdlc-source`, `sdlc-source-sha256`, `sdlc-body-sha256`).

Anteponer la metadata en un bloque `managed: true` tapaba el frontmatter real y hacía que
Codex no descubriera la skill.

Se registran dos hashes distintos con propósitos distintos:

| Hash | Responde a |
|---|---|
| `sdlc-source-sha256` | ¿cambió la skill canónica en `.github/skills/`? |
| `sdlc-body-sha256` | ¿alguien editó este mirror a mano? |

Gracias a esa separación, el bootstrap re-sella un mirror intacto cuando cambia el
canónico, pero se detiene (`managed mirror has local drift`) si el mirror fue editado
localmente. `-Force` sobrescribe de todos modos.

## Comandos útiles

```powershell
# Sincronizar las skills internas (comportamiento predeterminado, sin descargas)
powershell -ExecutionPolicy Bypass -File scripts/bootstrap-agent-skills.ps1 -SkipExternalInstall

# Sincronizar internas e instalar las externas curadas (opt-in explícito)
powershell -ExecutionPolicy Bypass -File scripts/bootstrap-agent-skills.ps1 -InstallExternal

# Validar frontmatter, hashes y equivalencia UTF-8 de los tres mirrors
node scripts/validate-codex-skills.mjs
```

## Regla operativa

Cuando cambie una skill versionada en `.github/skills/`, se debe:

1. actualizar la skill fuente,
2. correr `scripts/bootstrap-agent-skills.ps1`,
3. ejecutar `node scripts/validate-codex-skills.mjs` para comprobar que los tres mirrors
   conservan frontmatter, hash y cuerpo UTF-8 equivalentes al canónico,
4. documentar el cambio en `CHANGELOG.md` y en la matriz de tools externas si aplica.

## Puente de comandos SDLC en Codex

En Claude Code, los slash commands se invocan directamente. En Codex, la invocación equivalente es:

| Intención | Comando Codex |
|---|---|
| `/continua` | `npx --no-install sdlc continua --target . --platform codex --json` |
| `/resume` | `npx --no-install sdlc resume --target . --markdown` |
| `/save` | `npx --no-install sdlc save --target . --event manual --json` |

El resultado de `/continua` es vinculante: si reporta gate humano o phase gate bloqueado,
Codex debe detener implementación y reportar owner, fase, faltantes y siguiente comando.
