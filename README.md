# SistemaMultiagente_SDLC

AI-assisted SDLC framework con governance enterprise, SDD y enfoque brownfield-first.

> BMAD orquesta; SistemaMultiagente_SDLC orquesta y verifica.

## Why

This project installs a governed multi-agent SDLC into greenfield or legacy repos. It combines reusable agent personas, OpenSpec/SDD workflows, phase gates, migrations, validators, rollback and optional persistent memory.

The operating model is SDD waterfall by slice and agile by release: each slice has explicit requirements, readiness, design, implementation, verification and archive gates, while releases can stay iterative.

## Quick Start

Published package flow (>=1.2.1):

```powershell
# Desde la raíz del repo destino (cwd = repo).
# --target es opcional desde v1.2.1: si se omite, se usa el directorio actual.
npx sistema-multiagente-sdlc init --mode greenfield --project-name "My Project"

# Smoke previo sin escribir nada:
npx sistema-multiagente-sdlc init --mode greenfield --project-name "My Project" --dry-run --json
```

Para v1.2.0 (compatibilidad), el comando equivalente requería `--target` explícito:

```powershell
npx sistema-multiagente-sdlc@1.2.0 init --target . --mode greenfield --project-name "My Project"
```

Local development flow:

```powershell
git clone https://github.com/JuanCastrejon/SistemaMultiagente_SDLC.git
cd SistemaMultiagente_SDLC
npm install
npm run validate
npm test
node ./bin/sdlc.js install --target ../my-project --mode greenfield --project-name "My Project"
```

Legacy/brownfield:

```powershell
node ./bin/sdlc.js install --target ../legacy-project --mode legacy --project-name "Legacy Project"
node ./bin/sdlc.js doctor --target ../legacy-project --json
```

## Modes

| Mode | Use when | Adds |
| --- | --- | --- |
| `greenfield` | new repo or clean product start | greenfield SDD templates and governance |
| `legacy` | existing repo, migration or brownfield modernization | mandatory research templates and legacy discovery gates |

## Agents

| Plane | Personas |
| --- | --- |
| Control | `planificador-opus`, `orquestador-opus` |
| Definition | `analista-requisitos`, `arquitecto-modular-clean` |
| Specialist | `api-nestjs`, `web-admin`, `mobile-sync` |
| Gate | `qa-security-review` |

## Phase Flow

```mermaid
flowchart LR
  F0["F0 Bootstrap"] --> F1["F1 Requirements"]
  F1 --> F2["F2 Human draft review"]
  F2 --> F3["F3 Local issue"]
  F3 --> F35["F3.5 Branch"]
  F35 --> F4["F4 Readiness handoff"]
  F4 --> F5["F5 SDD planning"]
  F5 --> F6["F6 Planner handoff"]
  F6 --> F7["F7 Orchestration"]
  F7 --> F8["F8 Implementation"]
  F8 --> F9["F9 QA"]
  F9 --> F10["F10 Security"]
  F10 --> F11["F11 Commit"]
  F11 --> F12["F12 PR"]
  F12 --> F13["F13 Human gate"]
  F13 --> F14["F14 Merge"]
  F14 --> F15["F15 Verify"]
  F15 --> F16["F16 Archive"]
  F16 --> F17["F17 Docs + trace"]
```

## Validators

`npm run validate` runs 14 validators:

- config schema
- no personal paths
- template sanitization
- no inline managed content
- manifest integrity
- no placeholder scripts
- external tools policy
- governance precedence
- skill manifest consistency
- agent persona schema
- docs links exist
- OpenSpec consistency
- Mustache references exist
- models schema

## Optional External Tools

See `templates/docs/agents/external-tools-matrix.md` for setup details.

| Tool | Required | Purpose |
| --- | --- | --- |
| OpenSpec | yes | SDD specs, changes and archive |
| Graphify | no | structural graph for fast orientation |
| Obsidian | no | local persistent memory vault |
| caveman | no | token-saving communication mode |
| gh CLI | yes for GitHub publish | issues, PRs and releases |

All external installs are opt-in. Scripts default to dry-run or local-only behavior unless `-Apply` or another explicit install flag is provided.

## BMAD Comparison

| Feature | BMAD-METHOD | SistemaMultiagente_SDLC |
| --- | --- | --- |
| AI-driven agents | 12+ personas | 8 personas plus extensible roadmap |
| Workflows | agile | SDD waterfall by slice, agile by release |
| Scale-adaptive | yes | reserved for v1.3.0 |
| Party mode | yes | roundtable opt-in planned for v1.3.0 |
| Help CLI | bmad-help | `sdlc next` planned for v1.3.0 |
| Modules/packs | yes | packs marketplace planned for v2.0.0 |
| Governance validators | not core | 14 validators |
| OpenSpec/SDD | not core | integrated |
| Readiness L1/L2/L3 | not core | integrated |
| Multi-agent lock | not core | TTL platform-context lock |
| Brownfield-first | no | yes |
| Migration system | not core | backup and rollback |
| Sanitization validators | not core | no-personal-paths and template-sanitization |

## Roadmap

v1.3.0:

- bash parity for critical scripts
- `sdlc next`
- adaptive scale: bug, feature, epic, platform
- calibration extensions
- roundtable opt-in
- docs site

v2.0.0:

- extensible packs
- plugin API
- marketplace registry
- English i18n
- interactive contextual help

## Contributing

Read `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` and `SECURITY.md`.

## License

MIT.
