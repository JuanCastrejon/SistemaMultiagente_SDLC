# Copilot Instructions — {{project.name}} (greenfield)

Modo: greenfield — proyecto nuevo sin código legacy.

## Enfoque greenfield

- Partir de arquitectura limpia; no asumir deuda técnica previa.
- Priorizar: contratos de API definidos en OpenSpec antes de implementación.
- Usar ADRs para decisiones de stack no triviales.

## Flujo de inicio

1. Bootstrap con `sdlc install` → genera estructura base.
2. Definir superficies en `.sdlc/config.json`.
3. Crear primer change en `openspec/changes/` con `/opsx:new`.
4. Seguir flujo canónico desde `/opsx:ff`.

## Reglas adicionales greenfield

- No introducir dependencias sin registrarlas en el change activo.
- Toda nueva superficie requiere entry en `surfaces[]` de `.sdlc/config.json`.
- Establecer CI/CD desde el primer merge a `{{gitFlow.integrationBranch}}`.
