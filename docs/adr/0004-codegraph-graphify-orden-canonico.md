# ADR 0004: Orden canónico CodeGraph + Graphify

- Estado: Aceptada
- Fecha: 2026-05-24
- Supersede parcialmente: ADR 0002 en la parte que dejaba pendiente canonizar el orden de preferencia

## Contexto

ADR 0002 adoptó CodeGraph en coexistencia con Graphify y dejó abierta una decisión posterior: si CodeGraph debía mantenerse como complemento, volverse preferente o reemplazar parte del flujo Graphify.

La experiencia en `FacturacionDian` mostró que las herramientas no son redundantes:

- CodeGraph responde preguntas estructurales de código: símbolos, callers, callees, impacto, firmas y contexto framework-aware.
- Graphify responde preguntas semánticas cross-doc: comunidades, relaciones entre documentación, OpenSpec y material de gobierno; además exporta notas navegables a Obsidian.
- El runtime v1.4.0 (`sdlc session-start`, `resume`, `save`, `memory-sync`) necesita una jerarquía estable para no duplicar búsquedas ni crear drift entre IDEs.

## Decisión

Se canoniza la coexistencia con este orden:

| Pregunta | Herramienta preferida |
|---|---|
| Estructura de código, símbolo, callers/callees, impacto, firma | CodeGraph |
| Contexto de tarea sobre código con rutas concretas | CodeGraph `context` |
| Semántica de documentación, comunidades, god nodes, relaciones OpenSpec/docs | Graphify |
| Export navegable hacia Obsidian | Graphify export |
| Texto literal o strings exactos | `rg` / lectura directa |

Reglas:

1. `sdlc session-start` y `sdlc save` hacen healthcheck de CodeGraph y ejecutan refresh lazy si el status falla.
2. `sdlc resume` debe tolerar ausencia de Graphify local y continuar con repo canónico, CodeGraph y vault.
3. `graphify-out/` es artefacto local regenerable en consumidores; el framework no debe asumir que está versionado.
4. El export Graphify hacia Obsidian es derivado, no fuente de verdad.

## Consecuencias

### Positivas

- Reduce duplicación de tool-calls.
- Evita que Graphify y CodeGraph compitan por la misma pregunta.
- Hace portable el runtime cross-IDE sin exigir un grafo Graphify versionado.

### Negativas / Costos

- Requiere que consumidores inicialicen CodeGraph si quieren consultas estructurales rápidas.
- Si Graphify no existe localmente, `resume` pierde el mapa semántico pero no queda bloqueado.
- El orden debe quedar reflejado en docs de consumidores y en `external-tools-matrix.md`.

## Referencias

- ADR 0002 — adopción inicial de CodeGraph en coexistencia con Graphify.
- `src/runtime.js` — comandos `session-start`, `resume`, `save`, `memory-sync`.
- `FacturacionDian/docs/adr/010-codegraph-formal-adoption.md`.
