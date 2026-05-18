# Core / Profile / Project

## Core

Artefactos que todo repo consumidor recibe:

- control plane
- specialist plane base
- estado compartido
- handoffs
- validators
- continuity runtime
- Graphify y Obsidian como configuracion portable
- telemetry schemas

## Profile

Variacion por tipo de proyecto:

- `greenfield-sdd`
- `legacy-brownfield-sdd`

## Project

Contenido propio del repo consumidor:

- dominio
- stack real
- superficies
- specs canonicas
- reglas semanticas
- allowlist de skills externa

La regla de extraccion es: lo generico vive en `core`, lo dependiente del tipo de proyecto vive en `profiles`, y lo especifico de negocio nunca entra al core.
