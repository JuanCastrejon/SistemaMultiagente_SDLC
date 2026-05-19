# Skill: openspec-sync / opsx:sync

Sincroniza specs delta de un change activo hacia las specs canónicas sin archivar el change.

## Trigger

`/opsx:sync` — cuando se quiere promover specs del change a `openspec/specs/` antes de completar.

## Pasos

1. **Si no se provee nombre del change, pedir selección.**

   `openspec list --json` para listar changes disponibles con specs delta (`specs/` directory).
   Usar AskUserQuestion. No auto-seleccionar.

2. **Localizar specs delta**

   Archivos en `openspec/changes/<name>/specs/*/spec.md`.

   Secciones posibles:
   - `## ADDED Requirements` — nuevos reqs a agregar
   - `## MODIFIED Requirements` — cambios a reqs existentes
   - `## REMOVED Requirements` — reqs a eliminar
   - `## RENAMED Requirements` — formato FROM:/TO:

3. **Para cada spec delta, aplicar cambios a specs canónicas**

   Por cada capacidad con delta en `openspec/changes/<name>/specs/<capability>/spec.md`:

   a. Leer el delta spec.
   b. Leer la spec canónica en `openspec/specs/<capability>/spec.md` (puede no existir).
   c. Aplicar cambios de forma inteligente:
      - **ADDED**: si no existe → agregar; si existe → tratar como MODIFIED implícito.
      - **MODIFIED**: localizar req, aplicar cambio, preservar contenido no mencionado.
      - **REMOVED**: eliminar el bloque completo del req.
      - **RENAMED**: renombrar FROM → TO.
   d. Crear nueva spec canónica si la capacidad no existe aún.

4. **Mostrar resumen** — capacidades actualizadas y cambios aplicados.

## Principio clave

Merging inteligente: el delta representa *intención*, no reemplazo total. Preservar contenido no mencionado.

## Output exitoso

```
## Specs Synced: <change-name>

Updated main specs:

**<capability-1>**:
- Added requirement: "..."
- Modified requirement: "..." (added 1 scenario)

Main specs are now updated. The change remains active — archive when implementation is complete.
```

## Guardrails

- Leer ambas specs (delta y canónica) antes de modificar.
- Preservar contenido no mencionado en el delta.
- Si algo no está claro, pedir aclaración.
- La operación debe ser idempotente.
