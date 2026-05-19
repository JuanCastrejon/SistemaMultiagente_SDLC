# Skill: openspec-continue / opsx:continue

Continúa un change activo creando el siguiente artefacto pendiente.

## Trigger

`/opsx:continue` — después de `/opsx:new` o al retomar un change en progreso.

## Pasos

1. **Si no se provee nombre del change, pedir selección.**

   `openspec list --json` para obtener changes ordenados por última modificación.
   Usar AskUserQuestion con top 3-4, marcando el más reciente como "(Recommended)".
   **No auto-seleccionar.**

2. **Verificar estado actual.**

   ```bash
   openspec status --change "<name>" --json
   ```

   Extraer: `schemaName`, `artifacts` (con status: done/ready/blocked), `isComplete`.

3. **Actuar según estado:**

   **Si `isComplete: true`**:
   - Felicitar al usuario.
   - Sugerir: "All artifacts created! You can now implement or archive."
   - STOP.

   **Si hay artefactos con `status: "ready"`**:
   - Tomar el PRIMERO con `status: "ready"`.
   - Obtener instrucciones:
     ```bash
     openspec instructions <artifact-id> --change "<name>" --json
     ```
   - Leer artefactos dependientes completados para contexto.
   - Crear el artefacto usando `template` como estructura.
   - `context` y `rules` son restricciones — NO copiar al archivo.
   - Mostrar qué se creó y qué se desbloqueó.
   - STOP después de crear UNO solo.

   **Si todo bloqueado**:
   - Mostrar estado y sugerir revisar dependencias.

4. **Mostrar progreso final.**

   ```bash
   openspec status --change "<name>"
   ```

## Output

Por cada invocación:
- Artefacto creado
- Schema en uso
- Progreso (N/M completados)
- Artefactos desbloqueados
- Prompt: "Want to continue?"

## Guardrails

- Crear UN solo artefacto por invocación.
- Leer artefactos dependientes antes de crear uno nuevo.
- Nunca saltar artefactos ni crearlos fuera de orden.
- `context` y `rules` NO van en el output del artefacto.
- Verificar que el archivo existe después de escribir.
