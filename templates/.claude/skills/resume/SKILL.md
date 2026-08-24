---
name: resume
description: "Reconstruye contexto SDLC sin mutar archivos usando el runtime Node de SistemaMultiagente_SDLC. Usar cuando el usuario invoque /resume o pida retomar contexto."
---

# Resume

Comando canónico:

```powershell
npx --no-install sdlc resume --target . --markdown
```

Reglas:

- No modificar archivos.
- Respetar jerarquia repo -> CodeGraph -> Graphify -> vault.
- Si falta definicion funcional o readiness, devolver owner a `analista-requisitos-migracion`.

## Si el vault devuelve un esqueleto, no es el checkpoint bueno

El hook `post-merge` corre `sdlc save` en **cada merge**, así que deja un checkpoint
vacío con marca de tiempo **posterior** a la del redactado. **El más reciente no es el
que sirve.** Medido en un consumidor real: 35 checkpoints en un día, **34 esqueletos**.

**Cómo distinguirlo — por el cuerpo, no por una etiqueta.** Un esqueleto tiene sus
secciones narrativas en `_(pendiente de redactar)_`. Ese es el criterio que usa el
propio CLI; cualquier marca de frontmatter que alguien añada es para humanos y el CLI
no la lee.

**Qué mirar en la salida:**

- `usableCheckpoint` — el más reciente **redactado**. Ese es el que hay que abrir.
- `latestCheckpoint` — el más reciente a secas, que suele ser el esqueleto del último
  merge. Se sigue reportando porque es un hecho, no porque sirva.
- `skeletonsSinceUsable` — cuántos se saltaron para llegar al bueno.

En `--markdown`, el utilizable va **primero** y el otro sale etiquetado. Si la salida
no trae `usableCheckpoint`, esa máquina corre una versión anterior a 2.1.2 y el
filtrado hay que hacerlo a mano: **buscar hacia atrás** hasta el primero sin
placeholders.

## Antes de repetir una cifra del checkpoint

Un checkpoint es una foto del día que se escribió. Antes de llevar cualquier número
suyo a un artefacto durable —commit, spec, ADR, PR—, **volver a ejecutar el comando
que lo produjo**.

No basta con recordar el veredicto: el valor está en que el comando lo vuelva a
producir. Un repo que acumule retractaciones hará bien en llevar su propio registro de
afirmaciones ya refutadas, **cada una con el comando que la resuelve**.

<!-- sdlc-managed: true -->
<!-- sdlc-source: .github/skills/resume/SKILL.md -->
<!-- sdlc-source-sha256: e7a35a25000db0e164b3f78fdd833aeab978f9a1e188e1ebbbb67dfdfff729a6 -->
<!-- sdlc-body-sha256: 793aed71b244fefdaba91d8b04d42610c7d61817e7865592546af09968dd0a2a -->
