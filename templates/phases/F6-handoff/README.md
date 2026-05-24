# F6 — Handoff

## Intent

Ejecutar la fase F6 del SDLC bajo el contrato versionado en `phase-contract.yaml`.

## Checklist

- Confirmar owner y participantes declarados para F6.
- Verificar entradas requeridas antes de producir salidas.
- Registrar evidencia en `.github/agent-state/evidence/<slice>/F6.yaml` cuando aplique.
- Ejecutar `sdlc phase-gate --phase F6 --slice <slice> --target . --json`.
