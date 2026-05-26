# ADR 0005: Jerarquía de herramientas de retrieval y perfiles operativos

- Estado: Aceptada
- Fecha: 2026-05-26
- Versión: 1.6.0
- Extiende: ADR 0004 (orden canónico CodeGraph / Graphify)

## Contexto

Los repos consumidores del framework SDLC multiagente acumulan herramientas útiles pero costosas si se cargan simultáneamente: OpenSpec, AGENTS/CLAUDE/Copilot, CodeGraph, Graphify, Obsidian, skills, party-mode, enrich-us, caveman y headroom. El patrón observado es `context amplification`: cada capa resuelve un problema real, pero ninguna reemplaza a la anterior.

ADR 0004 separó CodeGraph para estructura de código y Graphify para semántica documental. Faltaba una doctrina completa que incluyera Obsidian, OpenSpec, Grep, WebSearch y perfiles por tipo de tarea.

## Decisión

SistemaMultiagente_SDLC 1.6.0 introduce una doctrina soft de jerarquía y perfiles:

1. Retrieval obligatorio por nivel: Read directo → CodeGraph → Graphify → Obsidian → OpenSpec specs → Grep/Glob → WebSearch/WebFetch.
2. Tres perfiles operativos:
   - `LEAN`: default para CRUD, bug fix, refactor < 3 archivos y edición documental puntual.
   - `ANALYSIS`: F2/F3, prior-art, onboarding o diseño cross-doc.
   - `ORCHESTRATION`: F4, validación y debate multi-voz con party-mode.
3. La fuente canónica de gobierno es `.github/` más el bloque `SDLC_SHARED_RULES`; `AGENTS.md`, `CLAUDE.md` y Copilot son entrypoints/mirrors.
4. La importación de chats a Obsidian es determinística y sin modelo por defecto; `/save` queda como checkpoint decisional explícito.
5. El gate local pre-push/pre-PR ejecuta validadores, bootstrap de skills y harness SDLC antes de publicar ramas o PRs.

## Consecuencias

- Los consumidores nuevos reciben reglas 7-8 en `SDLC_SHARED_RULES` desde `src/render.js`.
- `docs/guides/tool-hierarchy-and-profiles.md` se instala como guía operativa.
- Skills `contexto-proyecto`, `enrich-us` y `party-mode` quedan alineadas con perfiles.
- `scripts/validate-local-gate.ps1` permite reproducir el control plane local antes de GitHub Actions.
- No se agregan hooks bloqueantes ni telemetría dura; si se necesita medición empírica, se abrirá un cambio separado.
- `npm publish` sigue siendo gate humano externo.
