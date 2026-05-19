# Skill: openspec-archive / opsx:archive

Archiva el change completado y sincroniza las specs canónicas.

## Trigger

`/opsx:archive` — después de que `/opsx:verify` emitió `pass`.

## Pasos

1. Mover `openspec/changes/<change-name>/` a `openspec/changes/archived/`.
2. Promover artefactos de specs canónicas a `openspec/specs/` si aplica.
3. Actualizar `openspec/specs/business-production-readiness/` con el readiness alcanzado.
4. Registrar archive en `indice-operativo.md`.
5. Emitir handoff a `orquestador-opus` para continuar con el siguiente change.
