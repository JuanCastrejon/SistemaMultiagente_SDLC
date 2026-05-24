# F3 — Local Issue Validation

## Intent

Ejecutar la fase F3 del SDLC bajo el contrato versionado en `phase-contract.yaml`.

## Checklist

- Confirmar owner y participantes declarados para F3.
- Verificar entradas requeridas antes de producir salidas.
- Registrar evidencia en `.github/agent-state/evidence/<slice>/F3.yaml` cuando aplique.
- Ejecutar `sdlc phase-gate --phase F3 --slice <slice> --target . --json`.
