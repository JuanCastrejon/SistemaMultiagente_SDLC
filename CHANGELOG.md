# Changelog

## [1.2.0] — Unreleased

### Phase 1 — Versionado y migraciones

- Prepara metadata npm publica para `sistema-multiagente-sdlc`.
- Actualiza `frameworkVersion` a `1.2.0`.
- Reserva `scale` en config (`bug`, `feature`, `epic`, `platform`) para adaptive scale de v1.3.0.
- Agrega targets de migracion `1.1.0` y `1.2.0` para cubrir upgrades `1.0.0 -> 1.2.0` y `1.1.0 -> 1.2.0`.

### Phase 2 — Scripts operativos

- Reemplaza stubs por 12 scripts sanitizados en `templates/scripts/`.
- Agrega politica opt-in: `publish-trace` y scheduler requieren `-Apply`; sync externo requiere flags explicitos.
- Instala `agent-skills.manifest.json`, `models.yaml` routing-only y config ejemplo de memoria Obsidian.
- Amplia regresion con pruebas golden para `continua`, `publish-trace`, `register-claude-sync-task`, `compute-calibration` y `bootstrap-agent-skills`.

### Phase 3 — C5/C6 skills

- Agrega stack-skills canonicas `backend-audit` y `ui-ux-diseno` bajo `.github/skills`.
- Agrega scaffolds de mirrors `.claude/skills`, `.agents/skills` y `.windsurf/skills`.
- Extiende `stack` con `database` y `designSystem` para las nuevas skills parametrizadas.

## [1.1.0] — 2026-05-18

### Fase A — Template engine

- Externaliza contenido inline a `templates/` con manifest selectivo (`templates/manifest.yaml`).
- Motor logicless Mustache (`interpolate()`); placeholders `{{project.name}}`, `{{project.slug}}`, `{{mode}}`, `{{stack.*}}`, `{{gitFlow.*}}`, `{{obsidian.*}}`, `{{surfaces.*}}`.
- Ningún template usa extensión `.mustache`; todos los archivos se interpolan al instalar.

### Fase H — AJV schema-driven config validation

- Validador de config basado en AJV; `config-schema.json` governa el contrato de entrada.
- `validate:config-schema` corre antes de cualquier `install/upgrade`.

### Fase E — Sistema de migraciones dinámico

- `migrations/` con migraciones versionadas; `upgrade` y `rollback` con backup automático.
- `doctor` detecta drift entre versión instalada y versión del framework.

### Fase B — Extraction manifest

- `docs/extraction/v1.0.0/extraction-manifest.yaml`: catálogo auditado de 75 entries (C1–C9 activos + C5–C6 diferidos + exclusiones).
- Bloquea walk ciego de `templates/`; solo entradas explícitas en manifest se instalan.

### Fase C — Template extraction (C1→C9)

**C1 — Governance:**
- `templates/AGENTS.md`, `templates/.github/AGENTS.md`, `templates/CLAUDE.md`, `templates/indice-operativo.md`.

**C2 — Agent personas (7 activos):**
- `planificador-opus`, `orquestador-opus`, `analista-requisitos` (legacy), `arquitecto`, `api-agent`, `web-agent`, `qa-security-review`.
- Sanitizados: domain-specific refs (DIAN, FacturacionDian, Samcol) eliminadas; stack refs parametrizadas con `{{stack.backend}}`/`{{stack.frontend}}`.

**C3 — Copilot instructions:**
- `copilot-instructions-greenfield.md` (mode: greenfield), `copilot-instructions-legacy.md` (mode: legacy).
- Ambos apuntan al mismo target `.github/copilot-instructions.md` según mode activo.

**C4 — Core skills (18 archivos, 19 entries en extraction-manifest):**
- `contexto-proyecto` (claude + github), `orquestacion-multiagente`, `enrich-us` (claude + github), `commit` (claude + github).
- OpenSpec skills: `propose`, `explore`, `apply`, `archive`, `verify`, `sync`, `ff`, `new`, `continue`.
- `documentacion-viva`, `operacion-cli-devops`.

**C7 — OpenSpec schemas:**
- `legacy-brownfield-sdd/`: `schema.yaml` + 5 templates (research, proposal, specs, design, tasks). Mode: legacy.
- `greenfield-sdd/`: `schema.yaml` + 4 templates (proposal, specs, design, tasks). Mode: greenfield. New, no donor.
- Profiles: `minimal.yaml`, `expanded.yaml`.
- Scaffolds: `openspec/specs/.gitkeep`, `openspec/changes/.gitkeep`, `openspec/specs/business-production-readiness/README.md`.
- Config mode-specific: `openspec/config-greenfield.yaml`, `openspec/config-legacy.yaml`.

**C9 — Docs guides:**
- `adopcion_openspec_sdd.md`, `business-production-readiness.md`, `memoria-persistente-multiagente.md`, `skills-multi-entorno.md`.
- Sanitizados: paths específicos → `{{obsidian.memoryWorkspace}}`, `{{project.slug}}`; ejemplos domain-specific → genéricos.

### Diferidos → v1.2.0

- **C5** Stack skills (11): nestjs, nextjs, react, prisma, turborepo, vitest, playwright, tailwind, vercel, accessibility, bash-defensive-patterns.
- **C6** Skill mirrors (3): `.agents/skills/`, `.windsurf/skills/`, `.cursorrules`.

---

## [1.0.0] — 2026-05-11

Lanzamiento inicial del framework reusable extraído de `FacturacionDian` (commit `f1e7acafe7`).

- CLI `sdlc install/upgrade/rollback/doctor/diff/prune-backups`.
- Template engine con manifest selectivo.
- AJV config validation.
- Migration system con backup automático.
- Extraction manifest v1.0.0 con catálogo completo de 75 entries.
