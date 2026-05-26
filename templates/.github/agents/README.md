# Agents

This folder materializes the versioned SDLC agent layer for `{{project.name}}`.

## Planes

- Control plane: `planificador-opus`, `orquestador-opus`.
- Product/coordination plane: `product-owner-agent`, `project-manager-agent`.
- Specialist plane: `analista-requisitos`, `arquitecto-modular-clean`, `api-nestjs`, `web-admin`, `mobile-sync`, `ux-designer-agent`, `tech-writer-agent`, `qa-test-architect-agent`, `qa-security-review`.

## Context Order

1. Versioned repo state: `openspec/`, `docs/`, `.github/`, `AGENTS.md`, `indice-operativo.md`.
2. `graphify-out/` if available.
3. Optional memory vault configured in `scripts/obsidian-memory.config.local.json`.
4. Raw code only when editing or when previous layers are insufficient.

## Human Gate

Local drafts must be reviewed before promotion to GitHub issues, OpenSpec changes or implementation.

## QA Split

- `qa-test-architect-agent` participates early in F1/F2/F5 to make requirements testable.
- `qa-security-review` owns F9/F10 execution and final review evidence.
