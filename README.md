# SistemaMultiagente_SDLC

Framework SDLC asistido por IA con governance enterprise, SDD y enfoque brownfield-first.

> BMAD orquesta; SistemaMultiagente_SDLC orquesta y verifica.

## Por qué

Este proyecto instala un SDLC multi-agente gobernado en repos greenfield o legacy. Combina personas de agente reutilizables, flujos OpenSpec/SDD, phase gates, migraciones, validadores, rollback y memoria persistente opcional.

El modelo operativo es SDD waterfall por slice y ágil por release: cada slice tiene gates explícitos de requisitos, readiness, diseño, implementación, verificación y archivo, mientras los releases permanecen iterativos.

## Inicio rápido

Flujo con paquete publicado (>=1.2.1):

```powershell
# Desde la raíz del repo destino (cwd = repo).
# --target es opcional desde v1.2.1: si se omite, se usa el directorio actual.
npx sistema-multiagente-sdlc init --mode greenfield --project-name "Mi Proyecto"

# Smoke previo sin escribir nada:
npx sistema-multiagente-sdlc init --mode greenfield --project-name "Mi Proyecto" --dry-run --json
```

Para v1.2.0 (compatibilidad), el comando equivalente requería `--target` explícito:

```powershell
npx sistema-multiagente-sdlc@1.2.0 init --target . --mode greenfield --project-name "Mi Proyecto"
```

Flujo de desarrollo local:

```powershell
git clone https://github.com/JuanCastrejon/SistemaMultiagente_SDLC.git
cd SistemaMultiagente_SDLC
corepack prepare pnpm@11.3.0 --activate
pnpm install --frozen-lockfile
pnpm run validate
pnpm test
node ./bin/sdlc.js install --target ../mi-proyecto --mode greenfield --project-name "Mi Proyecto"
```

Legacy/brownfield:

```powershell
node ./bin/sdlc.js install --target ../proyecto-legacy --mode legacy --project-name "Proyecto Legacy"
node ./bin/sdlc.js doctor --target ../proyecto-legacy --json
```

## Runtime Multiagente

Desde `1.4.0`, `sdlc` incluye comandos ejecutables para continuidad cross-IDE. El runtime primario es Node; los wrappers PowerShell solo existen para ergonomía Windows.

```powershell
sdlc session-start --target . --json
sdlc resume --target . --markdown
sdlc save --target . --event manual --json
sdlc continua --target . --platform codex --json
sdlc memory-sync --target . --mode health --json
sdlc validate-runtime --target . --json
sdlc hooks install --target . --post-merge-checkpoint --json
```

Reglas base:

- `session-start` crea `.sdlc/session.json` con healthcheck de Headroom, CodeGraph, Graphify, caveman, vault y slice actual.
- `resume` es solo lectura y recompone contexto en orden repo → CodeGraph → Graphify → vault.
- `save` escribe checkpoints locales en el vault; no promueve GitHub Issues, OpenSpec ni PRs sin gate humano.
- `hooks install --post-merge-checkpoint` instala un hook local `post-merge` que ejecuta `sdlc save --event post-merge`.
- `memory-sync --mode nightly --apply` importa chats y exporta Graphify al vault; no crea checkpoints automáticos.

## Harness Ejecutable F0-F17

Desde `1.5.0`, el flujo F0-F17 tiene contrato ejecutable y evidencia por fase.

```powershell
sdlc phase-gate --target . --phase F5 --slice <slice> --json
sdlc governance-check --target . --json
sdlc tools-doctor --target . --profile full --json
sdlc pr-body-check --repo . --pr <number> --json
```

Reglas base:

- `phase-contract.yaml` declara owner, participantes, entradas, salidas, gate humano y siguiente fase.
- `.github/agent-state/evidence/<slice>/<phase>.yaml` registra evidencia trazable cuando la fase lo exige.
- `governance-check` compara el bloque `SDLC_SHARED_RULES` entre IDEs y valida mirrors de skills.
- `tools-doctor --profile full` reporta el stack de harness completo: OpenSpec, Graphify, CodeGraph, Obsidian, Headroom, Caveman, autoskills, Vercel skills, party-mode y pnpm.

## Governance Engineering — Enforcement Duro (1.7.0)

Desde `1.7.0`, el engine expone primitivas para convertir gobernanza advisory en enforcement duro (ADR-0006). Ver arquitectura completa en ADR-024/ADR-025 del repo consumidor.

### Veredicto ordenado + status go/no-go

```powershell
# Veredicto READY/NOT-READY (fail-fast sobre validators del consumidor)
sdlc verdict --target . --json
sdlc verdict --target . --write --slice <slice> --phase <F> --json

# Snapshot go/no-go (governance + tools + phase-gate)
sdlc status --target . --markdown --write
sdlc status --target . --exit-code   # CI hard-block si no-go
```

