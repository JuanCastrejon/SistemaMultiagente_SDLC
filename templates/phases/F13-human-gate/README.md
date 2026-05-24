# F13 — Human Gate

## Intent

Ejecutar la fase F13 del SDLC bajo el contrato versionado en `phase-contract.yaml`.

## Checklist

- Confirmar owner y participantes declarados para F13.
- Verificar entradas requeridas antes de producir salidas.
- Registrar evidencia en `.github/agent-state/evidence/<slice>/F13.yaml` cuando aplique.
- Ejecutar `sdlc phase-gate --phase F13 --slice <slice> --target . --json`.
