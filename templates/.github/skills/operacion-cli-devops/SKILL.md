# Operacion CLI DevOps y Gobernanza de Skills

Skill para asegurar trazabilidad operativa y adopcion controlada de skills externas en el proyecto.

## Objetivo

- Mantener flujo reproducible de PR/CI/deploy con CLI oficiales.
- Integrar skills externas sin romper convenciones internas ni arquitectura del proyecto.
- Evitar ruido en el repositorio por artefactos autogenerados.

## Regla de oro

No abrir PR final ni mergear a ramas de integracion si existen checks fallidos en GitHub Actions.

## Flujo operativo recomendado

1. Desarrollar en rama `feature/*`, `fix/*` o `docs/*`.
2. Verificar cambios locales y pruebas minimas por alcance.
3. Abrir PR draft para activar CI temprano.
4. Revisar checks/runs y corregir antes de pasar a ready.
5. Validar despliegue preview si aplica.
6. Merge por PR con historial limpio.

## Comandos base GitHub CLI

- Estado de PRs: `gh pr status`
- Crear PR draft:
  - `gh pr create --base {{gitFlow.integrationBranch}} --head <rama> --title "feat(...): ..." --body-file <archivo.md> --draft`
- Pasar a ready: `gh pr ready <numero_pr>`
- Ver checks: `gh pr checks <numero_pr>`
- Ver runs recientes: `gh run list --limit 10`
- Ver log de fallo: `gh run view <run_id> --log-failed`
- Merge squash: `gh pr merge <numero_pr> --squash --delete-branch`

## Regla de encoding para PR en PowerShell

- Para texto multilinea en PR, usar siempre archivo UTF-8 con `--body-file`.
- No usar `--body` inline con saltos de linea en PowerShell.
- Validar descripcion final con: `gh pr view <numero_pr> --json body -q ".body"`

## Gobernanza de skills externas

### Principio

Las skills internas del repo son fuente primaria para dominio, arquitectura y convenciones. Las skills externas son complemento tecnico.

### Flujo de adopcion

1. Simular deteccion y propuesta: `npx -y autoskills --dry-run -a github-copilot`
2. Revisar cada skill candidata y su fuente.
3. Aprobar solo skills alineadas al stack y politicas del proyecto.
4. Instalar de forma controlada por agente destino.
5. Documentar decision en guias/CHANGELOG cuando impacte el flujo del equipo.

### Criterios de aceptacion de una skill externa

- Aporta valor directo al stack del proyecto (backend: `{{stack.backend}}`, frontend: `{{stack.frontend}}`).
- No contradice convenciones internas ni ADRs.
- No fuerza cambios de arquitectura fuera del roadmap.
- Puede auditarse y explicarse al equipo.

## Mapeo de capas (modelo operativo)

- Capa de memoria/reglas: `copilot-instructions.md` + `instructions/*.md`
- Capa de conocimiento: `skills/*`
- Capa de guardrails: `hooks/*`
- Capa de delegacion: subagentes para exploracion y tareas acotadas
- Capa de distribucion: skills externas curadas (autoskills/skills.sh)

## Checklist rapido antes de merge

- [ ] Tests pasando localmente.
- [ ] Checks de CI verdes.
- [ ] Sin `console.log` o debug code pendiente.
- [ ] Artefactos OpenSpec del change actualizados si aplica.
- [ ] `CHANGELOG.md` con entrada correspondiente.
- [ ] PR description con cuerpo OpenSpec si corresponde.
