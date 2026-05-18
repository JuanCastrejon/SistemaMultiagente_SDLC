# Business + Production Readiness

## 1. Propósito

Esta guía explica cómo integrar negocio, NFRs y production readiness al flujo SDLC sin crear un plano nuevo ni agentes adicionales.

La idea central es simple:

- un change no debe verse "listo" solo porque tiene buena trazabilidad;
- también debe tener una razón de negocio explícita,
- un nivel de riesgo operacional declarado,
- y evidencia mínima proporcional a ese riesgo.

## 2. Dónde vive esta capa

La capa se distribuye en cuatro puntos del flujo:

1. `## [enhanced]` de `enrich-us`
2. bloque humano `## [validation]` en el Issue
3. artefactos OpenSpec (`research`, `proposal`, `design`, `tasks`)
4. gate de `qa-security-review` antes de cierre o release

No reemplaza:

- `Continua`
- `/resume`
- `/save`
- OpenSpec

Los complementa.

## 3. Niveles de readiness

### `L1` — Exploratory

Usar cuando el cambio:

- toca docs, gobierno o control plane sin riesgo operacional real,
- o introduce una mejora reversible sin impacto funcional crítico.

Evidencia mínima:

- objetivo de negocio,
- KPI principal,
- justificación del cambio,
- reversibilidad o rollback básico.

### `L2` — Operational

Usar cuando el cambio:

- altera comportamiento funcional multiusuario normal,
- afecta formularios, endpoints, flujos operativos o validaciones de negocio,
- pero no compromete de forma directa integridad regulada o cutover crítico.

Evidencia mínima:

- todo lo de `L1`,
- owner operativo,
- matriz NFR mínima,
- logging o métricas mínimas,
- validación de fallos esperables.

### `L3` — Critical-Regulated

Usar cuando el cambio toca:

- lógica financiera o regulada,
- seguridad crítica,
- cutover,
- sync con riesgo de integridad,
- reconciliación,
- compras o procesos de alto impacto.

Evidencia mínima:

- todo lo de `L2`,
- runbook,
- cutover o rollback verificable,
- prueba de concurrencia, fallo parcial o integridad equivalente,
- reconciliación o evidencia equivalente cuando aplique.

## 4. Defaults del repo

Defaults recomendados para la mayoría de proyectos:

- `L1`: docs/gobierno o cambios sin riesgo operacional real
- `L2`: cambios funcionales normales multiusuario
- `L3`: lógica financiera, seguridad crítica, cutover, sync o integridad

Estos defaults son orientativos. El equipo debe ajustarlos al dominio específico del proyecto.

## 5. Secciones obligatorias del `enhanced`

Todo `enhanced` funcional no trivial debe incluir:

- `Objetivo de negocio`
- `Hipótesis de valor`
- `KPI principal`
- `Perfil de readiness`
- `Matriz NFR`
- `Plan operativo`
- `Feedback post-release`

Plantilla mínima sugerida:

```md
### Objetivo de negocio
<qué necesidad resuelve y para quién>

### Hipótesis de valor
<por qué este cambio debería mover una métrica o reducir un riesgo>

### KPI principal
- KPI: ...
- Línea base: ...
- Objetivo: ...

### Perfil de readiness
- Nivel propuesto: L1 | L2 | L3
- Justificación: ...

### Matriz NFR
| Concern | Expectativa | Evidencia esperada |
|---|---|---|
| Seguridad | ... | ... |
| Performance / concurrencia | ... | ... |
| Disponibilidad | ... | ... |
| Observabilidad | ... | ... |
| Rollback | ... | ... |
| Datos / compliance | ... | ... |
| Costo | ... | ... |

### Plan operativo
- Owner operativo: ...
- Riesgo principal: ...
- Corte / despliegue: ...
- Rollback: ...

### Feedback post-release
- Ventana de seguimiento: ...
- KPI observado: ...
- Criterio para retrabajo: ...
```

## 6. Bloque `validation`

El Issue validado debe aprobar explícitamente esta capa.

Plantilla mínima:

```md
## [validation]
Revisor: <nombre>
Fecha: <fecha>
Veredicto: aprobado | requiere-cambios | rechazado

### Business fit
- Resultado: aprobado | requiere-cambios
- Observaciones: ...

### Readiness
- Nivel aprobado: L1 | L2 | L3
- Vacíos aceptados: ...

### Correcciones requeridas
- [ ] ...
```

Sin este bloque, el change no debe pasar a OpenSpec ni a implementación cuando el cambio es funcional no trivial.

## 7. Matriz NFR mínima

La matriz NFR no busca diseñar la solución completa. Busca evitar omisiones silenciosas.

Todo change debe responder, al menos, estas preguntas:

| Concern | Pregunta mínima |
|---|---|
| Seguridad | ¿Qué podría exponerse, romper permisos o degradar confianza? |
| Performance / concurrencia | ¿Qué pasa con múltiples usuarios o solicitudes simultáneas? |
| Disponibilidad | ¿Qué ocurre si la dependencia principal falla o se degrada? |
| Observabilidad | ¿Cómo sabremos que el cambio falló o degradó operación? |
| Rollback | ¿Cómo revertimos o aislamos el cambio si sale mal? |
| Datos / compliance | ¿Qué riesgo hay sobre integridad, reconciliación o regulación? |
| Costo | ¿Qué costo operacional o técnico introduce el cambio? |

## 8. Evidencia por gate

### Antes de promover al Issue

- objetivo de negocio claro
- KPI principal
- nivel `L1/L2/L3` propuesto
- matriz NFR mínima

### Antes de `/opsx:apply`

- business fit validado por humano
- nivel aprobado
- vacíos aceptados documentados
- tasks con validaciones explícitas de readiness

### Antes de cierre humano o release

- evidencia mínima del nivel correspondiente
- findings de `qa-security-review`
- rollback documentado

### Después del release

- seguimiento de KPI
- observación de estabilidad
- apertura de backlog o retrabajo si el cambio no cumplió su hipótesis

## 9. Qué verifica cada agente

- `analista-requisitos`: captura negocio, KPI, readiness y NFRs.
- `planificador-opus`: no deja avanzar slices o `/opsx:ff` si falta esta capa.
- `orquestador-opus`: devuelve el flujo al analista si `/resume` o `Continua` detectan que la capa está incompleta.
- `qa-security-review`: verifica la evidencia exigida por `L1/L2/L3`.

## 10. Tres ejemplos rápidos

### Ejemplo `L1`

Cambio: ajuste de guía operativa interna.

- negocio: reducir ambigüedad del equipo
- KPI: menos retrabajo por instrucciones ambiguas
- evidencia: reversibilidad documental

### Ejemplo `L2`

Cambio: nuevo formulario admin para operación cotidiana.

- negocio: reducir tiempo de captura
- KPI: tiempo promedio por operación
- evidencia: logging mínimo, fallos esperables, rollback funcional

### Ejemplo `L3`

Cambio: lógica de alta criticidad con riesgo de integridad de datos.

- negocio: evitar inconsistencia de datos o fallo de proceso crítico
- KPI: errores críticos = 0
- evidencia: runbook, rollback verificable, prueba de integridad o concurrencia

## 11. Límite de esta v1

Esta v1 no despliega observabilidad productiva por sí sola.

Lo que sí hace es dejar obligatorio:

- decidir qué evidencia hace falta,
- registrar quién la valida,
- y bloquear el flujo si no existe.
