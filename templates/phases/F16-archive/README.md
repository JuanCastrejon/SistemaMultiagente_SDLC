# F16 — Archive

## Intent

Ejecutar la fase F16 del SDLC bajo el contrato versionado en `phase-contract.yaml`.

## Checklist

- Confirmar owner y participantes declarados para F16.
- Verificar entradas requeridas antes de producir salidas.
- Registrar evidencia en `.github/agent-state/evidence/<slice>/F16.yaml` cuando aplique.
- Ejecutar `sdlc phase-gate --phase F16 --slice <slice> --target . --json`.
