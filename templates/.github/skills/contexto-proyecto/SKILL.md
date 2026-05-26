# Skill: contexto-proyecto

Carga el contexto operativo del proyecto antes de cualquier tarea.

## Trigger

Nueva sesión, después de `/resume`, o cuando el agente pida contexto explícitamente.

## Pasos

0. Elegir perfil operativo antes de cargar contexto:
   - `LEAN` por defecto para CRUD, bug fix, refactor < 3 archivos o edición documental puntual.
   - `ANALYSIS` para F2/F3, prior-art, onboarding o análisis cross-doc.
   - `ORCHESTRATION` solo para F4, tradeoffs complejos o debate multi-voz.
1. Leer `indice-operativo.md` para el mapa de componentes.
2. Leer el bloque `SDLC_SHARED_RULES` de `AGENTS.md` o `.github/AGENTS.md`.
3. En `LEAN`, usar CodeGraph para estructura de código y OpenSpec specs mínimas; no cargar Graphify ni vault salvo `/resume` explícito.
4. En `ANALYSIS` u `ORCHESTRATION`, si existe `graphify-out/GRAPH_REPORT.md`, leer nodos dominantes y comunidades.
5. Identificar el change activo en `openspec/changes/` si existe.
6. Leer el último checkpoint del vault solo si `/resume` fue invocado o el perfil es `ANALYSIS`/`ORCHESTRATION`.
