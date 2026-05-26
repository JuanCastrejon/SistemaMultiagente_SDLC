# F12 — Pull Request

## Intent

Ejecutar la fase F12 del SDLC bajo el contrato versionado en `phase-contract.yaml`.

## Checklist

- Confirmar owner y participantes declarados para F12.
- Verificar entradas requeridas antes de producir salidas.
- Registrar evidencia en `.github/agent-state/evidence/<slice>/F12.yaml` cuando aplique.
- Ejecutar `sdlc phase-gate --phase F12 --slice <slice> --target . --json`.
