# F11 — Commit

## Intent

Ejecutar la fase F11 del SDLC bajo el contrato versionado en `phase-contract.yaml`.

## Checklist

- Confirmar owner y participantes declarados para F11.
- Verificar entradas requeridas antes de producir salidas.
- Registrar evidencia en `.github/agent-state/evidence/<slice>/F11.yaml` cuando aplique.
- Ejecutar `sdlc phase-gate --phase F11 --slice <slice> --target . --json`.
