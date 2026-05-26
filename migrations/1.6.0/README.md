# Migration 1.6.0

Actualiza el contrato instalado a la doctrina de jerarquia de retrieval y perfiles operativos.

- Recalcula `frameworkVersion` a `1.6.0`.
- Registra marcador local `.sdlc/migrations/1.6.0-applied.txt`.
- Los archivos gobernados se regeneran desde templates durante `sdlc upgrade`; no publica npm ni toca configs locales.
