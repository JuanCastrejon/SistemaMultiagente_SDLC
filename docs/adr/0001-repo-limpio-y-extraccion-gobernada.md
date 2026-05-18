# ADR 0001: Repositorio limpio y extraccion gobernada

- Estado: Aceptada
- Fecha: 2026-05-18

## Contexto

El framework SDLC multiagente maduro nacio dentro de repos producto. Para volverlo reusable, se necesita extraer patrones sin arrastrar dominio, rutas personales ni historial de producto.

## Decision

`SistemaMultiagente_SDLC` nace como repo limpio. La atribucion se conserva mediante:

- ADRs.
- `docs/extraction/v1.0.0/extraction-manifest.yaml`.
- referencias a commits donor.

El historial Git completo de los repos donor no se importa.

## Consecuencias

- La base reusable queda limpia y auditable.
- La extraccion requiere manifest, sanitizacion y validators.
- Los repos donor quedan congelados para cambios de framework salvo fixes criticos.
