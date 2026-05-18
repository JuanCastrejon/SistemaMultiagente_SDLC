# Task Manager SaaS

Ejemplo greenfield ficticio.

## Producto

Aplicacion SaaS para equipos pequenos que crean tareas, asignan responsables y revisan estados.

## Superficies

- `apps/api`: API de tareas.
- `apps/web`: tablero operativo.

## Uso en regression suite

El CI instala SistemaMultiagente_SDLC sobre una copia temporal de este ejemplo y ejecuta `doctor`, `diff` y validators.
