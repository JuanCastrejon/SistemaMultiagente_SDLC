# F8 — Implementation

## Intent

Ejecutar la fase F8 del SDLC bajo el contrato versionado en `phase-contract.yaml`.

## Checklist

- Confirmar owner y participantes declarados para F8.
- Verificar entradas requeridas antes de producir salidas.
- Registrar evidencia en `.github/agent-state/evidence/<slice>/F8.yaml` cuando aplique.
- Ejecutar `sdlc phase-gate --phase F8 --slice <slice> --target . --json`.
