# Skill: commit

Produce un commit Conventional Commits + PR contra la rama de integración.

## Trigger

`/commit [#issue]` — ejecutar después de `/opsx:verify` con tests en verde.

## Pasos

1. Verificar que los tests pasen (`CI` o runner local).
2. Stage de archivos relevantes (nunca `git add -A` sin revisar).
3. Construir mensaje Conventional Commits:
   - `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`
   - Scope opcional: `(surface-id)` o `(change-name)`.
   - Footer: `Closes #<issue>` si aplica.
4. Crear PR contra `{{gitFlow.integrationBranch}}` con body que referencie el change de OpenSpec.
5. Solicitar revisión humana antes de merge.
