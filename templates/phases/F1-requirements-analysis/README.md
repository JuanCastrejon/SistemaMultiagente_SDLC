# F1 — Requirements Analysis

## Intent

Ejecutar la fase F1 del SDLC bajo el contrato versionado en `phase-contract.yaml`.

## Checklist

- Confirmar owner y participantes declarados para F1.
- Verificar entradas requeridas antes de producir salidas.
- Registrar evidencia en `.github/agent-state/evidence/<slice>/F1.yaml` cuando aplique.
- Ejecutar `sdlc phase-gate --phase F1 --slice <slice> --target . --json`.