- `verdict`: corre los scripts `validate:*` del consumidor en orden fail-fast; clasifica cada uno como BLOCKING/WARNING; emite un único `{verdict: "READY"|"NOT-READY"}` con exit 0/2.
- `status`: agrega `governance-check` + `tools-doctor` + `phase-gate` en un snapshot Markdown. Con `--exit-code` devuelve exit no-cero cuando cualquier componente está en error/blocked.
- `phase-gate --exit-code`: hard-block cuando la fase del slice activo está "blocked" (sin el flag, modo informativo — exit 0).

### Skills vivas — eval + propuesta gated

```powershell
# Score del canónico contra golden tasks en .github/skills/<skill>/evals/*.yaml
sdlc skill-eval --target . --skill enrich-us --json

# Propuesta de edición (solo escribe bajo openspec/changes/<change>/)
sdlc skill-propose --target . --skill enrich-us --change <change> --intent "descripción"
```

- `skill-eval`: carga golden tasks YAML del consumidor; scoring determinístico (presencia de campos); emite score numérico por task y global.
- `skill-propose`: genera `proposed-skill-diff.md` + `skill-eval-report.yaml` solo bajo `openspec/changes/<change>/`; nunca muta `.github/skills/` directamente (el hook deny del consumidor lo bloquearía de todos modos).
- `schemas/skill-eval.schema.json`: schema JSON Schema draft-07 para sets de golden tasks.

### Flujo de gate humano completo

```text
sdlc verdict → READY/NOT-READY
sdlc status --markdown --write → status.md
Adjuntar status.md al bloque [validation] del Issue → gate humano F4/F13 firma contra el número
```

## Modos

| Modo | Cuándo usar | Qué agrega |
| --- | --- | --- |
| `greenfield` | repo nuevo o inicio limpio de producto | plantillas SDD greenfield y governance |
| `legacy` | repo existente, migración o modernización brownfield | plantillas de research obligatorio y gates de descubrimiento legacy |

## Agentes

| Plano | Personas |
| --- | --- |
| Control | `planificador-opus`, `orquestador-opus` |
| Producto/coordinación | `product-owner-agent`, `project-manager-agent` |
| Definición | `analista-requisitos`, `arquitecto-modular-clean`, `qa-test-architect-agent` |
| Especialista | `api-nestjs`, `web-admin`, `mobile-sync`, `ux-designer-agent`, `tech-writer-agent` |
| Gate | `qa-security-review` |

## Flujo de Fases

```mermaid
flowchart LR
  F0["F0 Bootstrap"] --> F1["F1 Requisitos"]
  F1 --> F2["F2 Revisión humana borrador"]
  F2 --> F3["F3 Issue local"]
  F3 --> F35["F3.5 Rama"]
  F35 --> F4["F4 Handoff readiness"]
  F4 --> F5["F5 Planificación SDD"]
  F5 --> F6["F6 Handoff planificador"]
  F6 --> F7["F7 Orquestación"]
  F7 --> F8["F8 Implementación"]
  F8 --> F9["F9 QA"]
  F9 --> F10["F10 Seguridad"]
  F10 --> F11["F11 Commit"]
  F11 --> F12["F12 PR"]
  F12 --> F13["F13 Gate humano"]
  F13 --> F14["F14 Merge"]
  F14 --> F15["F15 Verificación"]
  F15 --> F16["F16 Archivo"]
  F16 --> F17["F17 Docs + trazabilidad"]
```

## Validadores

`pnpm run validate` ejecuta los validadores del framework:

- schema de config
- sin rutas personales
- sanitización de plantillas
- sin contenido gestionado inline
- integridad del manifiesto
- sin scripts placeholder
- política de herramientas externas
- precedencia de governance
- consistencia del manifiesto de skills
- schema de persona de agente
- existencia de links en docs
- consistencia de OpenSpec
- existencia de referencias Mustache
- schema de modelos

## Herramientas Externas — Guía de Instalación para el Agente

Las herramientas externas son opt-in. El framework funciona sin ellas; al activarlas reducen reconstrucción de contexto, mejoran trazabilidad y ahorran tokens de forma significativa. Esta sección está dirigida al **agente que trabaja en el repo consumidor** para que pueda guiar al desarrollador correctamente.

Ver detalles completos en `templates/docs/agents/external-tools-matrix.md`.

| Herramienta | Requerida | Propósito |
| --- | --- | --- |
| OpenSpec | sí | SDD: specs, changes y archivo |
| gh CLI | sí para GitHub | issues, PRs y releases |
| headroom | no | proxy de contexto + ahorro de tokens en llamadas Anthropic |
| Graphify | no | grafo semántico de docs para exploración cross-módulo |
| CodeGraph | no | grafo estructural AST para navegación de código |
| Obsidian | no | vault local para checkpoints y continuidad multi-sesión |
| caveman | no | compresión de tokens en comunicación operativa |
| autoskills | no | discovery de skills externas curadas |
| vercel-labs/agent-skills | no | skills UI/deploy opcionales |

