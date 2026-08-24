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

## Implementación

El comando lo ejecutan estos dos, equivalentes y con la misma salida:

| Script | Entorno |
|---|---|
| `scripts/continua.mjs` | Node — el que usan Claude Code y Codex |
| `scripts/continua.ps1` | PowerShell — para consolas sin Node a mano |

Leen el estado canónico de `.github/agent-state/`, escriben
`platform-context.json` con **lock de 4 horas** e imprimen un resumen estructurado que
cualquier agente puede consumir.

> **El lock importa.** Dos agentes que continúen el mismo slice a la vez se pisan. Si
> el lock está vivo y hace falta seguir igualmente, la bandera existe —pero es una
> decisión, no un trámite.

## Continua hereda el checkpoint que elija `resume`

`sdlc continua` es literalmente `session-start` + `resume`: su bloque `resume` del JSON
es el mismo payload. **Hereda por tanto la trampa de los esqueletos** — si `resume`
entrega el checkpoint vacío del último merge, `continua` lo entrega igual.

Antes de retomar sobre lo que traiga, aplicar el criterio de
[`resume`](../resume/SKILL.md): el bueno es el que **no** tiene secciones en
`_(pendiente de redactar)_`, y viene en `resume.usableCheckpoint`.

<!-- sdlc-managed: true -->
<!-- sdlc-source: .github/skills/continua/SKILL.md -->
<!-- sdlc-source-sha256: b4798f044196da510104a25958a92f5578eb4647a106cd9ee88cc603956e2f7c -->
<!-- sdlc-body-sha256: 46c12d8d951bc80eff501db3d55064d8d627b47b422babb8fb8291446a0c1674 -->
