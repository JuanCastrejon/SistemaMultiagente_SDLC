# F10 — Security

## Intent

Ejecutar la fase F10 del SDLC bajo el contrato versionado en `phase-contract.yaml`.

## Checklist

- Confirmar owner y participantes declarados para F10.
- Verificar entradas requeridas antes de producir salidas.
- Registrar evidencia en `.github/agent-state/evidence/<slice>/F10.yaml` cuando aplique.
- Ejecutar `sdlc phase-gate --phase F10 --slice <slice> --target . --json`.
