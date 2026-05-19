# Agents

This folder materializes the versioned SDLC agent layer for `{{project.name}}`.

## Planes

- Control plane: `planificador-opus`, `orquestador-opus`.
- Specialist plane: `analista-requisitos`, `arquitecto-modular-clean`, `api-nestjs`, `web-admin`, `mobile-sync`, `qa-security-review`.

## Context Order

1. Versioned repo state: `openspec/`, `docs/`, `.github/`, `AGENTS.md`, `indice-operativo.md`.
2. `graphify-out/` if available.
3. Optional memory vault configured in `scripts/obsidian-memory.config.local.json`.
4. Raw code only when editing or when previous layers are insufficient.

## Human Gate

Local drafts must be reviewed before promotion to GitHub issues, OpenSpec changes or implementation.
