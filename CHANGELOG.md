# Changelog

## [Unreleased]

## [1.6.0] — 2026-05-26

### Added

- ADR `0005-tool-hierarchy-and-operational-profiles.md`: jerarquía de retrieval y perfiles `LEAN` / `ANALYSIS` / `ORCHESTRATION`.
- Guía `docs/guides/tool-hierarchy-and-profiles.md` y template instalable equivalente.
- Migración `1.6.0` con marcador `.sdlc/migrations/1.6.0-applied.txt`.
- Script template `scripts/validate-local-gate.ps1` para reproducir el control plane antes de push/PR.

### Changed

- `SDLC_SHARED_RULES` ahora incluye reglas 7-9 para jerarquía de retrieval, perfiles operativos y gate local pre-push/pre-PR.
- Skills `contexto-proyecto`, `enrich-us` y `party-mode` aplican selección de perfil y límites de herramienta.
- External tools matrix documenta perfil elegible y cuándo no usar cada herramienta.
- Workflows de GitHub Actions optan a Node 24 para evitar warnings de acciones JavaScript sobre Node 20.


## [1.5.0] — 2026-05-24

### Added

- Harness ejecutable F0-F17 con `phase-contract.yaml`, `schemas/phase-evidence.schema.json` y `templates/phases/F0...F17`.
- Comandos CLI nuevos: `sdlc phase-gate`, `sdlc governance-check`, `sdlc tools-doctor` y `sdlc pr-body-check`.
- Bloque `SDLC_SHARED_RULES` con hash para paridad entre `AGENTS.md`, `CLAUDE.md`, `.github/AGENTS.md` y `.github/copilot-instructions.md`.
- Roles upstream: `product-owner-agent`, `project-manager-agent`, `qa-test-architect-agent`, `tech-writer-agent` y `ux-designer-agent`.
- Skill `party-mode` anclada a F1/F2/F5 y separación entre QA temprana y `qa-security-review` para F9/F10.
- Perfil `full-harness` para reportar OpenSpec, Graphify, CodeGraph, Obsidian, Headroom, Caveman, autoskills, Vercel skills, party-mode y pnpm.
- Migración `1.5.0` con marcador `.sdlc/migrations/1.5.0-applied.txt`.

### Changed

- Migración del desarrollo y workflows del framework a `pnpm@11.3.0`.
- `resume` y `continua` incorporan lectura del contrato de fase y reportan bloqueos por evidencia faltante.
- `buildManagedFiles` genera mirrors cross-IDE desde `.github/skills/` para evitar drift entre Claude Code, Codex, Copilot y Windsurf.

### Tests

- Regresión extendida con smoke tests de `phase-gate`, `governance-check` y `tools-doctor`.


## [1.4.0] — 2026-05-24

### Added

- ADR `0004-codegraph-graphify-orden-canonico.md`: cierra la decisión pendiente de ADR 0002 y canoniza CodeGraph para estructura de código + Graphify para semántica documental/export Obsidian.
- Runtime Node multiagente como interfaz canónica: `sdlc session-start`, `resume`, `save`, `continua`, `memory-sync`, `validate-runtime` y `hooks install --post-merge-checkpoint`.
- `.sdlc/session.json` como estado generado de sesión para healthcheck y continuidad cross-IDE.
- Skills canónicas `resume`, `save` y `continua` bajo `.github/skills/` y mirrors para `.claude/`, `.agents/` y `.windsurf/`, todas apuntando al mismo CLI `sdlc`.
- `templates/scripts/continua.mjs` como implementación portable Node de continuidad; `continua.ps1` queda como wrapper Windows delgado.
- Migración `1.4.0` con marcador `.sdlc/migrations/1.4.0-applied.txt`.

### Changed

- `sdlc doctor` y el runner de regresión validan la versión `1.4.0`.
- El manifest de skills gobernadas incluye `resume`, `save` y `continua`.
- La continuidad multiagente deja de depender de PowerShell como runtime primario; PowerShell queda para compatibilidad en Windows.

### Tests

