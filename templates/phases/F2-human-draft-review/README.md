# F2 — Human Draft Review

## Intent

Ejecutar la fase F2 del SDLC bajo el contrato versionado en `phase-contract.yaml`.

## Checklist

- Confirmar owner y participantes declarados para F2.
- Verificar entradas requeridas antes de producir salidas.
- Registrar evidencia en `.github/agent-state/evidence/<slice>/F2.yaml` cuando aplique.
- Ejecutar `sdlc phase-gate --phase F2 --slice <slice> --target . --json`.
