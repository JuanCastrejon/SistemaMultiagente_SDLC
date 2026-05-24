---
name: save
description: "Escribe un checkpoint portable en el vault local usando el runtime Node de SistemaMultiagente_SDLC. Usar cuando el usuario invoque /save o pida guardar continuidad."
---

# Save

Comando canónico:

```powershell
npx --no-install sdlc save --target . --event manual --json
```

Reglas:

- Escribe checkpoint local en el vault.
- No promueve a GitHub Issue, OpenSpec ni PR sin gate humano.
- Marcar cualquier decision durable como pendiente de promocion al repo.