- Regresión extendida con smoke tests de `session-start`, `resume`, `save --no-mutate`, `continua`, `memory-sync --mode health`, `validate-runtime` y `hooks install`.

## [1.6.0] — 2026-05-26

### Added

- ADR `0005-tool-hierarchy-and-operational-profiles.md`: jerarquía de retrieval y perfiles `LEAN` / `ANALYSIS` / `ORCHESTRATION`.
- Guía `docs/guides/tool-hierarchy-and-profiles.md` y template instalable equivalente.
- Migración `1.6.0` con marcador `.sdlc/migrations/1.6.0-applied.txt`.
- Script template `scripts/validate-local-gate.ps1` para reproducir el control plane antes de push/PR.

### Changed

- `SDLC_SHARED_RULES` ahora incluye reglas 7-9 para jerarquía de retrieval, perfiles operativos y gate local pre-push/pre-PR.
- Skills `contexto-proyecto`, `enrich-us` y `party-mode` aplican selección de perfil y límites de herramienta.
- External tools matrix documenta perfil elegible y cuándo no usar cada herramienta.
- Workflows de GitHub Actions optan a Node 24 para evitar warnings de acciones JavaScript sobre Node 20.

## [1.5.0] — 2026-05-24

### Added

- Harness ejecutable F0-F17 con `phase-contract.yaml`, `schemas/phase-evidence.schema.json` y `templates/phases/F0...F17`.
- Comandos CLI nuevos: `sdlc phase-gate`, `sdlc governance-check`, `sdlc tools-doctor` y `sdlc pr-body-check`.
- Bloque `SDLC_SHARED_RULES` con hash para paridad entre `AGENTS.md`, `CLAUDE.md`, `.github/AGENTS.md` y `.github/copilot-instructions.md`.
- Roles upstream: `product-owner-agent`, `project-manager-agent`, `qa-test-architect-agent`, `tech-writer-agent` y `ux-designer-agent`.
- Skill `party-mode` anclada a F2/F3/F4 y separación entre QA temprana y `qa-security-review` para F9/F10.
- Perfil `full-harness` para reportar OpenSpec, Graphify, CodeGraph, Obsidian, Headroom, Caveman, autoskills, Vercel skills, party-mode y pnpm.
- Migración `1.5.0` con marcador `.sdlc/migrations/1.5.0-applied.txt`.

### Changed

- Migración del desarrollo y workflows del framework a `pnpm@11.3.0`.
- `resume` y `continua` incorporan lectura del contrato de fase y reportan bloqueos por evidencia faltante.
- `buildManagedFiles` genera mirrors cross-IDE desde `.github/skills/` para evitar drift entre Claude Code, Codex, Copilot y Windsurf.

### Tests

- Regresión extendida con smoke tests de `phase-gate`, `governance-check` y `tools-doctor`.

## [1.4.0] — 2026-05-24

### Added

- ADR `0004-codegraph-graphify-orden-canonico.md`: cierra la decisión pendiente de ADR 0002 y canoniza CodeGraph para estructura de código + Graphify para semántica documental/export Obsidian.
- Runtime Node multiagente como interfaz canónica: `sdlc session-start`, `resume`, `save`, `continua`, `memory-sync`, `validate-runtime` y `hooks install --post-merge-checkpoint`.
- `.sdlc/session.json` como estado generado de sesión para healthcheck y continuidad cross-IDE.
- Skills canónicas `resume`, `save` y `continua` bajo `.github/skills/` y mirrors para `.claude/`, `.agents/` y `.windsurf/`, todas apuntando al mismo CLI `sdlc`.
- `templates/scripts/continua.mjs` como implementación portable Node de continuidad; `continua.ps1` queda como wrapper Windows delgado.
- Migración `1.4.0` con marcador `.sdlc/migrations/1.4.0-applied.txt`.

### Changed

- `sdlc doctor` y el runner de regresión validan la versión `1.4.0`.
- El manifest de skills gobernadas incluye `resume`, `save` y `continua`.
- La continuidad multiagente deja de depender de PowerShell como runtime primario; PowerShell queda para compatibilidad en Windows.

