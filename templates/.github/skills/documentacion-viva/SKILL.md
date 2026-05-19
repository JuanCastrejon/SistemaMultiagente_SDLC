# Documentación Viva — Mantenimiento y Sincronización

Skill que garantiza que la documentación y las skills del agente se mantengan actualizadas conforme avanza el proyecto.

## Cuándo Usar

- Al completar una funcionalidad o módulo nuevo
- Al tomar una decisión técnica significativa
- Al modificar la arquitectura o estructura del proyecto
- Al cambiar convenciones de código o herramientas
- Al preparar un release
- Cuando algo documentado ya no refleja la realidad del código

## Principio Fundamental

La documentación y las skills son **fuentes de contexto** que deben reflejar el estado real del proyecto. Si el código cambia pero la documentación no, el agente trabaja con información obsoleta.

## Procedimiento de Actualización

### 1. Identificar qué cambió

| Tipo de cambio | Documentos a actualizar |
|----------------|------------------------|
| Nuevo módulo de backend | `docs/architecture/`, README del módulo, skill `contexto-proyecto` |
| Nueva entidad de dominio | `docs/domain/`, skill `contexto-proyecto` |
| Decisión técnica importante | Crear ADR en `docs/adr/`, actualizar índice ADR, skill `contexto-proyecto` |
| Cambio de convención | `docs/guides/convenciones.md`, skill `contexto-proyecto` |
| Release | `CHANGELOG.md` |
| Cambio de arquitectura | `docs/architecture/`, skill `contexto-proyecto` |
| Nuevo package/módulo | `docs/architecture/monorepo_structure.md` si aplica, skill `contexto-proyecto` |
| Cambio de stack/herramienta | `copilot-instructions.md`, docs relevantes, skill `contexto-proyecto` |
| Cambio en agentes, ownership, handoffs | `.github/AGENTS.md`, `.github/agents/`, `.github/agent-state/`, `docs/agents/`, `indice-operativo.md` |
| Nuevo slice o ajuste de gobernanza | `.github/agent-state/current-slice.md`, `docs/requirements/slices/` |

### 2. Actualizar documentación fuente (docs/)

La documentación en `docs/` es la **fuente de verdad**. Siempre actualizar aquí primero:

- `docs/architecture/` — Arquitectura y estructura
- `docs/domain/` — Modelo de dominio
- `docs/adr/` — Decisiones técnicas (crear nuevo ADR, nunca modificar uno existente)
- `docs/guides/` — Guías y convenciones
- `docs/requirements/` — Requerimientos, historias, casos de uso, trazabilidad
- `docs/agents/` — ownership, handoffs, superficies y guardrails del control plane
- `.github/agent-state/` — slice actual, fases, riesgos, decisiones y plantillas operativas
- `.github/agents/` — manifiestos, ownership y matrices machine-readable del sistema multiagente

### 3. Sincronizar skills del agente

Después de actualizar `docs/`, sincronizar las references de la skill:

```
.github/skills/contexto-proyecto/references/
├── system_architecture.md   ← sync con docs/architecture/
├── domain_model.md          ← sync con docs/domain/
├── adr-index.md             ← sync con docs/adr/README.md
└── convenciones.md          ← sync con docs/guides/convenciones.md
```

Las references son **resúmenes optimizados** de los documentos fuente, no copias exactas.

### 4. Actualizar copilot-instructions.md si es necesario

Si cambia el stack, las convenciones fundamentales o la estructura del proyecto.

### 5. Actualizar CHANGELOG.md

> **REGLA OBLIGATORIA — Fechas:** Usar siempre la **fecha real del día actual** al crear entradas. Nunca inventar ni asumir una fecha.

### 6. Commit

Incluir cambios de documentación en el mismo commit que el código, o en commit separado `docs(...)`.

## Checklist de Sincronización

- [ ] ¿La documentación en `docs/` refleja el estado actual?
- [ ] ¿Las references de las skills están sincronizadas?
- [ ] ¿El CHANGELOG.md tiene la entrada correspondiente?
- [ ] ¿Se necesita un nuevo ADR?
- [ ] ¿El copilot-instructions.md sigue siendo preciso?
- [ ] ¿`.github/agents/`, `.github/agent-state/` y `docs/agents/` siguen alineados?
- [ ] ¿El slice actual y sus handoffs siguen reflejando el trabajo en curso?
