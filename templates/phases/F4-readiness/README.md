# F4 — Readiness

## Intent

Ejecutar la fase F4 del SDLC bajo el contrato versionado en `phase-contract.yaml`.

## Checklist

- Confirmar owner y participantes declarados para F4.
- Verificar entradas requeridas antes de producir salidas.
- Registrar evidencia en `.github/agent-state/evidence/<slice>/F4.yaml` cuando aplique.
- Ejecutar `sdlc phase-gate --phase F4 --slice <slice> --target . --json`.
