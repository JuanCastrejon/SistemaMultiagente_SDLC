# Current Slice

## ID

`bootstrap-{{project.slug}}`

## Slice Type

`governance`

## Owner Plane

`control`

## SDLC Phase

`F0`

## Objetivo

Inicializar el sistema SDLC multiagente para {{project.name}}.

## Source Traceability

- .sdlc/config.json
- openspec/config.yaml

## Owned Surfaces

{{surfacesList}}

## Validaciones

- sdlc doctor --json
- sdlc diff --json

## Gate humano

Requerido antes de promover cambios a PR.
