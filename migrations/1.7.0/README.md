# Migration 1.7.0

Registra la version 1.7.0 (Governance Engineering harness) que se publico sin entrada en el registro de migraciones, dejando `sdlc upgrade` sin destino valido.

- Recalcula `frameworkVersion` a `1.7.0`.
- Registra marcador local `.sdlc/migrations/1.7.0-applied.txt`.
- Los archivos gobernados se regeneran desde templates durante `sdlc upgrade`; esto incluye los mirrors de skills, que pasan al formato compatible con Codex (frontmatter real primero, metadata de gestion como comentarios HTML al final).
- Si un consumidor edito a mano un mirror, `sdlc upgrade` lo reporta como conflicto y escribe patch plan; no sobrescribe en silencio.
