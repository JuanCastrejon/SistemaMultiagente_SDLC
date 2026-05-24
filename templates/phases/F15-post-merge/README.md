# F15 — Post Merge

## Intent

Ejecutar la fase F15 del SDLC bajo el contrato versionado en `phase-contract.yaml`.

## Checklist

- Confirmar owner y participantes declarados para F15.
- Verificar entradas requeridas antes de producir salidas.
- Registrar evidencia en `.github/agent-state/evidence/<slice>/F15.yaml` cuando aplique.
- Ejecutar `sdlc phase-gate --phase F15 --slice <slice> --target . --json`.
