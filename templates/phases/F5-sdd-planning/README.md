# F5 — SDD Planning

## Intent

Ejecutar la fase F5 del SDLC bajo el contrato versionado en `phase-contract.yaml`.

## Checklist

- Confirmar owner y participantes declarados para F5.
- Verificar entradas requeridas antes de producir salidas.
- Registrar evidencia en `.github/agent-state/evidence/<slice>/F5.yaml` cuando aplique.
- Ejecutar `sdlc phase-gate --phase F5 --slice <slice> --target . --json`.
