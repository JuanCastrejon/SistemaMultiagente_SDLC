# SistemaMultiagente_SDLC

AI-assisted SDLC framework con governance enterprise, SDD y enfoque brownfield-first.

> BMAD orquesta; SistemaMultiagente_SDLC orquesta y verifica.

## Status

- Current release line: `v1.1.0`
- Package publishing: deferred to `v1.2.0`
- CLI runtime: Node.js `>=18`
- Install policy: conservative, manifest-driven, no blind template walk
- License: MIT

## Local Install

Until the npm package is published in `v1.2.0`, install from a local checkout:

```bash
git clone https://github.com/JuanCastrejon/SistemaMultiagente_SDLC.git
cd SistemaMultiagente_SDLC
npm install
node ./bin/sdlc.js install --target ../mi-repo --mode greenfield --project-name "Mi Repo" --json
```

For legacy or migration projects:

```bash
node ./bin/sdlc.js install --target ../mi-repo --mode legacy --project-name "Mi Repo Legacy" --json
```

## CLI

```bash
node ./bin/sdlc.js install --target ../mi-repo --mode greenfield --project-name "Mi Repo" --json
node ./bin/sdlc.js doctor --target ../mi-repo --json
node ./bin/sdlc.js diff --target ../mi-repo --json
node ./bin/sdlc.js upgrade --target ../mi-repo --to-version 1.0.1 --json
node ./bin/sdlc.js rollback --target ../mi-repo --to <backup-id> --json
node ./bin/sdlc.js prune-backups --target ../mi-repo --keep 5 --json
```

## What v1.1.0 Includes

- Template engine with explicit `templates/manifest.yaml`.
- Logicless Mustache interpolation for governed templates.
- Core governance: `AGENTS.md`, `.github/AGENTS.md`, `CLAUDE.md`, `indice-operativo.md`.
- Core agent personas and skills.
- OpenSpec base profiles and greenfield/legacy schemas.
- Docs guides for SDD adoption, persistent memory, readiness and multi-environment skills.
- AJV config validation, dynamic migrations and validation guardrails.

## Roadmap

`v1.2.0` will add the operational/community release layer:

- npm publish and `npx sistema-multiagente-sdlc init`,
- comparison table versus BMAD-METHOD,
- real opt-in continuity scripts,
- C5 stack skills and C6 skill mirrors,
- expanded validators,
- robust CI/CD and regression install workflows.

## Guarantees

- Does not overwrite file-level conflicts without human decision.
- Creates backups before mutating commands.
- Writes `.sdlc/install-manifest.json` and `.sdlc/install-manifest.sha256`.
- Supports JSON output for CI use.
- Keeps external tools opt-in; Graphify, Obsidian, caveman and headroom are adapters, not hard requirements.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) and [SECURITY.md](SECURITY.md).
