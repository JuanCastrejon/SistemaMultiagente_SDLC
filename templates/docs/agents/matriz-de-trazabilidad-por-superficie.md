# Matriz de Trazabilidad por Superficie

| Superficie | Owner | Paths |
| --- | --- | --- |
{{surfacesTable}}

## Evidencia minima por superficie

- OpenSpec change o spec aplicable.
- Tests o verificacion manual documentada.
- Handoff desde el agente owner.
- Riesgos abiertos actualizados.
- Labels de triage correctos.

## Regla de conflicto

Si dos slices tocan el mismo path, F5 debe coordinar en `active-slices.yaml` antes de F7.