### headroom (proxy de contexto)

headroom actúa como proxy entre el agente y la API de Anthropic. Comprime payloads, aplica presupuestos de contexto y reduce costos en sesiones largas.

**Instalación:**

```powershell
npm install -g headroom
# o con npx sin instalar globalmente
npx headroom proxy --no-telemetry
```

**Configuración en Claude Code** (`~/.claude/settings.json`):

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:8787"
  }
}
```

**Arranque del proxy** (script incluido en `templates/scripts/`):

```powershell
pwsh -NonInteractive -File scripts/headroom-start.ps1
```

**Autoarranque en Windows** (una sola vez por máquina — acción del usuario, no automatizable por el agente):

```powershell
pwsh -ExecutionPolicy Bypass -File scripts/register-headroom-task.ps1
Get-ScheduledTask -TaskName "<ProjectSlug>-Headroom-Autostart"
```

Sin esta tarea registrada, Codex y VS Code/Copilot no arrancan headroom automáticamente; Claude Code sí (via hook SessionStart en `~/.claude/settings.json`).

**Regla crítica:** si el proxy falla tras los reintentos, **no limpiar `ANTHROPIC_BASE_URL`**. Eso causaría que el agente llame directamente a Anthropic sin que el usuario lo sepa. El script registra el fallo en `%APPDATA%\headroom\health-last-fail.txt` y termina con `exit 1` para que el error sea visible.

### Graphify (grafo semántico de documentación)

Graphify indexa `docs/`, `openspec/`, `.github/agents/`, `.github/skills/` y raíz como knowledge graph semántico. **No indexa código de producto** (`apps/`, `packages/`).

```powershell
pip install --user graphifyy
graphify update .                    # re-extracción AST local, sin costo LLM
graphify query "<tema>"              # búsqueda semántica
graphify path "<A>" "<B>"           # relaciones entre nodos
graphify explain "<nodo>"           # descripción expandida
```

Cuándo usar: onboarding al proyecto, análisis de arquitectura cross-módulo, research de prior art en paso 4.5 de `enrich-us`. **No usar en loops normales de implementación.**

### CodeGraph (grafo estructural de código)

CodeGraph construye un índice AST de todo el código de producto. Responde preguntas estructurales sub-milisegundo sin grep.

```powershell
codegraph init -i                    # construir índice
codegraph status                     # verificar salud
```

Cuándo usar: "¿dónde está definida X?", "¿qué llama a Y?", "¿qué rompería si cambio Z?", firma de un símbolo, navegación cross-module en `apps/` y `packages/`. **No usar para docs ni semántica.**

### Regla de ahorro de tokens: CodeGraph vs Graphify vs Grep

Esta regla es crítica. Violarla duplica contexto y eleva costos 3x–8x en sesiones largas.

| Pregunta | Herramienta correcta |
|---|---|
| Estructura de código (callers, callees, impacto, firma) | CodeGraph — siempre primero, sin fallback a grep |
| Semántica cross-doc (docs, ADRs, specs, guides, agents) | Graphify si el grafo existe, sino docs raw |
| Texto literal (strings de log, comentarios, contenido sin estructura) | Grep — solo si no aplican los anteriores |

**Nunca ejecutar CodeGraph y Graphify para la misma consulta.** Son capas distintas con distinto scope.

### caveman (compresión de tokens en conversación)

caveman comprime solo los tokens de **output** del agente, no el razonamiento ni los payloads MCP. Útil para coordinación operativa entre agentes.

```text
/caveman lite    → modo conversacional comprimido (sin artículos, fragmentos OK)
/caveman full    → máxima compresión (solo para coordinación interna)
```

Regla: caveman **solo en conversación operativa**. Off en documentación, commits, PRs y artefactos finales. Las decisiones durables van a OpenSpec, docs o `.github/agent-state/`.

**party-mode** solo en fases F2 (Análisis), F3 (Diseño) y F4 (Validación). El costo multiagente (3x–8x tokens) solo se justifica en decisiones de diseño con trade-offs reales.

### Skills multi-entorno (bootstrap)

Después de instalar el framework, sincronizar las skills a todos los agentes:

```powershell
pwsh -ExecutionPolicy Bypass -File scripts/bootstrap-agent-skills.ps1
```

Esto copia las skills gobernadas desde `.github/skills/` a `.claude/skills/`, `.agents/skills/` y `.windsurf/skills/`. Si el manifiesto tiene entradas `crossMirrorSkills`, también copia skills entre carpetas de agente (por ejemplo, caveman ecosystem a Claude Code).

Verificar con:

```powershell
pwsh -ExecutionPolicy Bypass -File scripts/bootstrap-agent-skills.ps1 -Json
sdlc tools-doctor --target . --profile full --json
```

## Comparativa BMAD

Comparativa lado a lado de los dos frameworks. La intención no es competir sino aclarar dónde se solapan y dónde cada uno se especializa. Datos de BMAD tomados de su README oficial v6 (`bmad-code-org/BMAD-METHOD`, npm `bmad-method`).

| Característica | BMAD-METHOD v6 | SistemaMultiagente_SDLC v1.7.0 |
| --- | --- | --- |
| Licencia | MIT | MIT |
| Runtime requisitos | Node ≥20.12, Python ≥3.10, `uv` | Node ≥22.13, PowerShell (pwsh/powershell), Git |
| Comando de instalación | `npx bmad-method install` (interactivo) o `--yes --modules --tools` (CI) | `npx sistema-multiagente-sdlc init` (cwd default desde v1.2.1) |
| Scope principal | Desarrollo ágil asistido por IA | SDLC asistido por IA con governance enterprise y SDD |
| Flujos de trabajo | 34+ flujos ágiles (BMM core) | SDD waterfall por slice + ágil por release (fases F0-F17) |
| Scale-adaptive | sí, automático (bug → enterprise) | scale hint activo desde v1.3.0 |
| Agentes/personas | 12+ personas (PM, Arquitecto, Dev, UX, …) | 8 personas activas + roadmap extensible |
| Modo party / colaboración | sí (múltiples personas en sesión) | roundtable opt-in planificado v1.3.0 |
| CLI de ayuda / coach de siguiente paso | skill `bmad-help` | `sdlc doctor` (verificaciones de estado); `sdlc next` planificado v1.3.0 |
| Módulos / ecosistema | BMM (core) + BMB (builder) + TEA (test architect) + BMGD (game dev) + CIS (creative) | basado en modos (`greenfield` / `legacy`) + packs extensibles planificados v2.0.0 |
| Arquitectura de skills | sí (V6 + Sub-Agent inclusion + Cross-Platform Agent Team) | mirroring de skills a `.claude/`, `.agents/`, `.windsurf/` (`bootstrap-agent-skills.ps1`) con soporte `crossMirrorSkills` |
| Constructor de agentes/flujos personalizados | BMad Builder v1 | personas `.agent.md` + validadores (`validate-agent-persona-schema`) |
| Automatización del loop de desarrollo | en roadmap V6 | `phase-graph.yaml` + rework label-driven + lock TTL |
| Brownfield-first | no | sí (modo legacy con research obligatorio antes de proposal) |
| Validadores de governance | no es core | 14 validadores (config, personal-paths, template-sanitization, manifest-integrity, governance-precedence, …) |
| OpenSpec / SDD | no es core | integrado (capacidades canónicas en `openspec/specs/`) |
| Readiness L1/L2/L3 + matriz NFR | no es core | integrado (spec `business-production-readiness`) |
| Sistema de migración + rollback | no es core | backup automático + `sdlc upgrade --to-version` + `sdlc rollback --to <id>` |
| Lock multi-agente | no es core | TTL `platform-context.json` lock |
| Sanitización de paths/plantillas | no es core | `validate:no-personal-paths` + `validate:template-sanitization` |
| Provenance (SLSA) | n/d explícito | sí, SLSA v1 + firmas vía OIDC GitHub (workflow `publish.yml`) |
| Comunidad | Discord abierto, YouTube, X | GitHub Issues + Discussions (Discord no necesario) |
| Marca registrada | BMad / BMAD-METHOD trademarks of BMad Code, LLC | sin restricción explícita más allá de MIT |

Lectura corta: BMAD lidera en amplitud ágil y comunidad (12+ personas, 34+ flujos, 5 módulos, Discord activo, Skills Architecture V6). SistemaMultiagente_SDLC lidera en governance + brownfield + SDD + validadores (14) + sistema de migración + readiness L1/L2/L3 + sanitización. Ambos pueden coexistir: BMAD orquesta; SistemaMultiagente_SDLC orquesta **y verifica**.

## Roadmap

v1.3.0:

- paridad bash para scripts críticos
- `sdlc next`
- scale adaptativo: bug, feature, epic, platform
- extensiones de calibración
- roundtable opt-in
- sitio de documentación
- matriz de instalación de regresión: agregar `macos-latest` (cobertura triple ubuntu + windows + macos)
- bump `actions/checkout@v5` + `actions/setup-node@v5` con `node-version: 24`; deadline GitHub: Node 20 deprecated jun 2026, removido sep 2026

v2.0.0:

- packs extensibles
- API de plugins
- registro marketplace
- internacionalización en inglés
- ayuda contextual interactiva

## Contribución

Leer `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` y `SECURITY.md`.

## Licencia

MIT.
