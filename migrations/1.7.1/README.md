# Migration 1.7.1

Fix release: mirrors de skills descubribles por Codex, contratos rotos de gobernanza (`phase-contract.yaml` F16, `validate-enhanced-research`), version desincronizada.

- Recalcula `frameworkVersion` a `1.7.1`.
- Registra marcador local `.sdlc/migrations/1.7.1-applied.txt`.
- `sdlc upgrade` regenera los archivos gobernados, incluidos los mirrors de skills en el nuevo formato compatible con Codex. Mirrors editados a mano se reportan como conflicto en vez de sobrescribirse.
