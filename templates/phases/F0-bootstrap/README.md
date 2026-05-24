# F0 — Bootstrap

## Intent

Ejecutar la fase F0 del SDLC bajo el contrato versionado en `phase-contract.yaml`.

## Checklist

- Confirmar owner y participantes declarados para F0.
- Verificar entradas requeridas antes de producir salidas.
- Registrar evidencia en `.github/agent-state/evidence/<slice>/F0.yaml` cuando aplique.
- Ejecutar `sdlc phase-gate --phase F0 --slice <slice> --target . --json`.
