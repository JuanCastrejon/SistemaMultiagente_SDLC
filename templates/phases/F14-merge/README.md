# F14 — Merge

## Intent

Ejecutar la fase F14 del SDLC bajo el contrato versionado en `phase-contract.yaml`.

## Checklist

- Confirmar owner y participantes declarados para F14.
- Verificar entradas requeridas antes de producir salidas.
- Registrar evidencia en `.github/agent-state/evidence/<slice>/F14.yaml` cuando aplique.
- Ejecutar `sdlc phase-gate --phase F14 --slice <slice> --target . --json`.
