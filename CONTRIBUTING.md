# Contributing

Gracias por ayudar a mejorar SistemaMultiagente_SDLC. Este proyecto prioriza cambios pequenos, trazables y validados.

## Branch Flow

- Crea ramas desde `develop`.
- Usa prefijos claros: `feature/`, `fix/`, `docs/`, `chore/`.
- Todo cambio estable termina en `main` mediante PR desde `develop`.

## Commit Style

Usa Conventional Commits:

```text
feat: add operational script
fix: preserve managed file checksum
docs: clarify greenfield install
chore: update release metadata
```

## Pull Requests

Antes de abrir o actualizar un PR:

1. Ejecuta `npm run validate`.
2. Ejecuta `npm test`.
3. Actualiza `CHANGELOG.md` si el cambio afecta comportamiento, CLI, templates o release notes.
4. Actualiza docs si el cambio modifica gobierno, install, validators, migrations o templates.
5. Indica si hay breaking changes o migraciones.

## Governance Rules

- No reemplaces `.github/skills/` con skills externas sin una decision documentada.
- No agregues rutas personales, secretos, datos de un proyecto consumidor o contenido donor sin sanitizar.
- No instales herramientas externas desde scripts sin opt-in explicito.
- Mantén `feature/* -> develop -> main` como flujo de release.

## Code of Conduct

Al participar aceptas seguir el [Code of Conduct](CODE_OF_CONDUCT.md).
