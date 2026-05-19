# Business & Production Readiness

Capa canónica de negocio, NFRs y readiness por change.

Cada subdirectorio representa un change completado con su evidencia de readiness validada.

## Estructura

```
business-production-readiness/
└── <change-name>/
    └── readiness.md     # Evidencia de readiness del change
```

## Niveles de readiness

| Nivel | Descripción |
|-------|-------------|
| **L1** | Cambio bajo riesgo: docs, gobierno, configuración. Sin impacto funcional. |
| **L2** | Cambio funcional con impacto acotado. KPI definido, rollback documentado. |
| **L3** | Cambio crítico o de alta complejidad. NFRs completos, runbook, validación operacional. |

## Cómo se popula

Al ejecutar `/opsx:archive`, el artefacto `business-production-readiness` del change se promueve aquí si el change tiene perfil `L2` o `L3`.

Para cambios `L1` el archivo es opcional pero recomendado para trazabilidad.
