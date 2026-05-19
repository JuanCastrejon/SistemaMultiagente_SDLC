# Guardrails Semanticos del Dominio

Este documento registra reglas semanticas que los agentes no deben violar.

## Plantilla de regla

```json
{
  "id": "unique-rule-id",
  "title": "Regla en lenguaje humano",
  "references": ["docs/domain.md", "openspec/specs/<capability>/spec.md"]
}
```

## Reglas base

1. El repo versionado es la fuente de verdad; el vault es memoria auxiliar.
2. Todo cambio funcional no trivial declara objetivo de negocio, KPI, readiness y NFR.
3. El modo legacy exige investigacion antes de cambiar comportamiento.
4. Los reworks usan labels explicitos, no interpretacion libre.
5. Los hallazgos de seguridad altos o criticos requieren gate humano.
