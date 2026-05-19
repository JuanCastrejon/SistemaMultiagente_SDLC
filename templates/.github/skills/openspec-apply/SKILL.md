# Skill: openspec-apply / opsx:apply

Implementa las tasks del change activo una por una, verificando el DoD por slice.

## Trigger

`/opsx:apply` — después de que el artefacto `tasks` del change esté aprobado.

## Pasos

1. Leer `openspec/changes/<change-name>/tasks.md`.
2. Tomar la primera task no completada.
3. Implementar en la superficie correspondiente según `ownership-matrix.md`.
4. Verificar criterios de DoD de la task (tests, linters, type-check).
5. Marcar task como completada y emitir handoff al siguiente agente si aplica.
6. Repetir hasta completar todas las tasks.
7. Al terminar, emitir handoff a `qa-security-review`.
