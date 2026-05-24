---
name: continua
description: "Ejecuta session-start + resume para continuar un slice SDLC desde cualquier IDE. Usar cuando el usuario diga Continua."
---

# Continua

Comando canónico:

```powershell
npx --no-install sdlc continua --target . --platform claude_code --json
```

Reglas:

- Primero valida runtime.
- Luego reconstruye contexto.
- Si hay gate humano pendiente, no implementar; reportar owner y bloqueo.
