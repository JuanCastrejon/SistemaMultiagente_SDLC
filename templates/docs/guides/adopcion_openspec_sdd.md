# Adopción de OpenSpec y SDD en {{project.name}}

## 1. Propósito

Este documento aterriza cómo se adopta OpenSpec en `{{project.name}}` sin destruir la documentación viva ya levantada.

La necesidad nace de una realidad frecuente en proyectos brownfield o en crecimiento:

- el repositorio ya tiene una base documental sobre el dominio existente
- muchas iteraciones históricas avanzaron sobre slices o entregables sin una fuente canónica única
- el flujo exige distinguir entre evidencia, contrato funcional y trabajo pendiente

OpenSpec se adopta para resolver exactamente ese hueco.

## 2. Qué cambia con esta adopción

OpenSpec no reemplaza la documentación existente. La reorganiza por niveles de verdad:

| Nivel | Ubicación | Rol |
|---|---|---|
| Evidencia detallada | `docs/legacy/`, `docs/requirements/` | Capturas funcionales, análisis de dominio, trazabilidad histórica |
| Contrato canónico vigente | `openspec/specs/` | Capacidades activas que el proyecto reconoce como fuente de verdad operacional |
| Trabajo propuesto o en curso | `openspec/changes/` | Cambios nuevos con `research`, `proposal`, `specs`, `design` y `tasks` |
| Workflow del repo | `openspec/schemas/` | Esquema activo que guía la investigación antes de proponer |

En otras palabras:

- `docs/` conserva la memoria y la evidencia
- `openspec/specs/` concentra el contrato
- `openspec/changes/` ordena la evolución futura

## 3. Fuente única de verdad a partir de hoy

La fuente única de verdad para cambios funcionales nuevos deja de ser "lo último que se recordó en un chat" o "la última ficha suelta tocada".

La jerarquía operativa queda así:

1. `openspec/specs/` para capacidades ya canonizadas
2. `docs/` para fuentes de dominio, arquitectura y levantamiento funcional

## 4. Capacidades iniciales sembradas en OpenSpec

La semilla inicial no intenta convertir todo el material existente en specs de una sola vez. Se extraen primero las capacidades fundacionales que ya tienen evidencia suficiente en el dominio del proyecto.

Usar `/opsx:explore` para identificar qué capacidades tienen suficiente evidencia para ser canonizadas como primer paso.

## 5. Esquema del proyecto

El esquema activo determina el flujo de artefactos:

- **`legacy-brownfield-sdd`**: añade `research.md` obligatorio antes de `proposal`. Fuerza preguntas que proyectos brownfield no pueden volver a saltarse:
  - ¿cuál es la fuente primaria de verdad para este cambio?
  - ¿qué evidencia documental respalda la necesidad?
  - ¿qué drift existe entre runtime vivo y snapshot histórico?
- **`greenfield-sdd`**: flujo directo `proposal → specs → design → tasks`. Sin `research` obligatorio ya que no hay legacy que investigar.

Ver `openspec/config.yaml` para el esquema activo del proyecto.

## 6. Workflow recomendado para el día a día

### 6.0 Uso operativo del CLI en este repo

La convención operativa es usar la CLI vía `npx` y fijar versión cuando se necesite reproducibilidad exacta:

- `npx @fission-ai/openspec@1.3.1 validate --all`
- `npx @fission-ai/openspec@1.3.1 archive <nombre-del-cambio>`

Si el comando se ejecuta dentro de una sesión de agente que ya usa skills `opsx`, los comandos slash siguen siendo la forma preferida para explorar, proponer, aplicar y archivar. La CLI vía `npx` se usa sobre todo para validaciones, troubleshooting y automatización local.

### 6.0.1 Telemetría

Para opt-out explícito de la telemetría anónima de OpenSpec:

- PowerShell: `$env:OPENSPEC_TELEMETRY = '0'`
- bash/zsh: `export OPENSPEC_TELEMETRY=0`

### 6.1 Antes de tocar código

1. Revisar si la capacidad ya existe en `openspec/specs/`.
2. Si no existe o va a cambiar, abrir o actualizar un change en `openspec/changes/`.
3. En proyectos brownfield: preparar `research.md` con fuentes y drift.

### 6.2 Explorar y proponer

Para ideas ambiguas:

- `/opsx:explore`

Para abrir un cambio formal:

- `/opsx:propose <nombre-del-cambio>`

### 6.3 Diseñar y ejecutar

Después de investigación y propuesta:

1. escribir delta specs de la capacidad
2. diseñar el enfoque técnico si el cambio cruza varias superficies
3. descomponer tareas pequeñas y verificables
4. implementar
5. validar
6. archivar el change

### 6.4 Archivar

Cuando el cambio esté completo:

- `/opsx:archive <nombre-del-cambio>`

El archivado fusiona las delta specs hacia `openspec/specs/` y mantiene el historial del cambio.

## 7. Reglas del flujo OpenSpec

### 7.1 No todo documento legacy se vuelve spec de inmediato

El material documental existente sigue siendo valioso como evidencia y detalle. Solo debe pasar a `openspec/specs/` cuando exista una capacidad relativamente estable y reutilizable.

### 7.2 Los cambios funcionales grandes no arrancan desde código

Primero deben anclarse en:

- `research` (si aplica el esquema brownfield)
- `proposal`
- `specs`

Luego sí código.

### 7.3 La documentación existente no se pierde

La cobertura documental ya construida no se reescribe. Se consume como evidencia para sembrar nuevas capacidades en OpenSpec cuando cada dominio lo requiera.

## 8. Relación con la documentación existente

### `docs/`

Conserva la memoria del dominio: análisis técnico, levantamiento funcional, fichas, trazabilidad y backlog.

### `openspec/specs/`

Vista comprimida y contractual de lo que el proyecto considera vigente y verificable.

### `openspec/changes/`

Evolución controlada: research, proposal, specs, design y tasks por change.

## 9. Resultado esperado de esta adopción

Si el equipo usa OpenSpec como se configuró aquí:

- deja de depender de memoria de chat
- tiene cambios trazables y auditables
- puede usar agentes de IA con un contrato previo más fuerte
- vuelve a conectar el trabajo diario con un SDLC más disciplinado

Ese es el objetivo real de esta adopción.
