# F9 — QA

## Intent

Ejecutar la fase F9 del SDLC bajo el contrato versionado en `phase-contract.yaml`.

## Checklist

- Confirmar owner y participantes declarados para F9.
- Verificar entradas requeridas antes de producir salidas.
- Registrar evidencia en `.github/agent-state/evidence/<slice>/F9.yaml` cuando aplique.
- Ejecutar `sdlc phase-gate --phase F9 --slice <slice> --target . --json`.
