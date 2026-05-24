# F7 — Orchestration

## Intent

Ejecutar la fase F7 del SDLC bajo el contrato versionado en `phase-contract.yaml`.

## Checklist

- Confirmar owner y participantes declarados para F7.
- Verificar entradas requeridas antes de producir salidas.
- Registrar evidencia en `.github/agent-state/evidence/<slice>/F7.yaml` cuando aplique.
- Ejecutar `sdlc phase-gate --phase F7 --slice <slice> --target . --json`.
