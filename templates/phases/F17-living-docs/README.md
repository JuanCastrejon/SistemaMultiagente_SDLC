# F17 — Living Docs

## Intent

Ejecutar la fase F17 del SDLC bajo el contrato versionado en `phase-contract.yaml`.

## Checklist

- Confirmar owner y participantes declarados para F17.
- Verificar entradas requeridas antes de producir salidas.
- Registrar evidencia en `.github/agent-state/evidence/<slice>/F17.yaml` cuando aplique.
- Ejecutar `sdlc phase-gate --phase F17 --slice <slice> --target . --json`.
