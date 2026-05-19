# Skill: openspec-ff / opsx:ff

Fast-forward: genera todos los artefactos necesarios para implementación de un solo tirón.

## Trigger

`/opsx:ff <change-name>` — cuando se quiere pasar directamente de idea a estado listo para `/opsx:apply`.

## Pasos

1. **Si no hay input claro, preguntar qué se quiere construir.**

   Derivar nombre kebab-case desde la descripción.
   **No continuar sin entender el objetivo.**

2. **Validar readiness gate antes de crear artefactos.**

   Para cambios funcionales no triviales, verificar que exista análisis aprobado con:
   - business fit / objetivo de negocio
   - KPI principal
   - readiness profile `L1 | L2 | L3`
   - matriz NFR mínima
   - aprobación humana `## [validation]` (o equivalente explícito)

   **Si falta alguno**: STOP → enrutar a `/enrich-us` o `analista-requisitos`.
   Excepción: trabajo `L1` docs/gobierno con contexto suficiente puede continuar.

3. **Crear el directorio del change.**

   ```bash
   openspec new change "<name>"
   ```

4. **Obtener orden de construcción de artefactos.**

   ```bash
   openspec status --change "<name>" --json
   ```

   Extraer `applyRequires` y lista de artefactos con estado y dependencias.

5. **Crear artefactos en secuencia hasta estar apply-ready.**

   Usar TodoWrite para tracking.

   Por cada artefacto con `status: "ready"`:
   ```bash
   openspec instructions <artifact-id> --change "<name>" --json
   ```
   - `context` y `rules` son restricciones para el agente — NO copiar al archivo.
   - `template` es la estructura del artefacto — rellenar sus secciones.
   - Leer dependencias completadas antes de crear el siguiente.
   - Mostrar: "✓ Created <artifact-id>"

   Repetir hasta que todos los artefactos en `applyRequires` tengan `status: "done"`.

6. **Mostrar estado final.**

   ```bash
   openspec status --change "<name>"
   ```

## Output

Resumen con:
- Nombre y ubicación del change
- Lista de artefactos creados
- "All artifacts created! Ready for implementation."
- Prompt: "Run `/opsx:apply` to start working on the tasks."

## Guardrails

- No abrir change funcional no trivial sin business fit, KPI, readiness, NFRs y validación humana.
- Leer artefactos dependientes antes de crear el siguiente.
- `context` y `rules` NO van en el output del artefacto.
- Si un change con ese nombre ya existe, sugerir continuar ese change.
