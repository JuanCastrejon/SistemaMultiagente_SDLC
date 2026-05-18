# Skill: openspec-verify / opsx:verify

Valida que la implementación cumple con los artefactos del change activo.

## Trigger

`/opsx:verify` — después de `/opsx:apply` con todos los criterios de DoD verificados.

## Pasos

1. Leer `openspec/changes/<change-name>/specs.md` y `tasks.md`.
2. Verificar que cada spec tiene tests que la cubren.
3. Corroborar que las tasks están todas en estado `done`.
4. Ejecutar linters, type-check y suite de tests.
5. Revisar que no hay drift entre implementación y design del change.
6. Emitir `pass` si todo está OK, o `fail` con lista de gaps si no.
