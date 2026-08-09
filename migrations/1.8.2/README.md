# Migration 1.8.2

Cierre completo del plan P1→P14 del ADR 0007 (gauntlet de calidad verificable): adapters reales, guard de frontera autoprotegido, scripts anclados por hash, detector de evidence-mismatch, firma humana por signed-attestation, superficies generadas desde config, herencia de gates en F14, baseline no envenenable, `sc_id` estable, prueba de rojo con crédito real, cierre de change por hechos, los 8 `VERDICT_STEPS` reales, `sdlc adopt` y documentación generada desde el contrato.

- Recalcula `frameworkVersion` a `1.8.2`.
- Registra marcador local `.sdlc/migrations/1.8.2-applied.txt`.
- No hay cambios destructivos: `config.surfaces[].tier/moneyPath/hasUi` y `config.governance` son opcionales y aditivos; `quality-contract.yaml` se regenera desde `config.surfaces` en el próximo `sdlc upgrade`.
