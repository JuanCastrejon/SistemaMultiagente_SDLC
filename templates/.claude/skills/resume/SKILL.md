---
name: resume
description: "Reconstruye contexto SDLC sin mutar archivos usando el runtime Node de SistemaMultiagente_SDLC. Usar cuando el usuario invoque /resume o pida retomar contexto."
---

# Resume

Ejecutar:

```powershell
npx --no-install sdlc resume --target . --markdown
```

Reglas:

- No modificar archivos.
- Respetar jerarquia repo -> CodeGraph -> Graphify -> vault.
- Si falta definicion funcional o readiness, devolver owner a `analista-requisitos-migracion`.