### Tests

- Regresión extendida con smoke tests de `session-start`, `resume`, `save --no-mutate`, `continua`, `memory-sync --mode health`, `validate-runtime` y `hooks install`.

## [1.3.0] — 2026-05-23

### Added

- ADR `0002-codegraph-spike.md` (versión Propuesta inicial): aprobar evaluación de 7 días de [CodeGraph (colbymchenry)](https://github.com/colbymchenry/codegraph). Esta versión queda en el historial git; la versión vigente es la Aceptada del bloque "Changed" anterior.
- ADR `0003-per-phase-model-assignment.md`: extender `templates/scripts/models.yaml` con bloque opcional `phases:` para asignar modelos distintos a fases SDD (`sdd-explore`, `sdd-design`, `sdd-implement`, `sdd-review` o F0-F17). Reduce costo en exploración manteniendo precisión en F2-F3. Inspirado por el patrón `--profile-phase` de `gentle-ai`.
- `templates/scripts/models.yaml`: bloque `phases:` opt-in con defaults documentados (Haiku para `sdd-explore`, Opus para `sdd-design`, Sonnet para `sdd-implement`/`sdd-review`).
- Skill `edge-case-hunter`: checklist portable para revisar entradas límite, concurrencia, fallos parciales, dependencias, autorización y volumen antes de implementación.
- `analista-requisitos.agent.md`: protocolo de elicitación avanzada para historias ambiguas antes de pasar a diseño.

### Changed

- ADR `0002-codegraph-spike.md` cambia de estado **Propuesta → Aceptada**. Se reemplaza la estrategia de "spike 7 días con benchmarks sintéticos obligatorios" por **"instalar y observar"**: la adopción es coexistencia con Graphify desde el día 1, sin slice dedicado, y la verificación del ahorro de tokens claimado por CodeGraph (94 % menos tool-calls según su README) se hará por observación natural durante varias sesiones reales. El ADR ahora documenta:
  - Reglas concretas de coexistencia (Graphify-first para razonamiento humano y `enrich-us` 4.5; CodeGraph vía MCP para queries estructurales runtime).
  - Triggers para abrir ADR 0004 (evidencia de ahorro real, cobertura de rutas framework, o costo operativo excesivo).
  - Implementación operativa ya ejecutada en `FacturacionDian` con scope narrow (`apps/**/src` + `packages/**/src`, `.ts/.tsx`) para evitar el OOM del index default sobre un monorepo grande.
  - Métricas del index inicial sobre `FacturacionDian`: 658 archivos, 7.954 nodes, 14.869 edges, 14.48 MB native SQLite.
- `scripts/validate-models-schema.mjs`: soporte para clave top-level `phases` opcional + verificación de shape `{ primary, fallback }` por fase. Bloque `phases:` declarado pero vacío produce error explícito.

### Docs

- README: actualizada tabla `BMAD Comparison` con realidad V6 de BMAD-METHOD (module ecosystem BMM/BMB/TEA/BMGD/CIS, Skills Architecture, Sub-Agent inclusion, scale-adaptive, Discord community) y comparación side-by-side honesta. Datos tomados del README oficial v6 de `bmad-code-org/BMAD-METHOD`.
- README Roadmap v1.3.0: agregadas entradas `macos-latest` para `regression-install` matrix y bump de `actions/checkout@v5` + `actions/setup-node@v5` con `node-version: 24` antes del deprecation deadline de GitHub (Node 20 deprecated jun 2026, removed sep 2026).

# Changelog

## [Unreleased]

## [1.6.0] — 2026-05-26

### Added

- ADR `0005-tool-hierarchy-and-operational-profiles.md`: jerarquía de retrieval y perfiles `LEAN` / `ANALYSIS` / `ORCHESTRATION`.
- Guía `docs/guides/tool-hierarchy-and-profiles.md` y template instalable equivalente.
- Migración `1.6.0` con marcador `.sdlc/migrations/1.6.0-applied.txt`.
- Script template `scripts/validate-local-gate.ps1` para reproducir el control plane antes de push/PR.

### Changed

- `SDLC_SHARED_RULES` ahora incluye reglas 7-9 para jerarquía de retrieval, perfiles operativos y gate local pre-push/pre-PR.
- Skills `contexto-proyecto`, `enrich-us` y `party-mode` aplican selección de perfil y límites de herramienta.
- External tools matrix documenta perfil elegible y cuándo no usar cada herramienta.
- Workflows de GitHub Actions optan a Node 24 para evitar warnings de acciones JavaScript sobre Node 20.

## [1.5.0] — 2026-05-24

### Added

- Harness ejecutable F0-F17 con `phase-contract.yaml`, `schemas/phase-evidence.schema.json` y `templates/phases/F0...F17`.
- Comandos CLI nuevos: `sdlc phase-gate`, `sdlc governance-check`, `sdlc tools-doctor` y `sdlc pr-body-check`.
- Bloque `SDLC_SHARED_RULES` con hash para paridad entre `AGENTS.md`, `CLAUDE.md`, `.github/AGENTS.md` y `.github/copilot-instructions.md`.
- Roles upstream: `product-owner-agent`, `project-manager-agent`, `qa-test-architect-agent`, `tech-writer-agent` y `ux-designer-agent`.
- Skill `party-mode` anclada a fases relevantes (F1–F5) y separación entre QA temprana y `qa-security-review` para F9/F10.
- Perfil `full-harness` para reportar OpenSpec, Graphify, CodeGraph, Obsidian, Headroom, Caveman, autoskills, Vercel skills, party-mode y pnpm.
- Migración `1.5.0` con marcador `.sdlc/migrations/1.5.0-applied.txt`.

### Changed

- Migración del desarrollo y workflows del framework a `pnpm@11.3.0`.
- `resume` y `continua` incorporan lectura del contrato de fase y reportan bloqueos por evidencia faltante.
- `buildManagedFiles` genera mirrors cross-IDE desde `.github/skills/` para evitar drift entre Claude Code, Codex, Copilot y Windsurf.

### Tests

- Regresión extendida con smoke tests de `phase-gate`, `governance-check` y `tools-doctor`.

## [1.4.0] — 2026-05-24

### Added

- ADR `0004-codegraph-graphify-orden-canonico.md`: cierra la decisión pendiente de ADR 0002 y canoniza CodeGraph para estructura de código + Graphify para semántica documental/export Obsidian.
- Runtime Node multiagente como interfaz canónica: `sdlc session-start`, `resume`, `save`, `continua`, `memory-sync`, `validate-runtime` y `hooks install --post-merge-checkpoint`.
- `.sdlc/session.json` como estado generado de sesión para healthcheck y continuidad cross-IDE.
- Skills canónicas `resume`, `save` y `continua` bajo `.github/skills/` y mirrors para `.claude/`, `.agents/` y `.windsurf/`, todas apuntando al mismo CLI `sdlc`.
- `templates/scripts/continua.mjs` como implementación portable Node de continuidad; `continua.ps1` queda como wrapper Windows delgado.
- Migración `1.4.0` con marcador `.sdlc/migrations/1.4.0-applied.txt`.

### Changed

- `sdlc doctor` y el runner de regresión validan la versión `1.4.0`.
- El manifest de skills gobernadas incluye `resume`, `save` y `continua`.
- La continuidad multiagente deja de depender de PowerShell como runtime primario; PowerShell queda para compatibilidad en Windows.

### Tests

- Regresión extendida con smoke tests de `session-start`, `resume`, `save --no-mutate`, `continua`, `memory-sync --mode health`, `validate-runtime` y `hooks install`.

## [1.3.0] — 2026-05-23

### Added

- ADR `0002-codegraph-spike.md` (versión Propuesta inicial): aprobar evaluación de 7 días de [CodeGraph (colbymchenry)](https://github.com/colbymchenry/codegraph). Esta versión queda en el historial git; la versión vigente es la Aceptada del bloque "Changed" anterior.
- ADR `0003-per-phase-model-assignment.md`: extender `templates/scripts/models.yaml` con bloque opcional `phases:` para asignar modelos distintos a fases SDD (`sdd-explore`, `sdd-design`, `sdd-implement`, `sdd-review` o F0-F17). Reduce costo en exploración manteniendo precisión en F2-F3. Inspirado por el patrón `--profile-phase` de `gentle-ai`.
- `templates/scripts/models.yaml`: bloque `phases:` opt-in con defaults documentados (Haiku para `sdd-explore`, Opus para `sdd-design`, Sonnet para `sdlc-implement`/`sdlc-review`).
- Skill `edge-case-hunter`: checklist portable para revisar entradas límite, concurrencia, fallos parciales, dependencias, autorización y volumen antes de implementación.
- `analista-requisitos.agent.md`: protocolo de elicitación avanzada para historias ambiguas antes de pasar a diseño.

### Changed

- ADR `0002-codegraph-spike.md` cambia de estado **Propuesta → Aceptada**. Se reemplaza la estrategia de "spike 7 días con benchmarks sintéticos obligatorios" por **"instalar y observar"**: la adopción es coexistencia con Graphify desde el día 1, sin slice dedicado, y la verificación del ahorro de tokens claimado por CodeGraph se hará por observación natural durante varias sesiones reales.
- `scripts/validate-models-schema.mjs`: soporte para clave top-level `phases` opcional + verificación de shape `{ primary, fallback }` por fase. Bloque `phases:` declarado pero vacío produce error explícito.

### Docs

- README: actualizada tabla `BMAD Comparison` con realidad V6 de BMAD-METHOD y comparación side-by-side.

## [1.2.1] — 2026-05-18

### UX fix — `init` sin `--target` usa cwd

- `bin/sdlc.js` (`src/cli.js`): `requireTarget` deja de exigir `--target <repo>`. Cuando se omite, se usa `process.cwd()` como destino.
- El quickstart del README (`npx sistema-multiagente-sdlc init --dry-run`) ahora coincide con el comportamiento real del CLI; antes fallaba con `Falta --target <repo>`.
- Mensaje de `help` actualizado: `--target` queda marcado como opcional con default cwd.
- Regresión nueva en `tests/run-regression.mjs`: smoke test ejecuta `node bin/sdlc.js init --dry-run` desde un tmpdir con `cwd` distinto al repo y verifica que el dry-run no escriba archivos.

## [1.2.0] — 2026-05-17

### Phase 1 — Versionado y migraciones

- Prepara metadata npm publica para `sistema-multiagente-sdlc`.
- Actualiza `frameworkVersion` a `1.2.0`.
- Reserva `scale` en config (`bug`, `feature`, `epic`, `platform`) para adaptive scale de v1.3.0.
- Agrega targets de migracion `1.1.0` y `1.2.0` para cubrir upgrades `1.0.0 -> 1.2.0` y `1.1.0 -> 1.2.0`.

### Phase 2 — Scripts operativos

- Reemplaza stubs por 12 scripts sanitizados en `templates/scripts/`.
- Agrega politica opt-in: `publish-trace` y scheduler requieren `-Apply`; sync externo requiere flags explicitos.
- Instala `agent-skills.manifest.json`, `models.yaml` routing-only y config ejemplo de memoria Obsidian.

## [1.1.0] — 2026-05-18

### Fase A — Template engine

- Externaliza contenido inline a `templates/` con manifest selectivo (`templates/manifest.yaml`).
- Motor logicless Mustache (`interpolate()`); placeholders `{{project.name}}`, `{{project.slug}}`, `{{mode}}`, `{{stack.*}}`, `{{gitFlow.*}}`, `{{obsidian.*}}`, `{{surfaces.*}}`.

## [1.0.0] — 2026-05-11

Lanzamiento inicial del framework reusable extraído de `FacturacionDian` (commit `f1e7acafe7`).

- CLI `sdlc install/upgrade/rollback/doctor/diff/prune-backups`.
- Template engine con manifest selectivo.
- AJV config validation.
- Migration system con backup automático.
- Extraction manifest v1.0.0 con catálogo completo de 75 entries.

